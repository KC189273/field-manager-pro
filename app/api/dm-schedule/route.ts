import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS dm_weekly_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      dm_id UUID NOT NULL,
      dm_name TEXT NOT NULL,
      week_start DATE NOT NULL,
      schedule JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(dm_id, week_start)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_weekly_sched_dm ON dm_weekly_schedules(dm_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_weekly_sched_week ON dm_weekly_schedules(week_start)`)
}

const canViewAll = (role: string) =>
  role === 'sales_director' || role === 'owner' || role === 'developer'

// GET — fetch schedule(s) for a week
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch {}

  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('weekStart')
  const dmId = searchParams.get('dmId')

  if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = [weekStart]
  let where = 'WHERE s.week_start = $1'

  if (canViewAll(session.role)) {
    // SD/owner/developer can see all DMs in their org
    if (orgFilter.filterByOrg && orgFilter.orgId) {
      params.push(orgFilter.orgId)
      where += ` AND s.org_id = $${params.length}`
    }
    if (dmId) {
      params.push(dmId)
      where += ` AND s.dm_id = $${params.length}`
    }
  } else {
    // DMs/ops_managers only see their own
    params.push(session.id)
    where += ` AND s.dm_id = $${params.length}`
  }

  const schedules = await query<{
    id: string; dm_id: string; dm_name: string; week_start: string
    schedule: string; updated_at: string
  }>(`
    SELECT s.id, s.dm_id, s.dm_name, s.week_start::text, s.schedule::text, s.updated_at::text
    FROM dm_weekly_schedules s
    ${where}
    ORDER BY s.dm_name
  `, params)

  // Parse the JSON schedule field
  const parsed = schedules.map(s => ({
    ...s,
    schedule: JSON.parse(s.schedule),
  }))

  return NextResponse.json({ schedules: parsed })
}

// POST — save/update a DM's weekly schedule
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'manager' && session.role !== 'developer') {
    return NextResponse.json({ error: 'Only DMs can submit schedules' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const { weekStart, schedule } = await req.json()
  if (!weekStart || !Array.isArray(schedule)) {
    return NextResponse.json({ error: 'weekStart and schedule array required' }, { status: 400 })
  }

  // schedule is an array of 7 objects (Mon-Sun):
  // { day: 0-6, working: boolean, locations: [{ store_id, store_address, reason }] }

  const [row] = await query<{ id: string }>(`
    INSERT INTO dm_weekly_schedules (org_id, dm_id, dm_name, week_start, schedule)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (dm_id, week_start) DO UPDATE SET
      schedule = $5, dm_name = $3, updated_at = NOW()
    RETURNING id
  `, [session.org_id ?? null, session.id, session.fullName, weekStart, JSON.stringify(schedule)])

  return NextResponse.json({ ok: true, id: row.id })
}
