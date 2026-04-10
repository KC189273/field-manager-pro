import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner, type Role } from '@/lib/auth'
import { query } from '@/lib/db'

const canManage = (role: Role) => isOwner(role) || role === 'developer'
const canView = (role: Role) => role !== 'employee'

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS dm_store_locations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      address    TEXT NOT NULL,
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE dm_store_locations ADD COLUMN IF NOT EXISTS org_id UUID`)
  await query(`
    CREATE TABLE IF NOT EXISTS dm_manager_stores (
      manager_id        UUID NOT NULL,
      store_location_id UUID NOT NULL REFERENCES dm_store_locations(id) ON DELETE CASCADE,
      PRIMARY KEY (manager_id, store_location_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_manager_stores_manager ON dm_manager_stores(manager_id)`)
}

interface StoreRow {
  id: string
  address: string
  active: boolean
  org_id: string | null
  org_name: string | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canView(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTables() } catch { /* already exists */ }

  // Managers with assigned stores only see their assigned active locations
  if (session.role === 'manager') {
    const assigned = await query<{ store_location_id: string }>(
      `SELECT store_location_id FROM dm_manager_stores WHERE manager_id = $1`,
      [session.id]
    )
    if (assigned.length > 0) {
      const ids = assigned.map(r => r.store_location_id)
      const locations = await query<StoreRow>(
        `SELECT s.id, s.address, s.active, s.org_id, o.name AS org_name, s.created_at
         FROM dm_store_locations s
         LEFT JOIN organizations o ON o.id = s.org_id
         WHERE s.id = ANY($1) AND s.active = true ORDER BY s.address ASC`,
        [ids]
      )
      return NextResponse.json({ locations })
    }
  }

  // Developer sees all stores
  if (session.role === 'developer') {
    const locations = await query<StoreRow>(
      `SELECT s.id, s.address, s.active, s.org_id, o.name AS org_name, s.created_at
       FROM dm_store_locations s
       LEFT JOIN organizations o ON o.id = s.org_id
       ORDER BY o.name NULLS LAST, s.address ASC`
    )
    return NextResponse.json({ locations })
  }

  // Everyone else: org-scoped (their org + unassigned)
  const orgId = session.org_id ?? null
  if (orgId) {
    const locations = await query<StoreRow>(
      `SELECT s.id, s.address, s.active, s.org_id, o.name AS org_name, s.created_at
       FROM dm_store_locations s
       LEFT JOIN organizations o ON o.id = s.org_id
       WHERE (s.org_id = $1 OR s.org_id IS NULL) AND s.active = true
       ORDER BY s.address ASC`,
      [orgId]
    )
    return NextResponse.json({ locations })
  }

  // No org — return all active
  const locations = await query<StoreRow>(
    `SELECT s.id, s.address, s.active, s.org_id, o.name AS org_name, s.created_at
     FROM dm_store_locations s
     LEFT JOIN organizations o ON o.id = s.org_id
     WHERE s.active = true ORDER BY s.address ASC`
  )
  return NextResponse.json({ locations })
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
  const { address, org_id } = body
  if (!address?.trim()) return NextResponse.json({ error: 'Address required' }, { status: 400 })

  const [loc] = await query<{ id: string; address: string; active: boolean }>(
    `INSERT INTO dm_store_locations (address, org_id) VALUES ($1, $2) RETURNING id, address, active`,
    [address.trim(), org_id || null]
  )

  return NextResponse.json({ location: loc })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManage(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()

  // Bulk org assignment — { ids: string[], org_id: string | null }
  if (Array.isArray(body.ids)) {
    await query(
      `UPDATE dm_store_locations SET org_id = $1 WHERE id = ANY($2)`,
      [body.org_id || null, body.ids]
    )
    return NextResponse.json({ ok: true, count: body.ids.length })
  }

  // Single update
  const { id, active, address, org_id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (address !== undefined) await query(`UPDATE dm_store_locations SET address = $1 WHERE id = $2`, [address, id])
  if (active !== undefined) await query(`UPDATE dm_store_locations SET active = $1 WHERE id = $2`, [active, id])
  if (org_id !== undefined) await query(`UPDATE dm_store_locations SET org_id = $1 WHERE id = $2`, [org_id || null, id])

  return NextResponse.json({ ok: true })
}
