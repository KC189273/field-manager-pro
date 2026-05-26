import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'
import { buildFormalDocHtml, levelLabel, APP_URL } from '@/lib/accountability-email'
import crypto from 'crypto'

async function ensureConversationColumns() {
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_status TEXT`)
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_approved_at TIMESTAMPTZ`)
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_reminder_sent_at TIMESTAMPTZ`)
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_escalated_at TIMESTAMPTZ`)
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ`)
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const orgFilter = await getOrgFilter(session)

  try { await ensureConversationColumns() } catch {}

  const doc = await queryOne<{
    id: string; ref_number: string; org_id: string; level: string; title: string
    subject_id: string; subject_name: string; subject_role: string; subject_email: string
    author_id: string; author_name: string; author_role: string; author_email: string
    incident_date: string; notes: string; expectations: string
    status: string; sd_id: string | null; sd_name: string | null; sd_email: string | null
    created_at: string
  }>(`SELECT * FROM accountability_docs WHERE id = $1`, [id])

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status !== 'pending_approval') return NextResponse.json({ error: 'Document is not pending approval' }, { status: 400 })

  if (orgFilter.filterByOrg && orgFilter.orgId && doc.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (session.role === 'sales_director' && doc.sd_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ackToken = crypto.randomBytes(32).toString('hex')
  const needsVoiceConvo = doc.level === 'written' || doc.level === 'final'

  if (needsVoiceConvo) {
    // Written/Final: hold employee email — DM must complete voice conversation first
    await query(
      `UPDATE accountability_docs
       SET status = 'approved', approver_id = $1, approver_name = $2,
           approved_at = NOW(), ack_token = $3,
           conversation_status = 'pending', conversation_approved_at = NOW()
       WHERE id = $4`,
      [session.id, session.fullName, ackToken, doc.id]
    )
  } else {
    // Verbal: approve and send employee email immediately
    await query(
      `UPDATE accountability_docs
       SET status = 'approved', approver_id = $1, approver_name = $2,
           approved_at = NOW(), ack_token = $3, email_sent_at = NOW()
       WHERE id = $4`,
      [session.id, session.fullName, ackToken, doc.id]
    )
  }

  // Fetch supporting data for email
  const priorConvos = await query<{ convo_date: string; notes: string }>(
    `SELECT convo_date::text, notes FROM accountability_prior_convos WHERE doc_id = $1 ORDER BY sort_order, convo_date`,
    [id]
  )
  const linkedVerbals = await query<{ ref_number: string; title: string; incident_date: string }>(
    `SELECT d.ref_number, d.title, d.incident_date::text
     FROM accountability_linked_verbals lv JOIN accountability_docs d ON d.id = lv.linked_verbal_id
     WHERE lv.doc_id = $1`, [id]
  )

  const ackLink = `${APP_URL}/ack/${ackToken}`
  const docDate = new Date(doc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const baseParams = {
    refNumber: doc.ref_number, level: doc.level, title: doc.title,
    subjectName: doc.subject_name, subjectRole: doc.subject_role,
    authorName: doc.author_name, authorRole: doc.author_role,
    incidentDate: doc.incident_date, notes: doc.notes, expectations: doc.expectations,
    docDate, priorConvos, linkedVerbals,
  }

  if (!needsVoiceConvo) {
    // Verbal: send employee email immediately
    sendEmail(
      doc.subject_email,
      `OFFICIAL NOTICE — ${levelLabel(doc.level).toUpperCase()} | Ref: ${doc.ref_number}`,
      buildFormalDocHtml({ ...baseParams, ackLink })
    ).catch(() => {})
  }

  // Retained copy to author (always)
  sendEmail(
    doc.author_email,
    `[RETAINED COPY] ${levelLabel(doc.level).toUpperCase()} | ${doc.subject_name} | Ref: ${doc.ref_number}`,
    buildFormalDocHtml({ ...baseParams, isRetainedCopy: true })
  ).catch(() => {})

  // SD copy (if SD is not the approver) — always
  if (doc.sd_id && doc.sd_email && doc.sd_id !== session.id) {
    sendEmail(
      doc.sd_email,
      `[SD COPY — FILED] ${levelLabel(doc.level).toUpperCase()} | ${doc.subject_name} | Ref: ${doc.ref_number}`,
      buildFormalDocHtml({ ...baseParams, isSdCopy: true })
    ).catch(() => {})
  }

  // Push to author
  if (needsVoiceConvo) {
    sendPushToUser(doc.author_id, 'Accountability Doc Approved — Voice Conversation Required',
      `${doc.ref_number} approved. You have 24 hours to complete a voice conversation with ${doc.subject_name} before the formal notice is sent.`,
      'accountability'
    ).catch(() => {})
  } else {
    sendPushToUser(doc.author_id, 'Accountability Doc Approved',
      `${doc.ref_number} — ${doc.subject_name} has been approved and sent.`, 'accountability'
    ).catch(() => {})
  }

  const auditNote = needsVoiceConvo
    ? `Approved by ${session.role} — voice conversation required before employee notice is sent`
    : `Approved by ${session.role}`

  await query(
    `INSERT INTO accountability_audit_log (doc_id, action, actor_id, actor_name, notes) VALUES ($1,$2,$3,$4,$5)`,
    [doc.id, 'approved', session.id, session.fullName, auditNote]
  ).catch(() => {})

  return NextResponse.json({ ok: true, needsVoiceConvo })
}
