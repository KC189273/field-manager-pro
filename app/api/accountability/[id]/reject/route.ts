import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'
import crypto from 'crypto'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

function levelLabel(level: string): string {
  if (level === 'verbal') return 'Verbal Notice'
  if (level === 'written') return 'Written Notice — 2nd Level'
  return 'Final Written Notice — 3rd Level'
}
function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function buildVerbalEmail(params: {
  refNumber: string; title: string
  subjectName: string; subjectRole: string; authorName: string; authorRole: string
  incidentDate: string; notes: string; expectations: string; docDate: string
  ackLink?: string; isRetainedCopy?: boolean; rejectionNote?: string
}): string {
  const { refNumber, title, subjectName, subjectRole, authorName, authorRole, incidentDate, notes, expectations, docDate, ackLink, isRetainedCopy, rejectionNote } = params
  const authorRoleLabel = authorRole === 'manager' ? 'District Manager' : authorRole === 'sales_director' ? 'Sales Director' : authorRole
  const subjectRoleLabel = subjectRole === 'employee' ? 'Team Member' : subjectRole === 'manager' ? 'District Manager' : subjectRole

  const rejectionBanner = rejectionNote ? `<div style="margin-bottom:20px;padding:14px 16px;background:#fef2f2;border-left:4px solid #dc2626;"><p style="font-size:11px;font-weight:bold;color:#991b1b;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;font-family:'Arial',sans-serif;">Document Level Adjusted — Reviewer Note</p><p style="font-size:13px;color:#7f1d1d;margin:0;line-height:1.6;">${rejectionNote.replace(/\n/g, '<br>')}</p></div>` : ''

  const ackHtml = ackLink ? `<div style="margin-top:30px;padding:20px 24px;background:#f0f4ff;border:2px solid #3b4db8;border-radius:6px;text-align:center;"><p style="font-size:14px;font-weight:bold;color:#1e2a7a;margin:0 0 8px;font-family:'Arial',sans-serif;">Acknowledgment of Receipt Required</p><p style="font-size:12px;color:#374151;margin:0 0 16px;line-height:1.6;font-family:'Arial',sans-serif;">By clicking the button below, you confirm you have received and reviewed this official document.<br><strong>This is not an admission of guilt or agreement with its contents</strong> — it is solely an acknowledgment that you have received it.<br><em>Failure to acknowledge receipt may result in administrative action including restriction from returning to scheduled duties until acknowledgment is completed.</em></p><a href="${ackLink}" style="display:inline-block;background:#1e2a7a;color:#ffffff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold;font-family:'Arial',sans-serif;">Acknowledge Receipt</a><p style="font-size:11px;color:#9ca3af;margin:12px 0 0;font-family:'Arial',sans-serif;">If the button above does not work, copy and paste this link:<br><span style="color:#3b4db8;">${ackLink}</span></p></div>` : ''

  const copyBanner = isRetainedCopy
    ? `<tr><td style="background:#1a3a1a;padding:10px 40px;text-align:center;"><p style="color:#86efac;font-size:11px;font-family:'Arial',sans-serif;letter-spacing:2px;text-transform:uppercase;margin:0;">RETAINED COPY — FOR YOUR RECORDS</p></td></tr>`
    : ''

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#e5e7eb;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;"><tr><td align="center"><table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #d1d5db;"><tr><td style="background:#0f172a;padding:28px 40px;text-align:center;"><p style="color:#94a3b8;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px;font-family:'Arial',sans-serif;">FIELD MANAGER PRO</p><h1 style="color:#f1f5f9;font-size:18px;letter-spacing:2px;text-transform:uppercase;margin:0;font-family:'Arial',sans-serif;font-weight:bold;">OFFICIAL EMPLOYEE ACCOUNTABILITY NOTICE</h1></td></tr>${copyBanner}<tr><td style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:14px 40px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-family:'Arial',sans-serif;"><span style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Reference Number</span><br><strong style="font-size:20px;color:#0f172a;letter-spacing:1px;">${refNumber}</strong></td><td align="right"><span style="background:#b45309;color:#ffffff;padding:6px 14px;font-size:10px;font-weight:bold;font-family:'Arial',sans-serif;letter-spacing:1.5px;text-transform:uppercase;">VERBAL</span></td></tr></table></td></tr><tr><td style="padding:30px 40px;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;margin-bottom:28px;font-family:'Arial',sans-serif;"><tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;width:170px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Employee</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;"><strong>${subjectName}</strong> <span style="color:#94a3b8;font-size:11px;">(${subjectRoleLabel})</span></td></tr><tr><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Issued By</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${authorName} <span style="color:#94a3b8;font-size:11px;">(${authorRoleLabel})</span></td></tr><tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Date of Incident</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${formatDate(incidentDate)}</td></tr><tr><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Notice Level</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">Verbal Notice</td></tr><tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;">Document Date</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;">${docDate}</td></tr></table><h2 style="font-size:17px;color:#0f172a;margin:0 0 22px;padding-bottom:10px;border-bottom:2px solid #0f172a;font-family:'Arial',sans-serif;">${title}</h2>${rejectionBanner}<div style="margin-bottom:24px;"><h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Summary of Discussion &amp; Documented Events</h3><div style="background:#f8fafc;border-left:4px solid #0f172a;padding:14px 16px;font-size:13px;color:#1e293b;line-height:1.75;font-family:'Georgia',serif;">${notes.replace(/\n/g, '<br>')}</div></div><div style="margin-bottom:24px;"><h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Clear Expectations Moving Forward</h3><div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:14px 16px;font-size:13px;color:#14532d;line-height:1.75;font-family:'Georgia',serif;">${expectations.replace(/\n/g, '<br>')}</div></div>${ackHtml}</td></tr><tr><td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:18px 40px;"><p style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;margin:0;line-height:1.7;">This is an official HR document generated by Field Manager Pro on <strong>${docDate}</strong>.<br>Reference: <strong>${refNumber}</strong> &nbsp;|&nbsp; This document is permanently on file and cannot be altered or deleted.<br>Confidential — For authorized personnel only. &copy; ${new Date().getFullYear()} Field Manager Pro.</p></td></tr></table></td></tr></table></body></html>`
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { rejectionNotes, rejectionType = 'downgrade' } = body

  if (!rejectionNotes?.trim()) {
    return NextResponse.json({ error: 'Rejection notes are required' }, { status: 400 })
  }
  if (!['downgrade', 'revision'].includes(rejectionType)) {
    return NextResponse.json({ error: 'Invalid rejectionType' }, { status: 400 })
  }

  const orgFilter = await getOrgFilter(session)

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

  // ── Send Back for Revision ────────────────────────────────────────────────
  if (rejectionType === 'revision') {
    // Ensure revision columns exist
    await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS revision_notes TEXT`).catch(() => {})
    await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS revision_requested_by_name TEXT`).catch(() => {})
    await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS revision_requested_at TIMESTAMPTZ`).catch(() => {})
    // Update status constraint to allow needs_revision
    await query(`ALTER TABLE accountability_docs DROP CONSTRAINT IF EXISTS accountability_docs_status_check`).catch(() => {})
    await query(`ALTER TABLE accountability_docs ADD CONSTRAINT accountability_docs_status_check CHECK (status IN ('pending_approval','approved','rejected','needs_revision'))`).catch(() => {})

    await query(
      `UPDATE accountability_docs
       SET status = 'needs_revision',
           revision_notes = $1,
           revision_requested_by_name = $2,
           revision_requested_at = NOW()
       WHERE id = $3`,
      [rejectionNotes.trim(), session.fullName, doc.id]
    )

    // Push + email DM to revise and resubmit
    sendPushToUser(
      doc.author_id,
      'Accountability Doc Needs Revision',
      `${doc.ref_number} was sent back by ${session.fullName}. Please revise and resubmit.`,
      'accountability'
    ).catch(() => {})

    sendEmail(
      doc.author_email,
      `[ACTION REQUIRED] Accountability Doc Sent Back for Revision | Ref: ${doc.ref_number}`,
      `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#e5e7eb;font-family:'Arial',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d1d5db;"><tr><td style="background:#1e3a5f;padding:22px 32px;text-align:center;"><h1 style="color:#bfdbfe;font-size:15px;letter-spacing:1px;text-transform:uppercase;margin:0;">Document Sent Back for Revision</h1></td></tr><tr><td style="padding:28px 32px;"><p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">Your accountability document <strong>${doc.ref_number}</strong> for <strong>${doc.subject_name}</strong> has been sent back for revision by <strong>${session.fullName}</strong>.</p><div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:14px 16px;margin:16px 0;"><p style="font-size:11px;font-weight:bold;color:#1e40af;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Reviewer Notes — What to Fix</p><p style="font-size:13px;color:#1e3a8a;margin:0;line-height:1.6;">${rejectionNotes.trim().replace(/\n/g, '<br>')}</p></div><p style="font-size:13px;color:#6b7280;margin:16px 0 0;">Please log in to <a href="${APP_URL}/accountability" style="color:#1e3a5f;">Field Manager Pro</a>, open the document, make the requested changes, and resubmit for approval.</p></td></tr></table></td></tr></table></body></html>`
    ).catch(() => {})

    await query(
      `INSERT INTO accountability_audit_log (doc_id, action, actor_id, actor_name, notes) VALUES ($1,'sent_back_for_revision',$2,$3,$4)`,
      [doc.id, session.id, session.fullName, `Sent back for revision by ${session.role}: ${rejectionNotes.trim()}`]
    ).catch(() => {})

    return NextResponse.json({ ok: true, action: 'revision' })
  }

  // ── Reject & Downgrade to Verbal (existing behavior) ──────────────────────
  // Mark original doc as rejected
  await query(
    `UPDATE accountability_docs
     SET status = 'rejected', rejected_at = NOW(),
         rejected_by_id = $1, rejected_by_name = $2, rejection_notes = $3
     WHERE id = $4`,
    [session.id, session.fullName, rejectionNotes.trim(), doc.id]
  )

  // Create new Verbal doc auto-linked to rejected doc
  const year = new Date().getFullYear()
  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM accountability_docs WHERE org_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
    [doc.org_id, year]
  )
  const seq = (parseInt(countRows[0]?.count ?? '0') + 1).toString().padStart(4, '0')
  const newRefNumber = `ACC-${year}-${seq}`
  const ackToken = crypto.randomBytes(32).toString('hex')

  const [newDoc] = await query<{ id: string; created_at: string }>(
    `INSERT INTO accountability_docs
      (ref_number, org_id, subject_id, subject_name, subject_role, subject_email,
       author_id, author_name, author_role, author_email,
       level, title, incident_date, notes, expectations,
       status, sd_id, sd_name, sd_email,
       ack_token, ack_status, reminder_acknowledged,
       approved_at, approver_id, approver_name, parent_rejected_doc_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             'approved',$16,$17,$18,$19,'pending',TRUE,NOW(),$20,$21,$22)
     RETURNING id, created_at`,
    [
      newRefNumber, doc.org_id,
      doc.subject_id, doc.subject_name, doc.subject_role, doc.subject_email,
      doc.author_id, doc.author_name, doc.author_role, doc.author_email,
      'verbal', doc.title, doc.incident_date, doc.notes, doc.expectations,
      doc.sd_id, doc.sd_name, doc.sd_email,
      ackToken,
      session.id, session.fullName, doc.id,
    ]
  )

  const ackLink = `${APP_URL}/ack/${ackToken}`
  const docDate = new Date(newDoc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  // Send verbal email to subject immediately
  sendEmail(
    doc.subject_email,
    `OFFICIAL NOTICE — VERBAL NOTICE | Ref: ${newRefNumber}`,
    buildVerbalEmail({
      refNumber: newRefNumber, title: doc.title,
      subjectName: doc.subject_name, subjectRole: doc.subject_role,
      authorName: doc.author_name, authorRole: doc.author_role,
      incidentDate: doc.incident_date, notes: doc.notes, expectations: doc.expectations,
      docDate, ackLink,
    })
  ).catch(() => {})

  // Send retained copy to author (DM/SD)
  sendEmail(
    doc.author_email,
    `[RETAINED COPY] VERBAL NOTICE | ${doc.subject_name} | Ref: ${newRefNumber}`,
    buildVerbalEmail({
      refNumber: newRefNumber, title: doc.title,
      subjectName: doc.subject_name, subjectRole: doc.subject_role,
      authorName: doc.author_name, authorRole: doc.author_role,
      incidentDate: doc.incident_date, notes: doc.notes, expectations: doc.expectations,
      docDate, isRetainedCopy: true,
    })
  ).catch(() => {})

  // Push notify the author that their doc was rejected and converted
  sendPushToUser(
    doc.author_id,
    'Accountability Doc Rejected',
    `${doc.ref_number} was rejected and converted to a Verbal (${newRefNumber}). Check your email for details.`,
    'accountability'
  ).catch(() => {})

  // Email to author explaining the rejection
  sendEmail(
    doc.author_email,
    `[ACTION — DOC REJECTED] ${levelLabel(doc.level).toUpperCase()} Rejected | Ref: ${doc.ref_number}`,
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#e5e7eb;font-family:'Arial',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d1d5db;"><tr><td style="background:#7f1d1d;padding:24px 32px;text-align:center;"><h1 style="color:#fef2f2;font-size:16px;letter-spacing:1px;text-transform:uppercase;margin:0;font-weight:bold;">Accountability Document Rejected</h1></td></tr><tr><td style="padding:28px 32px;"><p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">Your <strong>${levelLabel(doc.level)}</strong> (Ref: <strong>${doc.ref_number}</strong>) for <strong>${doc.subject_name}</strong> was reviewed and <strong>rejected</strong> by ${session.fullName}.</p><p style="font-size:13px;color:#6b7280;margin:0 0 12px;">The document has been automatically converted to a <strong>Verbal Notice</strong> (New Ref: <strong>${newRefNumber}</strong>) and has been sent to ${doc.subject_name}.</p><div style="background:#fef2f2;border-left:4px solid #dc2626;padding:14px 16px;margin:16px 0;"><p style="font-size:11px;font-weight:bold;color:#991b1b;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Reviewer Notes</p><p style="font-size:13px;color:#7f1d1d;margin:0;line-height:1.6;">${rejectionNotes.trim().replace(/\n/g, '<br>')}</p></div><p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">Log in to Field Manager Pro to view the updated record.</p></td></tr></table></td></tr></table></body></html>`
  ).catch(() => {})

  // Audit logs
  await query(
    `INSERT INTO accountability_audit_log (doc_id, action, actor_id, actor_name, notes) VALUES ($1,'rejected',$2,$3,$4)`,
    [doc.id, session.id, session.fullName, rejectionNotes.trim()]
  ).catch(() => {})
  await query(
    `INSERT INTO accountability_audit_log (doc_id, action, actor_id, actor_name, notes) VALUES ($1,'auto_created_verbal',$2,$3,$4)`,
    [newDoc.id, session.id, session.fullName, `Auto-created from rejected doc ${doc.ref_number}`]
  ).catch(() => {})

  return NextResponse.json({ ok: true, newDocId: newDoc.id, newRefNumber })
}
