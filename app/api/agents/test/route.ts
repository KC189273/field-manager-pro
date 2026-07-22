import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { computeAllAccountSignals } from '@/lib/agents/tools/db.read'
import { getPlaybook } from '@/lib/agents/verticals'

// Regression test endpoint — developer only
// Validates that signals, scoring, and vertical mapping are working correctly
export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const results: {
    test: string
    passed: boolean
    detail: string
  }[] = []

  // 1. Signal computation doesn't crash
  let signals: Awaited<ReturnType<typeof computeAllAccountSignals>> = []
  try {
    signals = await computeAllAccountSignals()
    results.push({ test: 'Signal computation runs', passed: true, detail: `${signals.length} accounts computed` })
  } catch (e) {
    results.push({ test: 'Signal computation runs', passed: false, detail: String(e) })
    return NextResponse.json({ results, passed: false })
  }

  // 2. Every account has a supported vertical (no unsupported_vertical flags)
  const unsupported = signals.filter(s => s.unsupported_vertical)
  results.push({
    test: 'All accounts have supported verticals',
    passed: unsupported.length === 0,
    detail: unsupported.length === 0
      ? 'All verticals mapped'
      : `Unsupported: ${unsupported.map(s => `${s.account_name} (${s.industry})`).join(', ')}`,
  })

  // 3. Every supported vertical has a playbook
  const orgs = await query<{ industry: string }>(`SELECT DISTINCT COALESCE(industry, 'unknown') as industry FROM organizations`)
  for (const org of orgs) {
    const playbook = getPlaybook(org.industry)
    results.push({
      test: `Playbook exists for "${org.industry}"`,
      passed: !!playbook,
      detail: playbook ? `${playbook.activationMilestones.length} milestones, ${playbook.churnSignals.length} churn signals` : 'No playbook found',
    })
  }

  // 4. Known accounts haven't shifted dramatically from expected ranges
  const expectations: Record<string, { minScore: number; maxScore: number; name: string }> = {
    '4395bc4f-0571-4c6d-8c93-f7d4edfb6997': { name: 'Wireless Game Group LLC', minScore: 70, maxScore: 100 },
    '0acb5d51-ca9f-4d0e-9e07-47c408ac5856': { name: 'James Cuts', minScore: 30, maxScore: 90 },
  }

  const latestHealth = await query<{ account_id: string; score: number; status: string }>(`
    SELECT DISTINCT ON (account_id) account_id, score, status
    FROM account_health ORDER BY account_id, snapshot_date DESC
  `)

  for (const h of latestHealth) {
    const expected = expectations[h.account_id]
    if (!expected) continue
    const inRange = h.score >= expected.minScore && h.score <= expected.maxScore
    results.push({
      test: `${expected.name} score regression`,
      passed: inRange,
      detail: `Score: ${h.score} (expected ${expected.minScore}-${expected.maxScore}), status: ${h.status}`,
    })
  }

  // 5. Signals have reasonable values (engagement % between 0-100, no negative activity)
  for (const s of signals) {
    if (s.unsupported_vertical) continue
    const sane = s.user_engagement_pct >= 0 && s.user_engagement_pct <= 100 &&
      s.activity_count_7d >= 0 && s.activity_count_prev_7d >= 0 &&
      s.total_users >= 0
    results.push({
      test: `${s.account_name} signal sanity`,
      passed: sane,
      detail: `engagement: ${s.user_engagement_pct}%, activity_7d: ${s.activity_count_7d}, users: ${s.total_users}`,
    })
  }

  // 6. Idempotency: verify the function exists and returns boolean
  const { isDuplicate } = await import('@/lib/agents/runtime/guardrails')
  const dupResult = await isDuplicate('test_agent', '00000000-0000-0000-0000-000000000000', 'test_type')
  results.push({
    test: 'Idempotency check works',
    passed: typeof dupResult === 'boolean',
    detail: `isDuplicate returned: ${dupResult}`,
  })

  // 7. Kill switch check
  const { agentsEnabled } = await import('@/lib/agents/runtime/guardrails')
  results.push({
    test: 'Kill switch readable',
    passed: typeof agentsEnabled() === 'boolean',
    detail: `AGENTS_ENABLED = ${agentsEnabled()}`,
  })

  const allPassed = results.every(r => r.passed)

  return NextResponse.json({ passed: allPassed, results })
}
