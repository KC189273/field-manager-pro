import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'
import { buildTerminationEmailHtml } from '@/lib/accountability-email'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Only SD, owner, developer can approve termination
  if (!['sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const orgFilter = await getOrgFilter(session)

  const termReq = await queryOne<{
    id: string; employee_id: string; employee_name: string; employee_email: string
    org_id: string; requested_by: string; requested_by_name: string; reasons: string
    status: string; created_at: string
  }>(`SELECT * FROM termination_requests WHERE id = $1`, [id])

  if (!termReq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (termReq.status !== 'pending_approval') {
    return NextResponse.json({ error: 'Request is not pending approval' }, { status: 400 })
  }

  if (orgFilter.filterByOrg && orgFilter.orgId && termReq.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = body.action ?? 'approve' // 'approve' or 'reject'

  if (action === 'reject') {
    await query(
      `UPDATE termination_requests SET status = 'rejected', approved_by = $1, approved_by_name = $2, approved_at = NOW() WHERE id = $3`,
      [session.id, session.fullName, termReq.id]
    )
    sendPushToUser(termReq.requested_by, 'Termination Request Rejected',
      `The termination request for ${termReq.employee_name} has been rejected by ${session.fullName}.`,
      'accountability'
    ).catch(() => {})
    return NextResponse.json({ ok: true, action: 'rejected' })
  }

  // Approve: mark terminated, send email
  const terminationDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const orgName = 'The Organization'

  // Get DM name (requested_by)
  const dmUser = await queryOne<{ full_name: string }>(
    `SELECT full_name FROM users WHERE id = $1`, [termReq.requested_by]
  )
  const dmName = dmUser?.full_name ?? termReq.requested_by_name

  // Get accountability docs on file for this employee
  const accountabilityDocs = await query<{
    ref_number: string; level: string; title: string; incident_date: string
  }>(
    `SELECT ref_number, level, title, incident_date::text
     FROM accountability_docs
     WHERE subject_id = $1 AND org_id = $2
       AND status IN ('approved', 'acknowledged')
     ORDER BY created_at ASC`,
    [termReq.employee_id, termReq.org_id]
  )

  // Update termination request
  await query(
    `UPDATE termination_requests
     SET status = 'approved', approved_by = $1, approved_by_name = $2,
         approved_at = NOW(), email_sent_at = NOW()
     WHERE id = $3`,
    [session.id, session.fullName, termReq.id]
  )

  // Mark user as terminated and deactivate so they stop appearing in scheduling,
  // task assignment, and other active-employee contexts.
  await query(
    `UPDATE users SET is_terminated = TRUE, terminated_at = NOW(), is_active = FALSE WHERE id = $1`,
    [termReq.employee_id]
  )

  const emailParams = {
    employeeName: termReq.employee_name,
    orgName,
    dmName,
    sdName: session.fullName,
    reasons: termReq.reasons,
    terminationDate,
    accountabilityDocs,
  }

  // Send to employee
  sendEmail(
    termReq.employee_email,
    `Notice of Employment Termination — ${orgName}`,
    buildTerminationEmailHtml(emailParams)
  ).catch(() => {})

  // CC: DM, ops managers, SD, owner
  const ccRecipients = await query<{ id: string; email: string; full_name: string; role: string }>(
    `SELECT id, email, full_name, role FROM users
     WHERE org_id = $1 AND is_active = TRUE
       AND role IN ('manager', 'ops_manager', 'sales_director', 'owner', 'developer')`,
    [termReq.org_id]
  )

  for (const person of ccRecipients) {
    sendEmail(
      person.email,
      `[MANAGEMENT COPY] Termination Notice — ${termReq.employee_name} | ${orgName}`,
      buildTerminationEmailHtml({ ...emailParams, isCopy: true, copyFor: person.full_name })
    ).catch(() => {})

    // Push to each
    sendPushToUser(
      person.id,
      'Termination Processed',
      `${termReq.employee_name} has been terminated. The formal notice has been sent.`,
      'accountability'
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, action: 'approved' })
}
