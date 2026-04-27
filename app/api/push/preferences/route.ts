import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id UUID PRIMARY KEY,
      task_assigned BOOLEAN NOT NULL DEFAULT true,
      checklist_submitted BOOLEAN NOT NULL DEFAULT true,
      flag_created BOOLEAN NOT NULL DEFAULT true,
      expense_submitted BOOLEAN NOT NULL DEFAULT true,
      schedule_published BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch { /* already exists */ }

  const prefs = await queryOne(
    `SELECT task_assigned, checklist_submitted, flag_created, expense_submitted, schedule_published
     FROM notification_preferences WHERE user_id = $1`,
    [session.id]
  )

  // Return defaults if no row yet
  return NextResponse.json({
    prefs: prefs ?? {
      task_assigned: true,
      checklist_submitted: true,
      flag_created: true,
      expense_submitted: true,
      schedule_published: true,
    }
  })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch { /* already exists */ }

  const body = await req.json()
  const allowed = ['task_assigned', 'checklist_submitted', 'flag_created', 'expense_submitted', 'schedule_published']

  // Build update clause from only valid keys
  const updates: string[] = []
  const values: unknown[] = [session.id]
  for (const key of allowed) {
    if (typeof body[key] === 'boolean') {
      values.push(body[key])
      updates.push(`${key} = $${values.length}`)
    }
  }

  if (!updates.length) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  await query(
    `INSERT INTO notification_preferences (user_id, ${updates.map(u => u.split(' = ')[0]).join(', ')})
     VALUES ($1, ${values.slice(1).map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}, updated_at = NOW()`,
    values
  )

  return NextResponse.json({ ok: true })
}
