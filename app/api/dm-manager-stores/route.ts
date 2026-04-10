import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner, type Role } from '@/lib/auth'
import { query } from '@/lib/db'

const canManage = (role: Role) => role === 'ops_manager' || isOwner(role) || role === 'developer'

// Also auto-create dm_store_visits table if needed
async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS dm_store_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      address TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS dm_manager_stores (
      manager_id UUID NOT NULL,
      store_location_id UUID NOT NULL REFERENCES dm_store_locations(id) ON DELETE CASCADE,
      PRIMARY KEY (manager_id, store_location_id)
    )
  `)
}

// GET ?managerId=  — returns assigned store IDs for a manager
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTables() } catch { /* already exists */ }

  const managerId = new URL(req.url).searchParams.get('managerId')
  if (!managerId) return NextResponse.json({ error: 'managerId required' }, { status: 400 })

  const rows = await query<{ store_location_id: string }>(
    `SELECT store_location_id FROM dm_manager_stores WHERE manager_id = $1`,
    [managerId]
  )

  return NextResponse.json({ storeIds: rows.map(r => r.store_location_id) })
}

// POST { managerId, storeIds[] } — replaces all assignments for a manager
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManage(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTables() } catch { /* already exists */ }

  const { managerId, storeIds } = await req.json()
  if (!managerId) return NextResponse.json({ error: 'managerId required' }, { status: 400 })

  // Replace all assignments in one transaction
  await query(`DELETE FROM dm_manager_stores WHERE manager_id = $1`, [managerId])

  if (Array.isArray(storeIds) && storeIds.length > 0) {
    const placeholders = storeIds.map((_: string, i: number) => `($1, $${i + 2})`).join(', ')
    await query(
      `INSERT INTO dm_manager_stores (manager_id, store_location_id) VALUES ${placeholders}`,
      [managerId, ...storeIds]
    )
  }

  return NextResponse.json({ ok: true, count: storeIds?.length ?? 0 })
}
