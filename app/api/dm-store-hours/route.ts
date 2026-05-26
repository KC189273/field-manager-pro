import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// 0=Sunday, 1=Monday … 6=Saturday
const DEFAULT_HOURS = [
  { day_of_week: 0, open_time: '12:00', close_time: '17:00', is_closed: false },
  { day_of_week: 1, open_time: '10:00', close_time: '19:00', is_closed: false },
  { day_of_week: 2, open_time: '10:00', close_time: '19:00', is_closed: false },
  { day_of_week: 3, open_time: '10:00', close_time: '19:00', is_closed: false },
  { day_of_week: 4, open_time: '10:00', close_time: '19:00', is_closed: false },
  { day_of_week: 5, open_time: '10:00', close_time: '19:00', is_closed: false },
  { day_of_week: 6, open_time: '10:00', close_time: '19:00', is_closed: false },
]

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS dm_store_hours (
      store_location_id UUID NOT NULL REFERENCES dm_store_locations(id) ON DELETE CASCADE,
      day_of_week       SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      open_time         TIME NOT NULL DEFAULT '10:00',
      close_time        TIME NOT NULL DEFAULT '19:00',
      is_closed         BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (store_location_id, day_of_week)
    )
  `)
}

interface HoursRow {
  day_of_week: number
  open_time: string
  close_time: string
  is_closed: boolean
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const storeId = new URL(req.url).searchParams.get('storeId')
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 })

  try { await ensureTable() } catch {}

  const rows = await query<HoursRow>(
    `SELECT day_of_week, open_time::text, close_time::text, is_closed
     FROM dm_store_hours WHERE store_location_id = $1 ORDER BY day_of_week`,
    [storeId]
  )

  if (rows.length < 7) {
    const existing = new Map(rows.map(r => [r.day_of_week, r]))
    const hours = DEFAULT_HOURS.map(d => existing.get(d.day_of_week) ?? { ...d })
    return NextResponse.json({ hours })
  }

  return NextResponse.json({ hours: rows })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const canManage = ['owner', 'sales_director', 'ops_manager', 'developer', 'manager'].includes(session.role)
  if (!canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { storeId, hours } = await req.json()

  // Managers can only edit hours for stores assigned to them
  if (session.role === 'manager') {
    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, storeId]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!storeId || !Array.isArray(hours)) {
    return NextResponse.json({ error: 'storeId and hours required' }, { status: 400 })
  }

  try { await ensureTable() } catch {}

  for (const h of hours as HoursRow[]) {
    await query(
      `INSERT INTO dm_store_hours (store_location_id, day_of_week, open_time, close_time, is_closed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (store_location_id, day_of_week) DO UPDATE
       SET open_time = EXCLUDED.open_time,
           close_time = EXCLUDED.close_time,
           is_closed = EXCLUDED.is_closed`,
      [storeId, h.day_of_week, h.open_time, h.close_time, h.is_closed]
    )
  }

  return NextResponse.json({ ok: true })
}
