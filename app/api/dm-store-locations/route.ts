import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner, type Role } from '@/lib/auth'
import { query } from '@/lib/db'

const canManage = (role: Role) => isOwner(role) || role === 'developer'
const canView = (role: Role) => role !== 'employee'

let ensured = false
async function ensureTables() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS dm_store_locations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      address    TEXT NOT NULL,
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE dm_store_locations ADD COLUMN IF NOT EXISTS org_id UUID`)
  await query(`ALTER TABLE dm_store_locations ADD COLUMN IF NOT EXISTS employee_capacity SMALLINT NOT NULL DEFAULT 1`)
  await query(`ALTER TABLE dm_store_locations ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`)
  await query(`ALTER TABLE dm_store_locations ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`)
  await query(`
    CREATE TABLE IF NOT EXISTS dm_manager_stores (
      manager_id        UUID NOT NULL,
      store_location_id UUID NOT NULL REFERENCES dm_store_locations(id) ON DELETE CASCADE,
      PRIMARY KEY (manager_id, store_location_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_manager_stores_manager ON dm_manager_stores(manager_id)`)
  await query(`
    CREATE TABLE IF NOT EXISTS store_hours (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id        UUID NOT NULL REFERENCES dm_store_locations(id) ON DELETE CASCADE,
      day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      open_time       TIME,
      close_time      TIME,
      is_closed       BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE (store_id, day_of_week)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_store_hours_store ON store_hours(store_id)`)
}

// Seed default hours: Mon-Sat 10:00-19:00, Sun 12:00-17:00
// day_of_week: 0=Sun, 1=Mon, ..., 6=Sat
async function seedDefaultHours(storeId: string) {
  const defaults = [
    { day: 0, open: '12:00', close: '17:00' }, // Sun
    { day: 1, open: '10:00', close: '19:00' }, // Mon
    { day: 2, open: '10:00', close: '19:00' }, // Tue
    { day: 3, open: '10:00', close: '19:00' }, // Wed
    { day: 4, open: '10:00', close: '19:00' }, // Thu
    { day: 5, open: '10:00', close: '19:00' }, // Fri
    { day: 6, open: '10:00', close: '19:00' }, // Sat
  ]
  for (const d of defaults) {
    await query(
      `INSERT INTO store_hours (store_id, day_of_week, open_time, close_time, is_closed)
       VALUES ($1, $2, $3, $4, FALSE) ON CONFLICT (store_id, day_of_week) DO NOTHING`,
      [storeId, d.day, d.open, d.close]
    )
  }
}

interface StoreRow {
  id: string
  address: string
  active: boolean
  org_id: string | null
  org_name: string | null
  employee_capacity: number
  lat: number | null
  lng: number | null
  geofence_radius_ft: number | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canView(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTables() } catch { /* already exists */ }

  // Helper: attach hours to locations
  type HoursRow = { store_id: string; day_of_week: number; open_time: string | null; close_time: string | null; is_closed: boolean }
  async function attachHours(locations: StoreRow[]) {
    if (!locations.length) return locations.map(l => ({ ...l, hours: [] }))
    const ids = locations.map(l => l.id)
    const hours = await query<HoursRow>(
      `SELECT store_id, day_of_week, open_time::text, close_time::text, is_closed FROM store_hours WHERE store_id = ANY($1) ORDER BY day_of_week`,
      [ids]
    )
    const byStore = new Map<string, HoursRow[]>()
    for (const h of hours) {
      if (!byStore.has(h.store_id)) byStore.set(h.store_id, [])
      byStore.get(h.store_id)!.push(h)
    }
    return locations.map(l => ({ ...l, hours: byStore.get(l.id) ?? [] }))
  }

  // Managers only see their assigned active locations
  if (session.role === 'manager') {
    const assigned = await query<{ store_location_id: string }>(
      `SELECT store_location_id FROM dm_manager_stores WHERE manager_id = $1`,
      [session.id]
    )
    if (assigned.length === 0) return NextResponse.json({ locations: [] })
    const ids = assigned.map(r => r.store_location_id)
    const locations = await query<StoreRow>(
      `SELECT s.id, s.address, s.active, s.org_id, o.name AS org_name, s.employee_capacity, s.lat, s.lng, s.geofence_radius_ft, s.created_at
       FROM dm_store_locations s
       LEFT JOIN organizations o ON o.id = s.org_id
       WHERE s.id = ANY($1) AND s.active = true ORDER BY s.address ASC`,
      [ids]
    )
    return NextResponse.json({ locations: await attachHours(locations) })
  }

  // Developer always sees all stores across all orgs
  if (session.role === 'developer') {
    const locations = await query<StoreRow>(
      `SELECT s.id, s.address, s.active, s.org_id, o.name AS org_name, s.employee_capacity, s.lat, s.lng, s.geofence_radius_ft, s.created_at
       FROM dm_store_locations s
       LEFT JOIN organizations o ON o.id = s.org_id
       ORDER BY o.name NULLS LAST, s.address ASC`
    )
    return NextResponse.json({ locations: await attachHours(locations) })
  }

  // Everyone else: org-scoped (their org + unassigned)
  const orgId = session.org_id ?? null
  if (orgId) {
    const locations = await query<StoreRow>(
      `SELECT s.id, s.address, s.active, s.org_id, o.name AS org_name, s.employee_capacity, s.lat, s.lng, s.geofence_radius_ft, s.created_at
       FROM dm_store_locations s
       LEFT JOIN organizations o ON o.id = s.org_id
       WHERE (s.org_id = $1 OR s.org_id IS NULL) AND s.active = true
       ORDER BY s.address ASC`,
      [orgId]
    )
    return NextResponse.json({ locations: await attachHours(locations) })
  }

  // No org — return all active
  const locations = await query<StoreRow>(
    `SELECT s.id, s.address, s.active, s.org_id, o.name AS org_name, s.employee_capacity, s.lat, s.lng, s.geofence_radius_ft, s.created_at
     FROM dm_store_locations s
     LEFT JOIN organizations o ON o.id = s.org_id
     WHERE s.active = true ORDER BY s.address ASC`
  )
  return NextResponse.json({ locations: await attachHours(locations) })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManage(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTables() } catch { /* already exists */ }

  const body = await req.json()

  // Bulk insert — accepts { addresses: string[], org_id?: string }
  if (Array.isArray(body.addresses)) {
    const addrs = body.addresses.map((a: string) => a.trim()).filter(Boolean)
    if (addrs.length === 0) return NextResponse.json({ error: 'No addresses provided' }, { status: 400 })
    const orgId = body.org_id || null
    try {
      const BATCH = 20
      let total = 0
      for (let i = 0; i < addrs.length; i += BATCH) {
        const batch = addrs.slice(i, i + BATCH)
        const placeholders = batch.map((_: string, j: number) => `($${j + 1}, $${addrs.length + 1})`).join(', ')
        await query(
          `INSERT INTO dm_store_locations (address, org_id) VALUES ${placeholders}`,
          [...batch, orgId]
        )
        total += batch.length
      }
      return NextResponse.json({ count: total })
    } catch (err) {
      console.error('Bulk insert error:', err)
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // Single insert
  const { address, org_id, lat, lng } = body
  if (!address?.trim()) return NextResponse.json({ error: 'Address required' }, { status: 400 })

  const [loc] = await query<{ id: string; address: string; active: boolean }>(
    `INSERT INTO dm_store_locations (address, org_id, lat, lng) VALUES ($1, $2, $3, $4) RETURNING id, address, active`,
    [address.trim(), org_id || null, lat ?? null, lng ?? null]
  )

  // Seed default store hours: Mon-Sat 10:00-19:00, Sun 12:00-17:00
  await seedDefaultHours(loc.id).catch(() => {})

  return NextResponse.json({ location: loc })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Managers can update employee_capacity only on their assigned stores
  if (session.role === 'manager') {
    const { id, employee_capacity } = body
    if (!id || employee_capacity === undefined || Array.isArray(body.ids)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const assigned = await query<{ store_location_id: string }>(
      `SELECT store_location_id FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, id]
    )
    if (assigned.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await query(`UPDATE dm_store_locations SET employee_capacity = $1 WHERE id = $2`, [employee_capacity, id])
    return NextResponse.json({ ok: true })
  }

  if (!canManage(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Bulk update — { ids: string[], employee_capacity? | org_id? }
  if (Array.isArray(body.ids)) {
    if (body.employee_capacity !== undefined) {
      await query(
        `UPDATE dm_store_locations SET employee_capacity = $1 WHERE id = ANY($2)`,
        [body.employee_capacity, body.ids]
      )
    } else {
      await query(
        `UPDATE dm_store_locations SET org_id = $1 WHERE id = ANY($2)`,
        [body.org_id || null, body.ids]
      )
    }
    return NextResponse.json({ ok: true, count: body.ids.length })
  }

  // Single update
  const { id, active, address, org_id, employee_capacity, lat, lng, geofence_radius_ft } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (address !== undefined) await query(`UPDATE dm_store_locations SET address = $1 WHERE id = $2`, [address, id])
  if (active !== undefined) await query(`UPDATE dm_store_locations SET active = $1 WHERE id = $2`, [active, id])
  if (org_id !== undefined) await query(`UPDATE dm_store_locations SET org_id = $1 WHERE id = $2`, [org_id || null, id])
  if (employee_capacity !== undefined) await query(`UPDATE dm_store_locations SET employee_capacity = $1 WHERE id = $2`, [employee_capacity, id])
  if (lat !== undefined) await query(`UPDATE dm_store_locations SET lat = $1 WHERE id = $2`, [lat, id])
  if (lng !== undefined) await query(`UPDATE dm_store_locations SET lng = $1 WHERE id = $2`, [lng, id])
  if (geofence_radius_ft !== undefined) await query(`UPDATE dm_store_locations SET geofence_radius_ft = $1 WHERE id = $2`, [geofence_radius_ft === null || geofence_radius_ft === '' ? null : Number(geofence_radius_ft), id])

  // Update store hours — accepts { hours: [{ day_of_week, open_time, close_time, is_closed }] }
  if (Array.isArray(body.hours)) {
    for (const h of body.hours) {
      if (h.day_of_week === undefined) continue
      await query(
        `INSERT INTO store_hours (store_id, day_of_week, open_time, close_time, is_closed)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (store_id, day_of_week) DO UPDATE SET open_time = $3, close_time = $4, is_closed = $5`,
        [id, h.day_of_week, h.is_closed ? null : h.open_time, h.is_closed ? null : h.close_time, !!h.is_closed]
      )
    }
  }

  // Seed default hours if requested
  if (body.seedHours) await seedDefaultHours(id).catch(() => {})

  return NextResponse.json({ ok: true })
}
