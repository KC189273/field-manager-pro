import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'

// Geofence override — DM+ approves an employee's clock-in when GPS is inaccurate

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS geofence_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID NOT NULL,
      employee_name TEXT NOT NULL,
      approved_by UUID NOT NULL,
      approved_by_name TEXT NOT NULL,
      store_location_id UUID,
      store_address TEXT,
      reason TEXT NOT NULL,
      reported_distance_ft INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {})
  await query(`CREATE INDEX IF NOT EXISTS idx_geofence_overrides_emp ON geofence_overrides(employee_id, created_at DESC)`).catch(() => {})
}

// GET — list pending override requests or history for a DM's team
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get('employeeId')

  // Get override history for a specific employee (for consistency tracking)
  if (employeeId) {
    const overrides = await query<{
      id: string; store_address: string; reason: string; approved_by_name: string
      reported_distance_ft: number; created_at: string
    }>(`
      SELECT id, store_address, reason, approved_by_name, reported_distance_ft, created_at::text
      FROM geofence_overrides WHERE employee_id = $1
      ORDER BY created_at DESC LIMIT 30
    `, [employeeId])

    return NextResponse.json({ overrides })
  }

  // Get recent overrides for the DM's team
  let whereClause = ''
  const params: unknown[] = []
  if (session.role === 'manager') {
    params.push(session.id)
    whereClause = ` AND go.employee_id IN (SELECT id FROM users WHERE manager_id = $${params.length})`
  }

  const recent = await query<{
    id: string; employee_name: string; store_address: string; reason: string
    approved_by_name: string; reported_distance_ft: number; created_at: string
  }>(`
    SELECT go.id, go.employee_name, go.store_address, go.reason,
           go.approved_by_name, go.reported_distance_ft, go.created_at::text
    FROM geofence_overrides go
    WHERE go.created_at > NOW() - INTERVAL '30 days' ${whereClause}
    ORDER BY go.created_at DESC LIMIT 50
  `, params)

  return NextResponse.json({ overrides: recent })
}

// POST — DM approves a geofence override and clocks the employee in
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const { employeeId, storeId, reason, distanceFt } = await req.json()
  if (!employeeId) return NextResponse.json({ error: 'employeeId required' }, { status: 400 })
  if (!reason?.trim()) return NextResponse.json({ error: 'A reason is required for the override' }, { status: 400 })

  const employee = await queryOne<{ id: string; full_name: string; manager_id: string | null; org_id: string | null }>(
    `SELECT id, full_name, manager_id, org_id FROM users WHERE id = $1 AND is_active = TRUE`,
    [employeeId]
  )
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  // DMs can only override for their own employees
  if (session.role === 'manager' && employee.manager_id !== session.id) {
    return NextResponse.json({ error: 'You can only override for your own employees' }, { status: 403 })
  }

  // Check employee isn't already clocked in
  const active = await queryOne(`SELECT id FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`, [employeeId])
  if (active) return NextResponse.json({ error: 'Employee is already clocked in' }, { status: 409 })

  const storeAddress = storeId
    ? (await queryOne<{ address: string }>(`SELECT address FROM dm_store_locations WHERE id = $1`, [storeId]))?.address || 'Unknown store'
    : 'Unknown store'

  // Clock the employee in (bypassing geofence)
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS store_location_id UUID`).catch(() => {})
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS clock_in_photo_key TEXT`).catch(() => {})
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS geofence_override BOOLEAN DEFAULT FALSE`).catch(() => {})

  const shift = await queryOne<{ id: string }>(
    `INSERT INTO shifts (user_id, clock_in_at, store_location_id, geofence_override, manual_note)
     VALUES ($1, NOW(), $2, TRUE, $3) RETURNING id`,
    [employeeId, storeId || null, `Geofence override by ${session.fullName}: ${reason.trim()}`]
  )

  // Log the override
  await query(`
    INSERT INTO geofence_overrides (employee_id, employee_name, approved_by, approved_by_name, store_location_id, store_address, reason, reported_distance_ft)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [employeeId, employee.full_name, session.id, session.fullName, storeId || null, storeAddress, reason.trim(), distanceFt || null])

  // Notify the employee
  sendPushToUser(employeeId, 'Clocked In (DM Override)', `${session.fullName} clocked you in at ${storeAddress}.`, 'clock').catch(() => {})

  // Check for consistency — if same employee has 3+ overrides in 7 days, escalate to developer
  const recentCount = await queryOne<{ cnt: number }>(`
    SELECT COUNT(*)::int as cnt FROM geofence_overrides
    WHERE employee_id = $1 AND created_at > NOW() - INTERVAL '7 days'
  `, [employeeId])

  if (recentCount && recentCount.cnt >= 3) {
    // Escalate to developer — this employee has a persistent GPS problem
    const devs = await query<{ id: string; email: string }>(`
      SELECT id, email FROM users WHERE role = 'developer' AND is_active = TRUE
    `)
    for (const dev of devs) {
      sendPushToUser(dev.id, 'Recurring Geofence Override',
        `${employee.full_name} has needed ${recentCount.cnt} geofence overrides in 7 days. Persistent GPS issue — needs investigation.`,
        'flag_created'
      ).catch(() => {})

      sendEmail(dev.email,
        `Recurring Geofence Override: ${employee.full_name} — ${recentCount.cnt} overrides in 7 days`,
        `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#d97706;padding:16px 20px;border-radius:12px 12px 0 0;">
            <h2 style="color:white;margin:0;font-size:16px;">Recurring Geofence Override</h2>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;background:white;">
            <p style="font-size:14px;color:#111;margin:0 0 8px;"><strong>${employee.full_name}</strong> has needed <strong>${recentCount.cnt} geofence overrides</strong> in the past 7 days.</p>
            <p style="font-size:14px;color:#555;margin:0 0 8px;">Latest reason: ${reason.trim()}</p>
            <p style="font-size:14px;color:#555;margin:0 0 16px;">This employee likely has a persistent GPS/device issue that needs investigation.</p>
            <a href="https://fieldmanagerpro.app/flags" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:13px;padding:10px 20px;border-radius:8px;">View Flags</a>
          </div>
        </div>`
      ).catch(() => {})
    }

    // Also notify the DM about the pattern
    if (session.role === 'manager') {
      sendPushToUser(session.id, 'GPS Issue Pattern',
        `${employee.full_name} has needed ${recentCount.cnt} overrides this week. Their device GPS may need attention — check with them about phone settings or software updates.`,
        'flag_created'
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true, shiftId: shift!.id, overrideCount: recentCount?.cnt ?? 1 })
}
