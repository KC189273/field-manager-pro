import { NextRequest, NextResponse } from 'next/server'
import { runAgent } from '@/lib/agents/runtime/orchestrator'
import type { AgentKey, TriggerType } from '@/lib/agents/types'

const VALID_AGENTS: AgentKey[] = ['health', 'onboarding', 'support', 'growth']

export async function POST(req: NextRequest) {
  // Auth: cron secret or developer session
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const agentKey = (searchParams.get('agent') ?? '') as AgentKey
  const trigger = (searchParams.get('trigger') ?? 'cron') as TriggerType
  const input = searchParams.get('input') ?? undefined

  if (!VALID_AGENTS.includes(agentKey)) {
    return NextResponse.json({ error: `Invalid agent: ${agentKey}. Valid: ${VALID_AGENTS.join(', ')}` }, { status: 400 })
  }

  try {
    const result = await runAgent(agentKey, trigger, input)
    return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 500 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Also support GET for Vercel Cron (crons use GET)
export async function GET(req: NextRequest) {
  return POST(req)
}
