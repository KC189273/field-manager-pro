import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendEmail } from '@/lib/notifications'
import { buildFormalDocHtml, levelLabel, APP_URL } from '@/lib/accountability-email'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Only SD, owner, developer can force-send
  if (!['sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const orgFilter = await getOrgFilter(session)

  const doc = await queryOne<{
    id: string; ref_number: string; org_id: string; level: string; title: string
    subject_id: string; subject_name: string; subject_role: string; subject_email: string
    author_id: string; author_name: string; author_role: string; author_email: string
    incident_date: string; notes: string; expectations: string
    status: string; ack_token: string; created_at: string
    conversation_status: string | null
    sd_id: string | null; sd_name: string | null; sd_email: string | null
  }>(`SELECT * FROM accountability_docs WHERE id = $1`, [id])

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status !== 'approved') return NextResponse.json({ error: 'Document is not approved' }, { status: 400 })
  if (doc.conversation_status !== 'pending' && doc.conversation_status !== 'escalated') {
    return NextResponse.json({ error: 'No voice conversation pending for this document' }, { status: 400 })
  }

  if (orgFilter.filterByOrg && orgFilter.orgId && doc.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (session.role === 'sales_director' && doc.sd_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Bypass voice conversation, mark as bypassed and send email now
  await query(
    `UPDATE accountability_docs
     SET conversation_status = 'bypassed', email_sent_at = NOW()
     WHERE id = $1`,
    [doc.id]
  )

  // Fetch supporting data
  const priorConvos = await query<{ convo_date: string; notes: string }>(
    `SELECT convo_date::text, notes FROM accountability_prior_convos WHERE doc_id = $1 ORDER BY sort_order, convo_date`,
    [id]
  )
  const linkedVerbals = await query<{ ref_number: string; title: string; incident_date: string }>(
    `SELECT d.ref_number, d.title, d.incident_date::text
     FROM accountability_linked_verbals lv JOIN accountability_docs d ON d.id = lv.linked_verbal_id
     WHERE lv.doc_id = $1`, [id]
  )

  const ackLink = `${APP_URL}/ack/${doc.ack_token}`
  const docDate = new Date(doc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const baseParams = {
    refNumber: doc.ref_number, level: doc.level, title: doc.title,
    subjectName: doc.subject_name, subjectRole: doc.subject_role,
    authorName: doc.author_name, authorRole: doc.author_role,
    incidentDate: doc.incident_date, notes: doc.notes, expectations: doc.expectations,
    docDate, priorConvos, linkedVerbals,
  }

  // Send formal notice to employee
  sendEmail(
    doc.subject_email,
    `OFFICIAL NOTICE — ${levelLabel(doc.level).toUpperCase()} | Ref: ${doc.ref_number}`,
    buildFormalDocHtml({ ...baseParams, ackLink })
  ).catch(() => {})

  // CC: DM (author), ops managers, SD, owner
  const ccRecipients = await query<{ email: string; full_name: string }>(
    `SELECT email, full_name FROM users
     WHERE org_id = $1 AND is_active = TRUE
       AND role IN ('ops_manager', 'owner')`,
    [doc.org_id]
  )
  const ccEmails = ccRecipients.map(r => r.email)
  if (!ccEmails.includes(doc.author_email)) ccEmails.push(doc.author_email)
  if (doc.sd_email && !ccEmails.includes(doc.sd_email)) ccEmails.push(doc.sd_email)

  for (const email of ccEmails) {
    const isAuthor = email === doc.author_email
    sendEmail(
      email,
      `[CC — FILED] ${levelLabel(doc.level).toUpperCase()} sent to ${doc.subject_name} | Ref: ${doc.ref_number}`,
      buildFormalDocHtml({ ...baseParams, isRetainedCopy: isAuthor, isSdCopy: !isAuthor })
    ).catch(() => {})
  }

  await query(
    `INSERT INTO accountability_audit_log (doc_id, action, actor_id, actor_name, notes) VALUES ($1,$2,$3,$4,$5)`,
    [doc.id, 'force_send', session.id, session.fullName,
     `Voice conversation bypassed by ${session.role} ${session.fullName} — formal notice force-sent to employee`]
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
