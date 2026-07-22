import { query, queryOne } from '@/lib/db'
import { getPlaybook } from '../verticals'
import type { Tool, RunContext } from '../types'

export interface OnboardingCandidate {
  account_id: string
  account_name: string
  industry: string
  contact_email: string | null
  age_days: number
  milestones: { key: string; label: string; description: string; done: boolean }[]
  first_incomplete: { key: string; label: string; description: string } | null
  completion_pct: number
  unsupported_vertical: boolean
}

// Get all accounts eligible for onboarding nudges
export const getOnboardingCandidatesTool: Tool = {
  name: 'get_onboarding_candidates',
  description: 'Fetch accounts under 30 days old that haven\'t completed all activation milestones. For each account, shows which milestones are done and which is the next one to complete. Milestones are vertical-specific (retail vs barbershop).',
  input_schema: { type: 'object', properties: {}, required: [] },
  async run(_input: Record<string, unknown>, _ctx: RunContext) {
    const orgs = await query<{
      id: string; name: string; industry: string; contact_email: string | null; created_at: string
    }>(`
      SELECT id, name, COALESCE(industry, 'wireless_retail') as industry,
        contact_email, created_at::text
      FROM organizations
      WHERE COALESCE(status, 'active') != 'deleted'
        AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY name
    `)

    const candidates: OnboardingCandidate[] = []

    for (const org of orgs) {
      const playbook = getPlaybook(org.industry)

      if (!playbook) {
        candidates.push({
          account_id: org.id,
          account_name: org.name,
          industry: org.industry,
          contact_email: org.contact_email,
          age_days: Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86400000),
          milestones: [],
          first_incomplete: null,
          completion_pct: 0,
          unsupported_vertical: true,
        })
        continue
      }

      const milestones: OnboardingCandidate['milestones'] = []
      let firstIncomplete: OnboardingCandidate['first_incomplete'] = null

      for (const m of playbook.activationMilestones) {
        const row = await queryOne<{ done: boolean }>(m.checkSql, [org.id])
        const done = row?.done ?? false
        milestones.push({ key: m.key, label: m.label, description: m.description, done })
        if (!done && !firstIncomplete) {
          firstIncomplete = { key: m.key, label: m.label, description: m.description }
        }
      }

      const completedCount = milestones.filter(m => m.done).length
      const completionPct = Math.round((completedCount / milestones.length) * 100)

      // Only include if not fully complete
      if (completionPct < 100) {
        candidates.push({
          account_id: org.id,
          account_name: org.name,
          industry: org.industry,
          contact_email: org.contact_email,
          age_days: Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86400000),
          milestones,
          first_incomplete: firstIncomplete,
          completion_pct: completionPct,
          unsupported_vertical: false,
        })
      }
    }

    return candidates
  },
}
