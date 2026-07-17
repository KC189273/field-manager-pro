import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { getReceiptViewUrl } from '@/lib/s3'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'
import crypto from 'crypto'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

// ─── Roles allowed to author accountability docs ──────────────────────────────
const AUTHOR_ROLES = ['manager', 'sales_director', 'owner', 'developer']
const VIEWER_ROLES = ['manager', 'sales_director', 'owner', 'ops_manager', 'developer']

// ─── Table setup ─────────────────────────────────────────────────────────────
let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS accountability_docs (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref_number            TEXT NOT NULL UNIQUE,
      org_id                UUID NOT NULL,

      subject_id            UUID NOT NULL,
      subject_name          TEXT NOT NULL,
      subject_role          TEXT NOT NULL,
      subject_email         TEXT NOT NULL,

      author_id             UUID NOT NULL,
      author_name           TEXT NOT NULL,
      author_role           TEXT NOT NULL,
      author_email          TEXT NOT NULL,

      level                 TEXT NOT NULL CHECK (level IN ('verbal','written','final')),
      title                 TEXT NOT NULL,
      incident_date         DATE NOT NULL,
      notes                 TEXT NOT NULL,
      expectations          TEXT NOT NULL,

      status                TEXT NOT NULL DEFAULT 'pending_approval'
                              CHECK (status IN ('pending_approval','approved','rejected')),

      sd_id                 UUID,
      sd_name               TEXT,
      sd_email              TEXT,

      approver_id           UUID,
      approver_name         TEXT,
      approved_at           TIMESTAMPTZ,

      rejected_at           TIMESTAMPTZ,
      rejected_by_id        UUID,
      rejected_by_name      TEXT,
      rejection_notes       TEXT,
      parent_rejected_doc_id UUID,

      ack_token             TEXT UNIQUE,
      ack_status            TEXT NOT NULL DEFAULT 'pending'
                              CHECK (ack_status IN ('pending','acknowledged','refused')),
      ack_at                TIMESTAMPTZ,
      ack_reminded_at       TIMESTAMPTZ,
      escalation_sent_at    TIMESTAMPTZ,

      reminder_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_acc_org     ON accountability_docs(org_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_acc_subject ON accountability_docs(subject_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_acc_author  ON accountability_docs(author_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_acc_status  ON accountability_docs(status)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_acc_token   ON accountability_docs(ack_token)`)

  await query(`
    CREATE TABLE IF NOT EXISTS accountability_prior_convos (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_id     UUID NOT NULL,
      convo_date DATE NOT NULL,
      notes      TEXT NOT NULL,
      sort_order INT  NOT NULL DEFAULT 0
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_acc_pc_doc ON accountability_prior_convos(doc_id)`)

  await query(`
    CREATE TABLE IF NOT EXISTS accountability_linked_verbals (
      doc_id          UUID NOT NULL,
      linked_verbal_id UUID NOT NULL,
      PRIMARY KEY (doc_id, linked_verbal_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS accountability_audit_log (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_id     UUID NOT NULL,
      action     TEXT NOT NULL,
      actor_id   UUID,
      actor_name TEXT,
      notes      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_acc_audit_doc ON accountability_audit_log(doc_id)`)

  // Migrate: add needs_revision status + revision columns
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS revision_notes TEXT`).catch(() => {})
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS revision_requested_by_name TEXT`).catch(() => {})
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS revision_requested_at TIMESTAMPTZ`).catch(() => {})
  await query(`ALTER TABLE accountability_docs DROP CONSTRAINT IF EXISTS accountability_docs_status_check`).catch(() => {})
  await query(`ALTER TABLE accountability_docs ADD CONSTRAINT accountability_docs_status_check CHECK (status IN ('pending_approval','approved','rejected','needs_revision'))`).catch(() => {})
  // Migrate: add conversation workflow columns
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_status TEXT`).catch(() => {})
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_approved_at TIMESTAMPTZ`).catch(() => {})
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_escalated_at TIMESTAMPTZ`).catch(() => {})
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ`).catch(() => {})
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS transferred_to UUID`).catch(() => {})
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS transferred_to_name TEXT`).catch(() => {})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function generateRefNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `ACC-${year}-`
  const row = await queryOne<{ max_seq: string | null }>(
    `SELECT MAX(SUBSTRING(ref_number FROM ${prefix.length + 1})::int)::text AS max_seq
     FROM accountability_docs
     WHERE org_id = $1 AND ref_number LIKE $2`,
    [orgId, `${prefix}%`]
  )
  const seq = ((parseInt(row?.max_seq ?? '0') || 0) + 1).toString().padStart(4, '0')
  return `${prefix}${seq}`
}

function generateAckToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// Find the SD for a DM (via manager_id chain) or owners if author is SD
async function findApproversForAuthor(authorId: string, authorRole: string, orgId: string): Promise<{
  sd: { id: string; name: string; email: string } | null
  owners: Array<{ id: string; name: string; email: string; role: string }>
}> {
  let sd: { id: string; name: string; email: string } | null = null

  if (authorRole === 'manager') {
    const sdRow = await queryOne<{ id: string; full_name: string; email: string }>(
      `SELECT u.id, u.full_name, u.email
       FROM users u
       WHERE u.id = (SELECT manager_id FROM users WHERE id = $1)
         AND u.role = 'sales_director'`,
      [authorId]
    )
    if (sdRow) sd = { id: sdRow.id, name: sdRow.full_name, email: sdRow.email }
  }

  const ownerRows = await query<{ id: string; full_name: string; email: string; role: string }>(
    `SELECT id, full_name, email, role FROM users
     WHERE role IN ('owner','developer') AND org_id = $1 AND is_active = TRUE`,
    [orgId]
  )
  const owners = ownerRows.map(r => ({ id: r.id, name: r.full_name, email: r.email, role: r.role }))
  return { sd, owners }
}

async function auditLog(docId: string, action: string, actorId?: string, actorName?: string, notes?: string) {
  await query(
    `INSERT INTO accountability_audit_log (doc_id, action, actor_id, actor_name, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [docId, action, actorId ?? null, actorName ?? null, notes ?? null]
  ).catch(() => {})
}

// ─── Email builders ───────────────────────────────────────────────────────────
function levelLabel(level: string): string {
  if (level === 'verbal') return 'Verbal Notice'
  if (level === 'written') return 'Written Notice — 2nd Level'
  return 'Final Written Notice — 3rd Level'
}
function levelShort(level: string): string {
  if (level === 'verbal') return 'VERBAL'
  if (level === 'written') return 'WRITTEN — 2ND LEVEL'
  return 'FINAL — 3RD LEVEL'
}
function levelColor(level: string): string {
  if (level === 'verbal') return '#b45309'
  if (level === 'written') return '#c2410c'
  return '#991b1b'
}
function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function buildFormalDocHtml(params: {
  refNumber: string
  level: string
  title: string
  subjectName: string
  subjectRole: string
  authorName: string
  authorRole: string
  incidentDate: string
  notes: string
  expectations: string
  docDate: string
  priorConvos?: Array<{ convo_date: string; notes: string }>
  linkedVerbals?: Array<{ ref_number: string; title: string; incident_date: string }>
  ackLink?: string
  isRetainedCopy?: boolean
  isSdCopy?: boolean
  isApprovalRequest?: boolean
  rejectionNote?: string
}): string {
  const {
    refNumber, level, title, subjectName, subjectRole, authorName, authorRole,
    incidentDate, notes, expectations, docDate,
    priorConvos, linkedVerbals, ackLink,
    isRetainedCopy, isSdCopy, isApprovalRequest, rejectionNote
  } = params

  const authorRoleLabel = authorRole === 'manager' ? 'District Manager'
    : authorRole === 'sales_director' ? 'Sales Director' : authorRole
  const subjectRoleLabel = subjectRole === 'employee' ? 'Team Member'
    : subjectRole === 'manager' ? 'District Manager' : subjectRole

  const priorConvosHtml = priorConvos?.length ? `
    <div style="margin-bottom:24px;">
      <h3 style="font-size:11px;color:#777;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e0e0e0;padding-bottom:6px;">Prior Conversations on Record</h3>
      ${priorConvos.map((c, i) => `
        <div style="margin-bottom:12px;padding:12px 14px;background:#fefce8;border-left:3px solid #ca8a04;">
          <p style="font-size:12px;font-weight:bold;color:#92400e;margin:0 0 6px;font-family:'Arial',sans-serif;">Conversation ${i + 1} — ${formatDate(c.convo_date)}</p>
          <p style="font-size:13px;color:#333;margin:0;line-height:1.6;">${c.notes.replace(/\n/g, '<br>')}</p>
        </div>
      `).join('')}
    </div>` : ''

  const linkedVerbalsHtml = linkedVerbals?.length ? `
    <div style="margin-bottom:24px;">
      <h3 style="font-size:11px;color:#777;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e0e0e0;padding-bottom:6px;">Related Prior Accountability Records</h3>
      ${linkedVerbals.map(v => `
        <div style="padding:10px 14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:8px;">
          <p style="font-size:13px;font-weight:bold;color:#1a1a2e;margin:0;font-family:'Arial',sans-serif;">${v.ref_number} — ${v.title}</p>
          <p style="font-size:12px;color:#777;margin:3px 0 0;font-family:'Arial',sans-serif;">Date of Incident: ${formatDate(v.incident_date)}</p>
        </div>
      `).join('')}
    </div>` : ''

  const finalWarningHtml = level === 'final' ? `
    <div style="margin-bottom:24px;padding:16px 20px;background:#fef2f2;border:2px solid #dc2626;border-radius:4px;">
      <p style="font-size:12px;font-weight:bold;color:#991b1b;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-family:'Arial',sans-serif;">⚠ Final Written Notice</p>
      <p style="font-size:13px;color:#7f1d1d;margin:0;line-height:1.7;font-family:'Arial',sans-serif;">
        This serves as your <strong>third and final written notice</strong>. Failure to correct the issues outlined in this document could result in further disciplinary action, up to and including termination of employment.
      </p>
    </div>` : ''

  const ackHtml = ackLink ? `
    <div style="margin-top:30px;padding:20px 24px;background:#f0f4ff;border:2px solid #3b4db8;border-radius:6px;text-align:center;">
      <p style="font-size:14px;font-weight:bold;color:#1e2a7a;margin:0 0 8px;font-family:'Arial',sans-serif;">Acknowledgment of Receipt Required</p>
      <p style="font-size:12px;color:#374151;margin:0 0 16px;line-height:1.6;font-family:'Arial',sans-serif;">
        By clicking the button below, you confirm you have received and reviewed this official document.<br>
        <strong>This is not an admission of guilt or agreement with its contents</strong> — it is solely an acknowledgment that you have received it.<br>
        <em>Failure to acknowledge receipt may result in administrative action including restriction from returning to scheduled duties until acknowledgment is completed.</em>
      </p>
      <a href="${ackLink}" style="display:inline-block;background:#1e2a7a;color:#ffffff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold;font-family:'Arial',sans-serif;letter-spacing:0.5px;">
        Acknowledge Receipt
      </a>
      <p style="font-size:11px;color:#9ca3af;margin:12px 0 0;font-family:'Arial',sans-serif;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <span style="color:#3b4db8;">${ackLink}</span>
      </p>
    </div>` : ''

  const copyBanner = isRetainedCopy
    ? `<div style="background:#1a3a1a;padding:10px 40px;text-align:center;"><p style="color:#86efac;font-size:11px;font-family:'Arial',sans-serif;letter-spacing:2px;text-transform:uppercase;margin:0;">RETAINED COPY — FOR YOUR RECORDS</p></div>`
    : isSdCopy
    ? `<div style="background:#1a2a3a;padding:10px 40px;text-align:center;"><p style="color:#93c5fd;font-size:11px;font-family:'Arial',sans-serif;letter-spacing:2px;text-transform:uppercase;margin:0;">SALES DIRECTOR COPY — APPROVED &amp; FILED</p></div>`
    : ''

  const approvalRequestBanner = isApprovalRequest
    ? `<div style="background:#7c2d12;padding:14px 40px;text-align:center;"><p style="color:#fed7aa;font-size:12px;font-family:'Arial',sans-serif;letter-spacing:1px;text-transform:uppercase;margin:0 0 4px;font-weight:bold;">ACTION REQUIRED — PENDING YOUR APPROVAL</p><p style="color:#fdba74;font-size:11px;font-family:'Arial',sans-serif;margin:0;">Log in to Field Manager Pro to review, approve, or reject this document.</p></div>`
    : ''

  const rejectionNoteBanner = rejectionNote
    ? `<div style="background:#fef2f2;border:1px solid #fca5a5;padding:14px 20px;margin-bottom:20px;border-radius:4px;"><p style="font-size:12px;font-weight:bold;color:#991b1b;margin:0 0 6px;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;">Document Downgraded — Review Note</p><p style="font-size:13px;color:#7f1d1d;margin:0;line-height:1.6;">${rejectionNote.replace(/\n/g, '<br>')}</p></div>`
    : ''

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e5e7eb;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #d1d5db;">

  <!-- Main Header -->
  <tr><td style="background:#0f172a;padding:28px 40px;text-align:center;">
    <p style="color:#94a3b8;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px;font-family:'Arial',sans-serif;">FIELD MANAGER PRO</p>
    <h1 style="color:#f1f5f9;font-size:18px;letter-spacing:2px;text-transform:uppercase;margin:0;font-family:'Arial',sans-serif;font-weight:bold;">OFFICIAL EMPLOYEE ACCOUNTABILITY NOTICE</h1>
  </td></tr>

  ${copyBanner ? `<tr><td>${copyBanner}</td></tr>` : ''}
  ${approvalRequestBanner ? `<tr><td>${approvalRequestBanner}</td></tr>` : ''}

  <!-- Ref + Level -->
  <tr><td style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:14px 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="font-family:'Arial',sans-serif;">
        <span style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Reference Number</span><br>
        <strong style="font-size:20px;color:#0f172a;letter-spacing:1px;">${refNumber}</strong>
      </td>
      <td align="right">
        <span style="background:${levelColor(level)};color:#ffffff;padding:6px 14px;font-size:10px;font-weight:bold;font-family:'Arial',sans-serif;letter-spacing:1.5px;text-transform:uppercase;">${levelShort(level)}</span>
      </td>
    </tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:30px 40px;">

    ${rejectionNoteBanner}

    <!-- Details table -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;margin-bottom:28px;font-family:'Arial',sans-serif;">
      <tr style="background:#f8fafc;">
        <td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;width:170px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Employee</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;"><strong>${subjectName}</strong> <span style="color:#94a3b8;font-size:11px;">(${subjectRoleLabel})</span></td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Issued By</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${authorName} <span style="color:#94a3b8;font-size:11px;">(${authorRoleLabel})</span></td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Date of Incident</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${formatDate(incidentDate)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Notice Level</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${levelLabel(level)}</td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;">Document Date</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;">${docDate}</td>
      </tr>
    </table>

    <!-- Title -->
    <h2 style="font-size:17px;color:#0f172a;margin:0 0 22px;padding-bottom:10px;border-bottom:2px solid #0f172a;font-family:'Arial',sans-serif;">${title}</h2>

    ${priorConvosHtml}
    ${linkedVerbalsHtml}

    <!-- Notes -->
    <div style="margin-bottom:24px;">
      <h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Summary of Discussion &amp; Documented Events</h3>
      <div style="background:#f8fafc;border-left:4px solid #0f172a;padding:14px 16px;font-size:13px;color:#1e293b;line-height:1.75;font-family:'Georgia',serif;">${notes.replace(/\n/g, '<br>')}</div>
    </div>

    <!-- Expectations -->
    <div style="margin-bottom:24px;">
      <h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Clear Expectations Moving Forward</h3>
      <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:14px 16px;font-size:13px;color:#14532d;line-height:1.75;font-family:'Georgia',serif;">${expectations.replace(/\n/g, '<br>')}</div>
    </div>

    ${finalWarningHtml}
    ${ackHtml}

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:18px 40px;">
    <p style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;margin:0;line-height:1.7;">
      This is an official HR document generated by Field Manager Pro on <strong>${docDate}</strong>.<br>
      Reference: <strong>${refNumber}</strong> &nbsp;|&nbsp; This document is permanently on file and cannot be altered or deleted.<br>
      Confidential — For authorized personnel only. &copy; ${new Date().getFullYear()} Field Manager Pro.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

// ─── Send all emails for an approved doc ─────────────────────────────────────
async function sendApprovedDocEmails(doc: {
  id: string; ref_number: string; level: string; title: string
  subject_id: string; subject_name: string; subject_role: string; subject_email: string
  author_id: string; author_name: string; author_role: string; author_email: string
  incident_date: string; notes: string; expectations: string
  sd_id: string | null; sd_name: string | null; sd_email: string | null
  ack_token: string
  created_at: string
}, priorConvos: Array<{ convo_date: string; notes: string }>, linkedVerbals: Array<{ ref_number: string; title: string; incident_date: string }>) {
  const ackLink = `${APP_URL}/ack/${doc.ack_token}`
  const docDate = new Date(doc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const baseParams = {
    refNumber: doc.ref_number, level: doc.level, title: doc.title,
    subjectName: doc.subject_name, subjectRole: doc.subject_role,
    authorName: doc.author_name, authorRole: doc.author_role,
    incidentDate: doc.incident_date, notes: doc.notes, expectations: doc.expectations,
    docDate, priorConvos, linkedVerbals,
  }

  const levelEmailLabel = levelLabel(doc.level).toUpperCase()

  // Email to subject (employee/DM)
  await sendEmail(
    doc.subject_email,
    `OFFICIAL NOTICE — ${levelEmailLabel} | Ref: ${doc.ref_number}`,
    buildFormalDocHtml({ ...baseParams, ackLink })
  )

  // Retained copy to author (DM/SD)
  await sendEmail(
    doc.author_email,
    `[RETAINED COPY] ${levelEmailLabel} | ${doc.subject_name} | Ref: ${doc.ref_number}`,
    buildFormalDocHtml({ ...baseParams, isRetainedCopy: true })
  )

  // SD copy (only if SD is not the author, and only for written/final)
  if (doc.sd_id && doc.sd_email && doc.sd_id !== doc.author_id && doc.level !== 'verbal') {
    await sendEmail(
      doc.sd_email,
      `[SD COPY — FILED] ${levelEmailLabel} | ${doc.subject_name} | Ref: ${doc.ref_number}`,
      buildFormalDocHtml({ ...baseParams, isSdCopy: true })
    )
  }
}

// ─── GET — list docs ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Employees: return only their own approved notices (with ack_token so they can acknowledge in-app)
  if (session.role === 'employee') {
    try { await ensureTable() } catch {}
    const myDocs = await query<{
      id: string; ref_number: string; level: string; title: string
      incident_date: string; status: string; ack_status: string; ack_at: string | null
      author_name: string; ack_token: string | null; created_at: string
    }>(
      `SELECT id, ref_number, level, title, incident_date::text, status, ack_status, ack_at,
              author_name, ack_token, created_at
       FROM accountability_docs
       WHERE subject_id = $1 AND status = 'approved'
         AND (conversation_status IS NULL OR conversation_status IN ('complete', 'bypassed'))
       ORDER BY created_at DESC`,
      [session.id]
    ).catch(() => [])
    return NextResponse.json({ docs: myDocs, pendingApproval: [], subjects: [], authors: [] })
  }

  if (!VIEWER_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch { /* already exists */ }

  const orgFilter = await getOrgFilter(session)

  // Always load subjects + authors first so the form is usable even if docs fail
  type UserRow = { id: string; full_name: string; role: string }
  let subjects: UserRow[] = []
  try {
    if (session.role === 'developer') {
      subjects = await query<UserRow>(
        `SELECT id, full_name, role FROM users
         WHERE is_active = TRUE AND role NOT IN ('developer')
         ORDER BY full_name`, []
      )
    } else if (session.role === 'owner') {
      if (orgFilter.filterByOrg && orgFilter.orgId) {
        subjects = await query<UserRow>(
          `SELECT id, full_name, role FROM users
           WHERE org_id = $1 AND is_active = TRUE AND id != $2
             AND role NOT IN ('developer')
           ORDER BY full_name`,
          [orgFilter.orgId, session.id]
        )
      }
    } else if (session.role === 'sales_director') {
      subjects = await query<UserRow>(
        `SELECT id, full_name, role FROM users
         WHERE manager_id = $1 AND role = 'manager' AND is_active = TRUE ORDER BY full_name`,
        [session.id]
      )
    } else if (session.role === 'manager') {
      subjects = await query<UserRow>(
        `SELECT id, full_name, role FROM users
         WHERE manager_id = $1 AND is_active = TRUE ORDER BY full_name`,
        [session.id]
      )
    } else if (orgFilter.filterByOrg && orgFilter.orgId) {
      subjects = await query<UserRow>(
        `SELECT id, full_name, role FROM users
         WHERE org_id = $1 AND is_active = TRUE AND role IN ('employee','manager','ops_manager')
         ORDER BY full_name`,
        [orgFilter.orgId]
      )
    }
  } catch (err) {
    console.error('Accountability: failed to load subjects:', err)
  }

  let authors: UserRow[] = []
  try {
    if (session.role !== 'manager' && orgFilter.filterByOrg && orgFilter.orgId) {
      authors = await query<UserRow>(
        `SELECT id, full_name, role FROM users
         WHERE org_id = $1 AND is_active = TRUE AND role IN ('manager','sales_director')
         ORDER BY full_name`,
        [orgFilter.orgId]
      )
    }
  } catch (err) {
    console.error('Accountability: failed to load authors:', err)
  }

  const { searchParams } = new URL(req.url)
  const dateFrom  = searchParams.get('dateFrom')
  const dateTo    = searchParams.get('dateTo')
  const subjectId = searchParams.get('subjectId')
  const authorId  = searchParams.get('authorId')
  const status    = searchParams.get('status')
  const level     = searchParams.get('level')

  let docsWithAvatars: Record<string, unknown>[] = []
  let pendingApproval: unknown[] = []

  try {
  const params: unknown[] = []
  const where: string[] = []

  // Org scoping
  if (orgFilter.filterByOrg && orgFilter.orgId) {
    params.push(orgFilter.orgId)
    where.push(`d.org_id = $${params.length}`)
  }

  // DMs see their own docs + docs transferred to them
  if (session.role === 'manager') {
    params.push(session.id)
    where.push(`(d.author_id = $${params.length} OR d.transferred_to = $${params.length})`)
  }

  if (dateFrom) { params.push(dateFrom); where.push(`d.created_at >= $${params.length}`) }
  if (dateTo)   { params.push(dateTo + 'T23:59:59'); where.push(`d.created_at <= $${params.length}`) }
  if (subjectId){ params.push(subjectId); where.push(`d.subject_id = $${params.length}`) }
  if (authorId) { params.push(authorId);  where.push(`d.author_id = $${params.length}`) }
  if (status)   { params.push(status);    where.push(`d.status = $${params.length}`) }
  if (level)    { params.push(level);     where.push(`d.level = $${params.length}`) }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const docs = await query<{
    id: string; ref_number: string; org_id: string
    subject_id: string; subject_name: string; subject_role: string
    author_id: string; author_name: string; author_role: string
    level: string; title: string; incident_date: string
    status: string; ack_status: string; ack_at: string | null
    sd_name: string | null; approver_name: string | null; approved_at: string | null
    rejected_at: string | null; rejected_by_name: string | null; rejection_notes: string | null
    created_at: string
  }>(
    `SELECT d.id, d.ref_number, d.org_id, d.subject_id, d.subject_name, d.subject_role,
            d.author_id, d.author_name, d.author_role, d.level, d.title, d.incident_date::text,
            d.status, d.ack_status, d.ack_at, d.sd_name, d.approver_name, d.approved_at,
            d.rejected_at, d.rejected_by_name, d.rejection_notes,
            d.revision_notes, d.revision_requested_by_name, d.conversation_status,
            d.created_at,
            u.avatar_key AS subject_avatar_key
     FROM accountability_docs d
     LEFT JOIN users u ON u.id = d.subject_id
     ${whereClause}
     ORDER BY d.created_at DESC
     LIMIT 200`,
    params
  )
  docsWithAvatars = await Promise.all(
    (docs as Record<string, unknown>[]).map(async d => {
      let subject_avatar_url: string | null = null
      if (d.subject_avatar_key) {
        try { subject_avatar_url = await getReceiptViewUrl(d.subject_avatar_key as string) } catch { /* non-fatal */ }
      }
      return { ...d, subject_avatar_url }
    })
  )

  // Pending approval queue — docs awaiting this SD or owner's action
  if (session.role === 'sales_director' || session.role === 'owner' || session.role === 'developer') {
    const pendingParams: unknown[] = []
    const pendingWhere: string[] = [`d.status = 'pending_approval'`]

    if (orgFilter.filterByOrg && orgFilter.orgId) {
      pendingParams.push(orgFilter.orgId)
      pendingWhere.push(`d.org_id = $${pendingParams.length}`)
    }
    // SD only sees docs where they are the assigned SD
    if (session.role === 'sales_director') {
      pendingParams.push(session.id)
      pendingWhere.push(`d.sd_id = $${pendingParams.length}`)
    }

    pendingApproval = await query(
      `SELECT d.id, d.ref_number, d.org_id, d.subject_id, d.subject_name, d.subject_role,
              d.author_id, d.author_name, d.author_role, d.level, d.title, d.incident_date::text,
              d.status, d.ack_status, d.ack_at, d.sd_name, d.approver_name, d.approved_at,
              d.rejected_at, d.rejected_by_name, d.rejection_notes, d.created_at,
              u.avatar_key AS subject_avatar_key
       FROM accountability_docs d
       LEFT JOIN users u ON u.id = d.subject_id
       WHERE ${pendingWhere.join(' AND ')}
       ORDER BY d.created_at ASC`,
      pendingParams
    )
    pendingApproval = await Promise.all(
      (pendingApproval as Record<string, unknown>[]).map(async d => {
        let subject_avatar_url: string | null = null
        if (d.subject_avatar_key) {
          try { subject_avatar_url = await getReceiptViewUrl(d.subject_avatar_key as string) } catch { /* non-fatal */ }
        }
        return { ...d, subject_avatar_url }
      })
    ) as unknown as typeof pendingApproval
  }
  } catch (err) {
    console.error('Accountability GET docs/pending error:', err)
  }

  return NextResponse.json({ docs: docsWithAvatars, pendingApproval, subjects, authors })
}

// ─── POST — create a new accountability doc ───────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!AUTHOR_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch { /* already exists */ }

  try {
  const body = await req.json()
  const {
    subjectId, level, title, incidentDate, notes, expectations,
    priorConvos, linkedVerbalIds, reminderAcknowledged, testMode,
  } = body
  const isTestMode = session.role === 'developer' && testMode === true

  if (!subjectId || !level || !title || !incidentDate || !notes || !expectations) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (!['verbal', 'written', 'final'].includes(level)) {
    return NextResponse.json({ error: 'Invalid level' }, { status: 400 })
  }
  if (!reminderAcknowledged) {
    return NextResponse.json({ error: 'You must acknowledge the documentation reminder' }, { status: 400 })
  }

  // Verify subject
  const subject = await queryOne<{ id: string; full_name: string; role: string; email: string; org_id: string; manager_id: string | null }>(
    `SELECT id, full_name, role, email, org_id, manager_id FROM users WHERE id = $1 AND is_active = TRUE`,
    [subjectId]
  )
  if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 })

  // Authorization checks
  if (session.role === 'manager') {
    // DM can only write up their direct reports
    if (subject.manager_id !== session.id) {
      return NextResponse.json({ error: 'You can only document your direct reports' }, { status: 403 })
    }
  } else if (session.role === 'sales_director') {
    // SD can only write up DMs who report to them
    if (subject.role !== 'manager' || subject.manager_id !== session.id) {
      return NextResponse.json({ error: 'You can only document DMs who report to you' }, { status: 403 })
    }
  }
  // owner: no restriction — can write up anyone in the org

  const orgId = session.org_id ?? subject.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 400 })

  // Owners and developers auto-approve all levels (no approval workflow)
  const isOwnerAuthor = session.role === 'owner'
  const isDevAuthor = session.role === 'developer'
  const autoApprove = isOwnerAuthor || isDevAuthor

  // Find approvers (only needed for DMs and SDs)
  const { sd: rawSd, owners: rawOwners } = (!autoApprove)
    ? await findApproversForAuthor(session.id, session.role, orgId)
    : { sd: null, owners: [] }
  const sd = autoApprove ? null : rawSd
  const owners = isDevAuthor ? rawOwners.filter(o => o.role === 'owner') : autoApprove ? [] : rawOwners

  // Owner/developer: always auto-approve. DM verbal: auto-approve. DM written/final: pending
  const initialStatus = (autoApprove || level === 'verbal') ? 'approved' : 'pending_approval'
  const ackToken = (autoApprove || level === 'verbal') ? generateAckToken() : null

  const freshAuthor = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [session.id])
  const authorEmail = freshAuthor?.email ?? session.email

  let refNumber = await generateRefNumber(orgId)
  let doc: { id: string; created_at: string }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await query<{ id: string; created_at: string }>(
        `INSERT INTO accountability_docs
          (ref_number, org_id, subject_id, subject_name, subject_role, subject_email,
           author_id, author_name, author_role, author_email,
           level, title, incident_date, notes, expectations,
           status, sd_id, sd_name, sd_email,
           ack_token, ack_status, reminder_acknowledged, approved_at, approver_id, approver_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         RETURNING id, created_at`,
        [
          refNumber, orgId,
          subject.id, subject.full_name, subject.role, subject.email,
          session.id, session.fullName, session.role, authorEmail,
          level, title.trim(), incidentDate, notes.trim(), expectations.trim(),
          initialStatus,
          sd?.id ?? null, sd?.name ?? null, sd?.email ?? null,
          ackToken, 'pending',
          true,
          (autoApprove || level === 'verbal') ? new Date().toISOString() : null,
          (autoApprove || level === 'verbal') ? session.id : null,
          (autoApprove || level === 'verbal') ? session.fullName : null,
        ]
      )
      doc = rows[0]
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (attempt < 4 && msg.includes('ref_number')) {
        refNumber = await generateRefNumber(orgId)
        continue
      }
      throw err
    }
  }
  doc = doc!

  // Insert prior convos
  if (Array.isArray(priorConvos) && priorConvos.length) {
    for (let i = 0; i < priorConvos.length; i++) {
      const c = priorConvos[i]
      if (c.convo_date && c.notes) {
        await query(
          `INSERT INTO accountability_prior_convos (doc_id, convo_date, notes, sort_order) VALUES ($1,$2,$3,$4)`,
          [doc.id, c.convo_date, c.notes.trim(), i]
        )
      }
    }
  }

  // Link prior verbals
  if (Array.isArray(linkedVerbalIds) && linkedVerbalIds.length) {
    for (const vid of linkedVerbalIds) {
      await query(
        `INSERT INTO accountability_linked_verbals (doc_id, linked_verbal_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [doc.id, vid]
      ).catch(() => {})
    }
  }

  await auditLog(doc.id, 'submitted', session.id, session.fullName, `Level: ${level}`)

  if (autoApprove || level === 'verbal') {
    // Auto-approved: send emails immediately (owner docs + all verbals)
    const linkedVerbals = linkedVerbalIds?.length ? await query<{ ref_number: string; title: string; incident_date: string }>(
      `SELECT ref_number, title, incident_date::text FROM accountability_docs WHERE id = ANY($1::uuid[])`,
      [linkedVerbalIds]
    ) : []
    const savedPriorConvos = Array.isArray(priorConvos)
      ? priorConvos.filter(c => c.convo_date && c.notes).map(c => ({ convo_date: c.convo_date, notes: c.notes }))
      : []

    if (isTestMode) {
      await auditLog(doc.id, 'emails_sent', session.id, session.fullName, 'TEST MODE — notifications suppressed')
    } else {
      const docFull = {
        id: doc.id, ref_number: refNumber, level, title, incident_date: incidentDate,
        subject_id: subject.id, subject_name: subject.full_name, subject_role: subject.role, subject_email: subject.email,
        author_id: session.id, author_name: session.fullName, author_role: session.role, author_email: authorEmail,
        notes, expectations, sd_id: sd?.id ?? null, sd_name: sd?.name ?? null, sd_email: sd?.email ?? null,
        ack_token: ackToken!, created_at: doc.created_at,
      }
      await sendApprovedDocEmails(docFull, savedPriorConvos, linkedVerbals).catch((emailErr: unknown) => {
        console.error('sendApprovedDocEmails error:', emailErr)
      })
      sendPushToUser(session.id, 'Accountability Notice Sent', `${refNumber} — ${subject.full_name} has been notified.`, 'accountability').catch(() => {})
      if (sd) sendPushToUser(sd.id, 'Accountability Notice Filed', `${session.fullName} filed a ${level} notice on ${subject.full_name} (${refNumber}).`, 'accountability').catch(() => {})
      await auditLog(doc.id, 'emails_sent', session.id, session.fullName, `${autoApprove ? 'Owner auto-approved' : 'Verbal'} — sent to subject and author`)
    }

  } else {
    if (isTestMode) {
      await auditLog(doc.id, 'pending_approval_notified', session.id, session.fullName, 'TEST MODE — notifications suppressed')
    } else {
      const approverIds = [...owners.map(o => o.id)]
      if (sd) approverIds.push(sd.id)

      if (approverIds.length) {
        sendPushToUsers(approverIds, 'Accountability Doc Pending Approval',
          `${session.fullName} submitted a ${level} notice on ${subject.full_name} — review required.`,
          'accountability'
        ).catch(() => {})
      }

      if (sd) {
        const approvalHtml = buildFormalDocHtml({
          refNumber, level, title,
          subjectName: subject.full_name, subjectRole: subject.role,
          authorName: session.fullName, authorRole: session.role,
          incidentDate, notes, expectations,
          docDate: new Date(doc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          priorConvos: Array.isArray(priorConvos) ? priorConvos.filter(c => c.convo_date && c.notes) : [],
          isApprovalRequest: true,
        })
        sendEmail(sd.email, `[APPROVAL REQUIRED] ${levelLabel(level).toUpperCase()} — ${subject.full_name} | Ref: ${refNumber}`, approvalHtml).catch(() => {})
      }

      for (const owner of owners) {
        const approvalHtml = buildFormalDocHtml({
          refNumber, level, title,
          subjectName: subject.full_name, subjectRole: subject.role,
          authorName: session.fullName, authorRole: session.role,
          incidentDate, notes, expectations,
          docDate: new Date(doc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          priorConvos: Array.isArray(priorConvos) ? priorConvos.filter(c => c.convo_date && c.notes) : [],
          isApprovalRequest: true,
        })
        sendEmail(owner.email, `[APPROVAL REQUIRED] ${levelLabel(level).toUpperCase()} — ${subject.full_name} | Ref: ${refNumber}`, approvalHtml).catch(() => {})
      }

      await auditLog(doc.id, 'pending_approval_notified', session.id, session.fullName, `Notified: ${[...owners.map(o => o.id), ...(sd ? [sd.id] : [])].join(', ')}`)
    }
  }

  return NextResponse.json({ ok: true, id: doc.id, refNumber })
  } catch (err) {
    console.error('POST /api/accountability error:', err)
    return NextResponse.json({ error: 'Submission failed. Please try again.' }, { status: 500 })
  }
}
