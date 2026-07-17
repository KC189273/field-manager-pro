import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { buildTerminationEmailHtml } from '@/lib/accountability-email'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get all approved terminations
  const terminations = await query<{
    id: string; employee_id: string; employee_name: string; employee_email: string
    org_id: string; requested_by: string; requested_by_name: string
    approved_by_name: string; reasons: string; approved_at: string; created_at: string
  }>(`SELECT * FROM termination_requests WHERE status = 'approved' ORDER BY approved_at DESC NULLS LAST`)

  if (terminations.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No approved terminations found' })
  }

  const results: Array<{ employee: string; sent_to: string[] }> = []

  for (const t of terminations) {
    const orgRow = await queryOne<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [t.org_id])
    const orgName = orgRow?.name ?? 'The Organization'

    const terminationDate = t.approved_at
      ? new Date(t.approved_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date(t.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    const accountabilityDocs = await query<{
      ref_number: string; level: string; title: string; incident_date: string
    }>(
      `SELECT ref_number, level, title, incident_date::text
       FROM accountability_docs
       WHERE subject_id = $1 AND org_id = $2
         AND status IN ('approved', 'acknowledged')
       ORDER BY created_at ASC`,
      [t.employee_id, t.org_id]
    )

    const emailParams = {
      employeeName: t.employee_name,
      orgName,
      dmName: t.requested_by_name,
      sdName: t.approved_by_name ?? 'Sales Director',
      reasons: t.reasons,
      terminationDate,
      accountabilityDocs,
    }

    // Send management copy to all active management in the org (respecting notification preferences)
    const management = await query<{ id: string; email: string; full_name: string; role: string }>(
      `SELECT u.id, u.email, u.full_name, u.role FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.org_id = $1 AND u.is_active = TRUE
         AND u.role IN ('manager', 'ops_manager', 'sales_director', 'owner', 'developer')
         AND COALESCE(np.termination_docs, TRUE) = TRUE
         AND COALESCE(np.email_enabled, TRUE) = TRUE`,
      [t.org_id]
    )

    const sentTo: string[] = []
    for (const person of management) {
      await sendEmail(
        person.email,
        `[MANAGEMENT COPY] Termination Notice — ${t.employee_name} | ${orgName}`,
        buildTerminationEmailHtml({ ...emailParams, isCopy: true, copyFor: person.full_name })
      )
      sentTo.push(`${person.full_name} (${person.role}) <${person.email}>`)
    }

    results.push({ employee: t.employee_name, sent_to: sentTo })
  }

  return NextResponse.json({ ok: true, processed: terminations.length, results })
}
