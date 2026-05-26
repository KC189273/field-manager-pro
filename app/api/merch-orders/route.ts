import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

function merchOrderEmailHtml(recipientName: string, requesterName: string, notes: string, store: string | null): string {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">New Merch Order Request</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#1c1c1e;margin:0 0 16px;">Hi ${recipientName}, <strong>${requesterName}</strong> has submitted a merchandising order request.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <tr style="background:#f2f2f7;"><td style="padding:8px 12px;font-weight:600;color:#8e8e93;width:110px;">Requester</td><td style="padding:8px 12px;color:#1c1c1e;font-weight:700;">${requesterName}</td></tr>
          ${store ? `<tr><td style="padding:8px 12px;font-weight:600;color:#8e8e93;">Store</td><td style="padding:8px 12px;color:#1c1c1e;">${store}</td></tr>` : ''}
          <tr style="background:#f2f2f7;"><td style="padding:8px 12px;font-weight:600;color:#8e8e93;vertical-align:top;">Notes</td><td style="padding:8px 12px;color:#1c1c1e;">${notes}</td></tr>
        </table>
        <a href="${APP_URL}/merch-orders" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View in Field Manager Pro</a>
      </div>
    </div>
  `
}

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS merch_orders (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id            UUID,
      requester_id      UUID REFERENCES users(id) ON DELETE SET NULL,
      requester_name    TEXT NOT NULL,
      requester_role    TEXT NOT NULL,
      manager_id        UUID REFERENCES users(id) ON DELETE SET NULL,
      manager_name      TEXT,
      ops_manager_id    UUID REFERENCES users(id) ON DELETE SET NULL,
      ops_manager_name  TEXT,
      store_location_id UUID,
      store_address     TEXT,
      notes             TEXT NOT NULL,
      photos            TEXT[],
      status            TEXT NOT NULL DEFAULT 'pending',
      ordered_at        TIMESTAMPTZ,
      ordered_by        UUID,
      ordered_by_name   TEXT,
      ordered_note      TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

// GET /api/merch-orders
// Params: history=true, from=YYYY-MM-DD, to=YYYY-MM-DD, managerId=, storeId=
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const { searchParams } = new URL(req.url)
  const history    = searchParams.get('history') === 'true'
  const filterMgr  = searchParams.get('managerId')
  const filterStore = searchParams.get('storeId')
  const fromDate   = searchParams.get('from')
  const toDate     = searchParams.get('to')

  const isOpsPlus = ['ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)
  const orgFilter  = await getOrgFilter(session)

  // Check if DM is an ops collaborator
  let isOpsCollab = false
  if (session.role === 'manager') {
    const u = await queryOne<{ is_ops_collab: boolean }>(`SELECT is_ops_collab FROM users WHERE id = $1`, [session.id])
    isOpsCollab = u?.is_ops_collab ?? false
  }
  const isOpsView = isOpsPlus || isOpsCollab
  const params: unknown[] = []

  // All roles see both pending and ordered; history param unused (no received state)
  let where = `mo.status IN ('pending', 'ordered')`

  if (fromDate) { params.push(fromDate);               where += ` AND mo.created_at >= $${params.length}` }
  if (toDate)   { params.push(toDate + 'T23:59:59');   where += ` AND mo.created_at <= $${params.length}` }

  if (session.role === 'employee') {
    params.push(session.id)
    where += ` AND mo.requester_id = $${params.length}`
  } else if (session.role === 'manager' && !isOpsCollab) {
    // DMs see their own requests + their employees' requests
    params.push(session.id)
    where += ` AND (mo.requester_id = $${params.length} OR mo.manager_id = $${params.length})`
  } else {
    // Ops+, ops-collab DMs: see all org orders
    where += appendOrgFilter(orgFilter, params, 'mo')
    if (filterMgr)   { params.push(filterMgr);   where += ` AND mo.manager_id = $${params.length}` }
    if (filterStore) { params.push(filterStore); where += ` AND mo.store_location_id = $${params.length}` }
  }

  const orders = await query(`
    SELECT mo.*,
           mo.created_at::text,
           mo.ordered_at::text,
           mo.updated_at::text
    FROM merch_orders mo
    WHERE ${where}
    ORDER BY mo.created_at DESC
  `, params)

  // Stores + ops managers for submit form (employee / DM)
  let stores: { id: string; address: string }[] = []
  let opsMgrs: { id: string; full_name: string }[] = []

  if (session.role === 'employee') {
    const user = await queryOne<{ manager_id: string | null; org_id: string | null }>(
      `SELECT manager_id, org_id FROM users WHERE id = $1`, [session.id]
    )
    if (user?.manager_id) {
      stores = await query<{ id: string; address: string }>(
        `SELECT l.id, l.address FROM dm_store_locations l
         JOIN dm_manager_stores ms ON ms.store_location_id = l.id
         WHERE ms.manager_id = $1 AND l.active = TRUE ORDER BY l.address`,
        [user.manager_id]
      )
    }
    if (user?.org_id) {
      opsMgrs = await query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM users
         WHERE org_id = $1 AND role IN ('ops_manager', 'owner', 'sales_director') AND is_active = TRUE
         ORDER BY full_name`,
        [user.org_id]
      )
    }
  } else if (session.role === 'manager') {
    const user = await queryOne<{ org_id: string | null }>(
      `SELECT org_id FROM users WHERE id = $1`, [session.id]
    )
    if (user?.org_id) {
      opsMgrs = await query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM users
         WHERE org_id = $1 AND role IN ('ops_manager', 'owner', 'sales_director') AND is_active = TRUE
         ORDER BY full_name`,
        [user.org_id]
      )
    }
    stores = await query<{ id: string; address: string }>(
      `SELECT l.id, l.address FROM dm_store_locations l
       JOIN dm_manager_stores ms ON ms.store_location_id = l.id
       WHERE ms.manager_id = $1 AND l.active = TRUE ORDER BY l.address`,
      [session.id]
    )
  }

  // Filters for ops+ dashboard
  let managers: { id: string; full_name: string }[] = []
  let allStores: { id: string; address: string }[] = []
  if (isOpsView) {
    const mgrParams: unknown[] = []
    managers = await query<{ id: string; full_name: string }>(
      `SELECT u.id, u.full_name FROM users u WHERE u.role = 'manager' AND u.is_active = TRUE${appendOrgFilter(orgFilter, mgrParams, 'u')} ORDER BY u.full_name`,
      mgrParams
    )
    const storeParams: unknown[] = []
    allStores = await query<{ id: string; address: string }>(
      `SELECT l.id, l.address FROM dm_store_locations l WHERE l.active = TRUE${appendOrgFilter(orgFilter, storeParams, 'l')} ORDER BY l.address`,
      storeParams
    )
  }

  return NextResponse.json({ orders, stores, opsMgrs, managers, allStores })
}

// POST /api/merch-orders — employee or DM submits
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!['employee', 'manager'].includes(session.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch {}

  const { notes, photos, storeLocationId, opsManagerId } = await req.json()
  if (!notes?.trim())   return NextResponse.json({ error: 'Notes are required' }, { status: 400 })
  if (!opsManagerId)    return NextResponse.json({ error: 'Ops manager is required' }, { status: 400 })

  const user = await queryOne<{ manager_id: string | null; org_id: string | null }>(
    `SELECT manager_id, org_id FROM users WHERE id = $1`, [session.id]
  )

  let managerId: string | null = null
  let managerName: string | null = null

  if (session.role === 'employee') {
    managerId = user?.manager_id ?? null
    if (managerId) {
      const mgr = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [managerId])
      managerName = mgr?.full_name ?? null
    }
  } else if (session.role === 'manager') {
    managerId   = session.id
    managerName = session.fullName
  }

  const opsMgr = await queryOne<{ full_name: string; email: string | null }>(
    `SELECT full_name, email FROM users WHERE id = $1`, [opsManagerId]
  )

  let storeAddress: string | null = null
  if (storeLocationId) {
    const store = await queryOne<{ address: string }>(
      `SELECT address FROM dm_store_locations WHERE id = $1`, [storeLocationId]
    )
    storeAddress = store?.address ?? null
  }

  await query(`
    INSERT INTO merch_orders
      (org_id, requester_id, requester_name, requester_role, manager_id, manager_name,
       ops_manager_id, ops_manager_name, store_location_id, store_address, notes, photos)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    user?.org_id ?? null,
    session.id, session.fullName, session.role,
    managerId, managerName,
    opsManagerId, opsMgr?.full_name ?? null,
    storeLocationId ?? null, storeAddress,
    notes.trim(),
    photos?.length ? photos : null,
  ])

  // Notify the selected ops manager
  sendPushToUser(
    opsManagerId,
    'New Merch Order Request',
    `${session.fullName} submitted a merch order request.`,
    'merch_order'
  ).catch(() => {})

  if (opsMgr?.email && await isEmailEnabled(opsManagerId)) {
    sendEmail(
      opsMgr.email,
      `New Merch Order Request from ${session.fullName}`,
      merchOrderEmailHtml(opsMgr.full_name, session.fullName, notes.trim(), storeAddress)
    ).catch(() => {})
  }

  // If submitted by an employee, also alert their DM
  if (session.role === 'employee' && managerId) {
    sendPushToUser(
      managerId,
      'Merch Order Submitted',
      `${session.fullName} submitted a merch order to ${opsMgr?.full_name ?? 'an ops manager'}.`,
      'merch_order'
    ).catch(() => {})

    const dmRow = await queryOne<{ email: string | null; full_name: string }>(
      `SELECT email, full_name FROM users WHERE id = $1`, [managerId]
    )
    if (dmRow?.email && await isEmailEnabled(managerId)) {
      sendEmail(
        dmRow.email,
        `Merch Order Submitted by ${session.fullName}`,
        merchOrderEmailHtml(dmRow.full_name, session.fullName, notes.trim(), storeAddress)
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}

// PATCH /api/merch-orders — ops manager marks ordered
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!['ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, note } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const row = await queryOne<{
    requester_id: string; requester_name: string; requester_role: string
    manager_id: string | null; status: string
  }>(`SELECT requester_id, requester_name, requester_role, manager_id, status FROM merch_orders WHERE id = $1`, [id])

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status !== 'pending') return NextResponse.json({ error: 'Already ordered' }, { status: 400 })

  await query(
    `UPDATE merch_orders SET status='ordered', ordered_at=NOW(), ordered_by=$1, ordered_by_name=$2, ordered_note=$3, updated_at=NOW() WHERE id=$4`,
    [session.id, session.fullName, note?.trim() || null, id]
  )

  // Notify the requester
  sendPushToUser(
    row.requester_id,
    'Merch Order Placed!',
    `Your merchandising order has been placed — keep an eye out in the mail!`,
    'merch_ordered'
  ).catch(() => {})

  // If requester was an employee, also notify their DM
  if (row.requester_role === 'employee' && row.manager_id) {
    sendPushToUser(
      row.manager_id,
      'Merch Order Placed',
      `${row.requester_name}'s merch order has been placed by ${session.fullName}.`,
      'merch_ordered'
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
