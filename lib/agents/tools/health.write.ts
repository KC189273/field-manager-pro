import { queryOne } from '@/lib/db'
import type { Tool, RunContext } from '../types'

export const writeHealthSnapshotTool: Tool = {
  name: 'write_health_snapshot',
  description: 'Write a health score snapshot for one account. The score (0-100), status (healthy/watch/at_risk/churning), and explanation are recorded. If status is at_risk or churning, set handoff_growth=true to flag for future Growth Agent outreach.',
  input_schema: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'The organization UUID' },
      score: { type: 'number', description: 'Health score 0-100' },
      status: { type: 'string', enum: ['healthy', 'watch', 'at_risk', 'churning'], description: 'Health status band' },
      explanation: { type: 'string', description: 'One or two sentences explaining the main driver of this score' },
      active_users_7d: { type: 'number', description: 'Number of users active in the last 7 days' },
      last_activity_at: { type: 'string', description: 'ISO timestamp of last activity, or null' },
      signals: { type: 'object', description: 'The raw signal data that drove this score' },
      handoff_growth: { type: 'boolean', description: 'If true, flags this account for Growth Agent follow-up' },
    },
    required: ['account_id', 'score', 'status', 'explanation'],
  },
  async run(input: Record<string, unknown>, ctx: RunContext) {
    const {
      account_id, score, status, explanation,
      active_users_7d, last_activity_at, signals, handoff_growth,
    } = input as {
      account_id: string; score: number; status: string; explanation: string
      active_users_7d?: number; last_activity_at?: string | null
      signals?: Record<string, unknown>; handoff_growth?: boolean
    }

    // Write the health snapshot (upsert by account + date)
    await queryOne(`
      INSERT INTO account_health (account_id, score, status, active_users_7d, last_activity_at, signals)
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
      ON CONFLICT (account_id, snapshot_date) DO UPDATE SET
        score = $2, status = $3, active_users_7d = $4,
        last_activity_at = $5::timestamptz, signals = $6
    `, [
      account_id, score, status,
      active_users_7d ?? null,
      last_activity_at ?? null,
      JSON.stringify({ ...signals, explanation }),
    ])

    // Draft a low-risk health_snapshot action for the audit trail
    await ctx.draftAction({
      type: 'health_snapshot',
      risk_level: 'low',
      account_id,
      reason: explanation,
      payload: { score, status, handoff_growth: !!handoff_growth },
    })

    // If at_risk or churning, flag for Growth Agent handoff
    if (handoff_growth && (status === 'at_risk' || status === 'churning')) {
      await ctx.remember('account', account_id, 'pending_growth_handoff', {
        status,
        score,
        explanation,
        flagged_at: new Date().toISOString(),
      })
    }

    return { ok: true, account_id, score, status }
  },
}
