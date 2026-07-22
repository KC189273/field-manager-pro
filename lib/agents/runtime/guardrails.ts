import { query, queryOne } from '@/lib/db'
import type { ActionType, Risk } from '../types'

// ── Kill switch ──────────────────────────────────────────────────────────────
export function agentsEnabled(): boolean {
  return process.env.AGENTS_ENABLED !== 'false'
}

// ── Autonomy policy ──────────────────────────────────────────────────────────
// Default deny: only explicitly listed low-risk actions auto-execute.
// Everything else goes to the review queue.
const LOW_RISK_ACTIONS: Set<ActionType> = new Set([
  'health_snapshot',
  'note',
])

export function resolveRisk(actionType: ActionType, agentDefault: Risk): Risk {
  if (LOW_RISK_ACTIONS.has(actionType)) return 'low'
  return 'high'
}

// ── Cost cap ─────────────────────────────────────────────────────────────────
const MODEL_COST_PER_1K = {
  input: 0.001,   // Haiku-class pricing (conservative default)
  output: 0.005,
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1000) * MODEL_COST_PER_1K.input +
         (outputTokens / 1000) * MODEL_COST_PER_1K.output
}

const PER_RUN_USD_CAP = 0.50

export function checkRunCostCap(inputTokens: number, outputTokens: number): void {
  const cost = estimateCost(inputTokens, outputTokens)
  if (cost > PER_RUN_USD_CAP) {
    throw new Error(`Run cost cap exceeded: $${cost.toFixed(4)} > $${PER_RUN_USD_CAP}`)
  }
}

export async function checkDailyCostCap(): Promise<void> {
  const cap = parseFloat(process.env.AGENTS_DAILY_USD_CAP ?? '2')
  const row = await queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(cost_usd), 0)::float AS total
    FROM agent_runs
    WHERE created_at >= CURRENT_DATE
  `)
  const spent = row?.total ?? 0
  if (spent >= cap) {
    throw new Error(`Daily cost cap reached: $${spent.toFixed(4)} >= $${cap}`)
  }
}

// ── PII scrub ────────────────────────────────────────────────────────────────
// Strip obvious PII patterns before sending context to Claude
const PII_PATTERNS = [
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,  // card numbers
  /\b\d{3}-\d{2}-\d{4}\b/g,                       // SSN
  /password\s*[:=]\s*\S+/gi,                       // password assignments
]

export function scrubPII(text: string): string {
  let clean = text
  for (const pat of PII_PATTERNS) {
    clean = clean.replace(pat, '[REDACTED]')
  }
  return clean
}

// ── Idempotency check ────────────────────────────────────────────────────────
// Prevent duplicate actions for the same (agent, account_id, day)
export async function isDuplicate(agent: string, accountId: string | undefined, actionType: string): Promise<boolean> {
  if (!accountId) return false
  const row = await queryOne<{ exists: boolean }>(`
    SELECT EXISTS(
      SELECT 1 FROM agent_actions
      WHERE agent = $1 AND account_id = $2 AND type = $3
        AND created_at >= CURRENT_DATE
    ) AS exists
  `, [agent, accountId, actionType])
  return row?.exists ?? false
}
