import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CONFIG_KEYS = [
  'schedule_submit_notify_manager',
  'schedule_submit_notify_developer',
  'weekly_report_enabled',
  'flag_alert_notify_manager',
]

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM dev_config WHERE key = ANY($1)`,
    [CONFIG_KEYS]
  )

  const config: Record<string, string> = {}
  for (const key of CONFIG_KEYS) {
    const row = rows.find(r => r.key === key)
    config[key] = row?.value ?? 'true'
  }

  return NextResponse.json({ config })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()

  for (const key of CONFIG_KEYS) {
    if (key in body) {
      const value = String(body[key])
      await queryOne(
        `INSERT INTO dev_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, value]
      )
    }
  }

  return NextResponse.json({ ok: true })
}
