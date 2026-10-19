import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'
import { getReceiptViewUrl } from '@/lib/s3'

const SUBMIT_ROLES = ['manager', 'ops_manager', 'ops_field_leader', 'sales_director', 'owner', 'developer']
const VIEW_ROLES = ['manager', 'ops_manager', 'ops_field_leader', 'sales_director', 'owner', 'developer']

// GET — list self-quit records
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !VIEW_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []
  const where: string[] = []

  if (orgFilter.filterByOrg && orgFilter.orgId) {
    params.push(orgFilter.orgId)
    where.push(`sq.org_id = $${params.length}`)
  }

  // DMs only see their own submissions
  if (session.role === 'manager') {
    params.push(session.id)
    where.push(`sq.submitted_by_id = $${params.length}`)
  }

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  if (dateFrom) { params.push(dateFrom); where.push(`sq.created_at >= $${params.length}`) }
  if (dateTo) { params.push(dateTo + 'T23:59:59'); where.push(`sq.created_at <= $${params.length}`) }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const records = await query<{
    id: string; employee_id: string; employee_name: string; employee_email: string
    submitted_by_name: string; last_day_worked: string | null
    two_week_notice: boolean; rehireable: boolean
    reason: string; employee_notes: string | null; created_at: string
  }>(
    `SELECT sq.id, sq.employee_id, sq.employee_name, sq.employee_email,
            sq.submitted_by_name, sq.last_day_worked::text,
            sq.two_week_notice, sq.rehireable,
            sq.reason, sq.employee_notes, sq.created_at
     FROM self_quit_records sq
     ${whereClause}
     ORDER BY sq.created_at DESC
     LIMIT 200`,
    params
  )

  // Load attachments for all records
  const recordIds = records.map(r => r.id)
  let attachments: Array<{ record_id: string; id: string; filename: string; url: string | null }> = []
  if (recordIds.length) {
    const rawAttach = await query<{ record_id: string; id: string; s3_key: string; filename: string }>(
      `SELECT record_id, id, s3_key, filename FROM self_quit_attachments WHERE record_id = ANY($1::uuid[])`,
      [recordIds]
    ).catch(() => [])
    attachments = await Promise.all(
      rawAttach.map(async a => ({
        record_id: a.record_id,
        id: a.id,
        filename: a.filename,
        url: await getReceiptViewUrl(a.s3_key).catch(() => null),
      }))
    )
  }

  const recordsWithAttachments = records.map(r => ({
    ...r,
    attachments: attachments.filter(a => a.record_id === r.id),
  }))

  return NextResponse.json({ records: recordsWithAttachments })
}

