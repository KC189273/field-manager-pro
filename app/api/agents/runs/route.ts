import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const runs = await query<{
    id: string; agent: string; trigger: string; status: string
    summary: string | null; input_tokens: number; output_tokens: number
    cost_usd: number; error: string | null; created_at: string; finished_at: string | null
  }>(`
    SELECT id, agent, trigger, status, summary, input_tokens, output_tokens,
      cost_usd::float, error, created_at::text, finished_at::text
    FROM agent_runs
    ORDER BY created_at DESC
    LIMIT 50
  `)

  // Daily spend
  const [spend] = await query<{ today: number; total: number }>(`
    SELECT
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= CURRENT_DATE), 0)::float AS today,
      COALESCE(SUM(cost_usd), 0)::float AS total
    FROM agent_runs
  `)

  return NextResponse.json({ runs, spend })
}
