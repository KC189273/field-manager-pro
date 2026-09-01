import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !['ops_manager', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { updates } = await req.json() as { updates: Array<{ key: string; value: unknown }> }
  if (!Array.isArray(updates)) return NextResponse.json({ error: 'updates array required' }, { status: 400 })

  for (const { key, value } of updates) {
    await query(
      `INSERT INTO dev_config (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    )
  }

  return NextResponse.json({ ok: true })
}
