import { query } from '@/lib/db'
import { getPlaybook } from '../verticals'
import { recall } from '../runtime/memory'
import type { Tool, RunContext } from '../types'

export interface ChurnSaveCandidate {
  account_id: string
  account_name: string
  industry: string
  contact_email: string | null
  score: number
  status: string
  explanation: string
  churn_signals: string[]
  voice_notes: string
  flagged_at: string
}

export interface TrialOutreachCandidate {
  account_id: string
  account_name: string
  industry: string
  contact_email: string | null
  age_days: number
  score: number | null
  status: string | null
  voice_notes: string
  vertical_label: string
}

// Get accounts flagged for churn-save by the Health Agent
export const getChurnSaveCandidatesTool: Tool = {
  name: 'get_churn_save_candidates',
  description: 'Fetch accounts that the Health Agent flagged as at_risk or churning with a pending_growth_handoff in agent_memory. Each includes the churn signals and voice notes for the account\'s vertical.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async run(_input: Record<string, unknown>, ctx: RunContext) {
    // Find all accounts with pending growth handoffs
    const handoffs = await query<{
      entity_id: string; value: unknown
    }>(`
      SELECT entity_id, value FROM agent_memory
      WHERE agent = 'health' AND key = 'pending_growth_handoff'
    `)

    const candidates: ChurnSaveCandidate[] = []

    for (const h of handoffs) {
      const val = h.value as { score: number; status: string; explanation: string; flagged_at: string }

      const [org] = await query<{ name: string; industry: string; contact_email: string | null }>(`
        SELECT name, COALESCE(industry, 'wireless_retail') as industry, contact_email
        FROM organizations WHERE id = $1
      `, [h.entity_id])

      if (!org) continue

      const playbook = getPlaybook(org.industry)
      if (!playbook) continue

      candidates.push({
        account_id: h.entity_id,
        account_name: org.name,
        industry: org.industry,
        contact_email: org.contact_email,
        score: val.score,
        status: val.status,
        explanation: val.explanation,
        churn_signals: playbook.churnSignals,
        voice_notes: playbook.voiceNotes,
        flagged_at: val.flagged_at,
      })
    }

    return candidates
  },
}

// Get new trial accounts for warm outreach
export const getTrialOutreachCandidatesTool: Tool = {
  name: 'get_trial_outreach_candidates',
  description: 'Fetch accounts that are new trials (under 14 days old) that haven\'t been contacted by the Growth Agent yet. Each includes vertical-appropriate voice notes for drafting.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async run(_input: Record<string, unknown>, ctx: RunContext) {
    const orgs = await query<{
      id: string; name: string; industry: string; contact_email: string | null; created_at: string
    }>(`
      SELECT id, name, COALESCE(industry, 'wireless_retail') as industry, contact_email, created_at::text
      FROM organizations
      WHERE COALESCE(status, 'active') != 'deleted'
        AND created_at > NOW() - INTERVAL '14 days'
      ORDER BY created_at DESC
    `)

    const candidates: TrialOutreachCandidate[] = []

    for (const org of orgs) {
      // Check if already contacted by growth agent
      const memory = await recall('growth', 'account', org.id)
      if (memory.outreach_sent) continue

      const playbook = getPlaybook(org.industry)
      if (!playbook) continue

      // Get latest health score if available
      const [health] = await query<{ score: number; status: string }>(`
        SELECT score, status FROM account_health
        WHERE account_id = $1 ORDER BY snapshot_date DESC LIMIT 1
      `, [org.id])

      candidates.push({
        account_id: org.id,
        account_name: org.name,
        industry: org.industry,
        contact_email: org.contact_email,
        age_days: Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86400000),
        score: health?.score ?? null,
        status: health?.status ?? null,
        voice_notes: playbook.voiceNotes,
        vertical_label: playbook.label,
      })
    }

    return candidates
  },
}

// Mark a churn-save handoff as handled (clear from memory)
export const markHandoffHandledTool: Tool = {
  name: 'mark_handoff_handled',
  description: 'After drafting a churn-save email for an account, call this to clear the pending_growth_handoff flag so it doesn\'t get re-processed.',
  input_schema: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'The organization UUID' },
    },
    required: ['account_id'],
  },
  async run(input: Record<string, unknown>, ctx: RunContext) {
    const { account_id } = input as { account_id: string }
    // Update the handoff to mark it as handled
    await ctx.remember('account', account_id, 'last_save_attempt', {
      handled_at: new Date().toISOString(),
      run_id: ctx.runId,
    })
    // Remove the pending flag by overwriting with handled state
    const { query: dbQuery } = await import('@/lib/db')
    await dbQuery(
      `DELETE FROM agent_memory WHERE agent = 'health' AND entity_id = $1 AND key = 'pending_growth_handoff'`,
      [account_id]
    )
    return { ok: true }
  },
}

// Mark trial outreach as sent (so we don't re-send)
export const markOutreachSentTool: Tool = {
  name: 'mark_outreach_sent',
  description: 'After drafting a trial outreach email, call this to record it so we don\'t send duplicate outreach.',
  input_schema: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'The organization UUID' },
    },
    required: ['account_id'],
  },
  async run(input: Record<string, unknown>, ctx: RunContext) {
    const { account_id } = input as { account_id: string }
    await ctx.remember('account', account_id, 'outreach_sent', {
      sent_at: new Date().toISOString(),
      run_id: ctx.runId,
    })
    return { ok: true }
  },
}
