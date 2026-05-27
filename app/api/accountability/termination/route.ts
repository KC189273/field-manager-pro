import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'

let ensured = false
async function ensureTerminationTables() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS termination_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID NOT NULL,
      employee_name TEXT NOT NULL,
      employee_email TEXT NOT NULL,
      org_id UUID NOT NULL,
      requested_by UUID NOT NULL,
      requested_by_name TEXT NOT NULL,
      requested_by_role TEXT NOT NULL,
      reasons TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_approval',
      approved_by UUID,
      approved_by_name TEXT,
      email_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ
    )
  `)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_terminated BOOLEAN DEFAULT FALSE`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ`)
}

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['manager', 'ops_manager', 'sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTerminationTables() } catch {}

  const orgFilter = await getOrgFilter(session)
  let whereClause = ''
  const queryParams: unknown[] = []

  if (orgFilter.filterByOrg && orgFilter.orgId) {
    whereClause = `WHERE t.org_id = $1`
    queryParams.push(orgFilter.orgId)
  }

  // Managers only see their own termination requests
  if (session.role === 'manager') {
    const param = queryParams.length + 1
    whereClause = whereClause
      ? `${whereClause} AND t.requested_by = $${param}`
      : `WHERE t.requested_by = $${param}`
    queryParams.push(session.id)
  }

  const requests = await query(
    `SELECT t.* FROM termination_requests t ${whereClause} ORDER BY t.created_at DESC`,
    queryParams
  )

  return NextResponse.json({ requests })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // DM, SD, Owner, Developer can initiate termination
  if (!['manager', 'ops_manager', 'sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTerminationTables() } catch {}

  const body = await req.json()
  const { employee_id, reasons } = body

  if (!employee_id || !reasons?.trim()) {
    return NextResponse.json({ error: 'employee_id and reasons are required' }, { status: 400 })
  }

  const orgFilter = await getOrgFilter(session)

  const employee = await queryOne<{ id: string; full_name: string; email: string; org_id: string; manager_id: string | null }>(
    `SELECT id, full_name, email, org_id, manager_id FROM users WHERE id = $1 AND is_active = TRUE`,
    [employee_id]
  )

  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  if (orgFilter.filterByOrg && orgFilter.orgId && employee.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Manager can only terminate their own employees
  if (session.role === 'manager' && employee.manager_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const request = await queryOne<{ id: string }>(
    `INSERT INTO termination_requests
       (employee_id, employee_name, employee_email, org_id, requested_by, requested_by_name, requested_by_role, reasons)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [employee.id, employee.full_name, employee.email, employee.org_id,
     session.id, session.fullName, session.role, reasons.trim()]
  )

  // Notify all SDs in the org that approval is needed
  const sds = await query<{ id: string }>(
    `SELECT id FROM users WHERE org_id = $1 AND role = 'sales_director' AND is_active = TRUE`,
    [employee.org_id]
  )
  if (sds.length) {
    sendPushToUsers(
      sds.map(s => s.id),
      'Termination Request Requires Approval',
      `${session.fullName} has requested termination for ${employee.full_name}. Review and approve or reject in Field Manager Pro.`,
      'accountability'
    ).catch(() => {})
  }

  // Also notify owners
  const owners = await query<{ id: string }>(
    `SELECT id FROM users WHERE org_id = $1 AND role IN ('owner', 'developer') AND is_active = TRUE`,
    [employee.org_id]
  )
  if (owners.length) {
    sendPushToUsers(
      owners.map(o => o.id),
      'Termination Request Submitted',
      `${session.fullName} has submitted a termination request for ${employee.full_name}. Awaiting SD approval.`,
      'accountability'
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, id: request!.id })
}
