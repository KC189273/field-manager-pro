import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendEmail } from '@/lib/notifications'
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

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['manager', 'ops_manager', 'sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTerminationTables() } catch {}

  const { searchParams } = new URL(req.url)
  const orgFilter = await getOrgFilter(session)

  // ── Terminated employees directory ───────────────────────────────────────
  if (searchParams.get('view') === 'terminated') {
    const params: unknown[] = []
    const conditions: string[] = [`tr.status = 'approved'`]

    if (orgFilter.filterByOrg && orgFilter.orgId) {
      params.push(orgFilter.orgId)
      conditions.push(`tr.org_id = $${params.length}`)
    }
    if (session.role === 'manager') {
      params.push(session.id)
      conditions.push(`tr.requested_by = $${params.length}`)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const employees = await query<{
      id: string; employee_id: string; employee_name: string; employee_email: string
      requested_by_name: string; requested_by_role: string; reasons: string
      approved_by_name: string | null; approved_at: string | null; created_at: string
      doc_count: string
    }>(`
      SELECT tr.*,
        COALESCE((
          SELECT COUNT(*)::text FROM accountability_docs ad
          WHERE ad.subject_id = tr.employee_id AND ad.status IN ('approved','needs_revision')
        ), '0') AS doc_count
      FROM termination_requests tr
      ${whereClause}
      ORDER BY tr.approved_at DESC NULLS LAST, tr.created_at DESC
    `, params)

    return NextResponse.json({ employees })
  }

  // ── Pending / all termination requests ───────────────────────────────────
  let whereClause = ''
  const queryParams: unknown[] = []

  if (orgFilter.filterByOrg && orgFilter.orgId) {
    whereClause = `WHERE t.org_id = $1`
    queryParams.push(orgFilter.orgId)
  }

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

  // Email all management so they don't miss it if push is not seen
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  const management = await query<{ email: string; full_name: string }>(
    `SELECT email, full_name FROM users
     WHERE org_id = $1 AND is_active = TRUE
       AND role IN ('manager', 'ops_manager', 'sales_director', 'owner', 'developer')
       AND id != $2`,
    [employee.org_id, session.id]
  )
  const emailHtml = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Termination Request — Pending Approval</p>
      </div>
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;font-weight:700;color:#991b1b;margin:0 0 16px;">A termination request has been submitted and requires Sales Director approval.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr><td style="padding:8px 0;font-size:13px;color:#6b7280;width:140px;">Employee</td><td style="padding:8px 0;font-size:14px;font-weight:600;color:#111827;">${employee.full_name}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#6b7280;">Submitted By</td><td style="padding:8px 0;font-size:14px;color:#374151;">${session.fullName}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#6b7280;vertical-align:top;">Reasons</td><td style="padding:8px 0;font-size:14px;color:#374151;">${reasons.trim()}</td></tr>
        </table>
        <a href="${appUrl}/accountability?tab=terminations" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Review Request</a>
      </div>
    </div>
  `
  for (const person of management) {
    sendEmail(
      person.email,
      `Termination Request: ${employee.full_name} — Pending Approval`,
      emailHtml
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, id: request!.id })
}