// POST — submit a self-quit record
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !SUBMIT_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { employeeId, reason, lastDayWorked, twoWeekNotice, rehireable, employeeNotes, attachmentKeys } = body

  if (!employeeId || !reason?.trim()) {
    return NextResponse.json({ error: 'Employee and reason are required' }, { status: 400 })
  }

  // Verify employee exists
  const employee = await queryOne<{
    id: string; full_name: string; email: string; role: string; org_id: string; manager_id: string | null
  }>(`SELECT id, full_name, email, role, org_id, manager_id FROM users WHERE id = $1 AND is_active = TRUE`, [employeeId])

  if (!employee) return NextResponse.json({ error: 'Employee not found or already deactivated' }, { status: 404 })

  // DMs can only submit for their direct reports
  if (session.role === 'manager' && employee.manager_id !== session.id) {
    return NextResponse.json({ error: 'You can only submit for your direct reports' }, { status: 403 })
  }

  const orgId = session.org_id ?? employee.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 400 })

  // Insert the record
  const record = await queryOne<{ id: string; created_at: string }>(`
    INSERT INTO self_quit_records (org_id, employee_id, employee_name, employee_email,
      submitted_by_id, submitted_by_name, last_day_worked, two_week_notice, rehireable, reason, employee_notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id, created_at
  `, [
    orgId, employee.id, employee.full_name, employee.email,
    session.id, session.fullName,
    lastDayWorked || null,
    twoWeekNotice ?? false,
    rehireable ?? false,
    reason.trim(),
    employeeNotes?.trim() || null,
  ])

  if (!record) return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })

  // Save attachments
  if (Array.isArray(attachmentKeys)) {
    for (const ak of attachmentKeys) {
      if (ak.key) {
        await query(`INSERT INTO self_quit_attachments (record_id, s3_key, filename) VALUES ($1, $2, $3)`,
          [record.id, ak.key, ak.filename || ak.key.split('/').pop() || 'file']).catch(() => {})
      }
    }
  }

  // Deactivate the employee
  await query(`UPDATE users SET is_active = FALSE, is_hidden = TRUE, is_terminated = TRUE WHERE id = $1`, [employee.id])

  // Notify leadership
  const leaders = await query<{ id: string; email: string; full_name: string }>(
    `SELECT id, email, full_name FROM users
     WHERE org_id = $1 AND is_active = TRUE AND role IN ('owner', 'ops_manager', 'developer')`,
    [orgId]
  )

  const noticeLabel = twoWeekNotice ? 'gave 2-week notice' : 'did NOT give 2-week notice'
  const rehireLabel = rehireable ? 'Rehireable' : 'Not Rehireable'

  // Push to leadership
  if (leaders.length) {
    sendPushToUsers(
      leaders.map(l => l.id),
      'Employee Self-Quit',
      `${employee.full_name} has self-quit (${noticeLabel}, ${rehireLabel}). Submitted by ${session.fullName}.`,
      'accountability'
    ).catch(() => {})
  }

  // Email to leadership
  const docDate = new Date(record.created_at).toLocaleDateString('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric',
  })
  const lastDayLabel = lastDayWorked
    ? new Date(lastDayWorked + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Not specified'

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#0f172a;padding:20px 24px;border-radius:8px 8px 0 0">
        <h1 style="color:#f1f5f9;margin:0;font-size:18px">Employee Self-Quit Record</h1>
        <p style="color:#94a3b8;margin:4px 0 0;font-size:13px">${docDate}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px 24px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#6b7280;width:160px">Employee</td><td style="padding:8px 0;color:#111827;font-weight:600">${employee.full_name}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280">Submitted By</td><td style="padding:8px 0;color:#111827">${session.fullName}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280">Last Day Worked</td><td style="padding:8px 0;color:#111827">${lastDayLabel}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280">2-Week Notice</td><td style="padding:8px 0;color:${twoWeekNotice ? '#16a34a' : '#dc2626'};font-weight:600">${twoWeekNotice ? 'Yes' : 'No'}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280">Rehireable</td><td style="padding:8px 0;color:${rehireable ? '#16a34a' : '#dc2626'};font-weight:600">${rehireable ? 'Yes' : 'No'}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;vertical-align:top">Reason</td><td style="padding:8px 0;color:#111827">${reason.trim().replace(/\n/g, '<br>')}</td></tr>
          ${employeeNotes?.trim() ? `<tr><td style="padding:8px 0;color:#6b7280;vertical-align:top">Notes</td><td style="padding:8px 0;color:#111827">${employeeNotes.trim().replace(/\n/g, '<br>')}</td></tr>` : ''}
        </table>
        <p style="font-size:12px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #e5e7eb;padding-top:12px">
          Account has been deactivated. This record is permanently on file.
        </p>
      </div>
    </div>`

  for (const leader of leaders) {
    sendEmail(leader.email, `Self-Quit — ${employee.full_name} (${rehireLabel})`, html).catch(() => {})
  }
  // Also email to submitter if not in leaders list
  if (!leaders.find(l => l.id === session.id)) {
    const freshEmail = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [session.id])
    if (freshEmail?.email) {
      sendEmail(freshEmail.email, `[RETAINED COPY] Self-Quit — ${employee.full_name}`, html).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true, id: record.id })
}
