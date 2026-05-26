import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

const VIEWER_ROLES = ['manager', 'sales_director', 'owner', 'ops_manager', 'developer']

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VIEWER_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const orgFilter = await getOrgFilter(session)

  const doc = await queryOne<{
    id: string; ref_number: string; org_id: string
    subject_id: string; subject_name: string; subject_role: string; subject_email: string
    author_id: string; author_name: string; author_role: string; author_email: string
    level: string; title: string; incident_date: string; notes: string; expectations: string
    status: string; sd_id: string | null; sd_name: string | null; sd_email: string | null
    approver_id: string | null; approver_name: string | null; approved_at: string | null
    rejected_at: string | null; rejected_by_id: string | null; rejected_by_name: string | null; rejection_notes: string | null
    parent_rejected_doc_id: string | null
    revision_notes: string | null; revision_requested_by_name: string | null; revision_requested_at: string | null
    conversation_status: string | null; conversation_approved_at: string | null
    ack_token: string | null; ack_status: string; ack_at: string | null
    created_at: string
  }>(
    `SELECT * FROM accountability_docs WHERE id = $1`,
    [id]
  )

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Org isolation
  if (orgFilter.filterByOrg && orgFilter.orgId && doc.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // DMs only see their own docs
  if (session.role === 'manager' && doc.author_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // SD only sees docs in their scope
  if (session.role === 'sales_director' && doc.sd_id !== session.id && doc.author_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Prior convos
  const priorConvos = await query<{ id: string; convo_date: string; notes: string }>(
    `SELECT id, convo_date::text, notes FROM accountability_prior_convos
     WHERE doc_id = $1 ORDER BY sort_order, convo_date`,
    [id]
  )

  // Linked verbals
  const linkedVerbals = await query<{ ref_number: string; level: string; title: string; incident_date: string; status: string }>(
    `SELECT d.ref_number, d.level, d.title, d.incident_date::text, d.status
     FROM accountability_linked_verbals lv
     JOIN accountability_docs d ON d.id = lv.linked_verbal_id
     WHERE lv.doc_id = $1`,
    [id]
  )

  // Audit log
  const auditLog = await query<{ action: string; actor_name: string | null; notes: string | null; created_at: string }>(
    `SELECT action, actor_name, notes, created_at FROM accountability_audit_log
     WHERE doc_id = $1 ORDER BY created_at ASC`,
    [id]
  )

  return NextResponse.json({ ...doc, priorConvos, linkedVerbals, auditLog })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Only the DM author can revise and resubmit
  if (!['manager', 'ops_manager', 'sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const orgFilter = await getOrgFilter(session)

  const doc = await queryOne<{
    id: string; ref_number: string; org_id: string; level: string; title: string
    author_id: string; author_name: string; status: string
    sd_id: string | null; sd_name: string | null; sd_email: string | null
  }>(`SELECT id, ref_number, org_id, level, title, author_id, author_name, status, sd_id, sd_name, sd_email FROM accountability_docs WHERE id = $1`, [id])

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status !== 'needs_revision') return NextResponse.json({ error: 'Document is not in revision state' }, { status: 400 })
  if (doc.author_id !== session.id && session.role !== 'developer') {
    return NextResponse.json({ error: 'Only the document author can resubmit' }, { status: 403 })
  }
  if (orgFilter.filterByOrg && orgFilter.orgId && doc.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { title, notes, expectations } = body

  if (!title?.trim() || !notes?.trim() || !expectations?.trim()) {
    return NextResponse.json({ error: 'Title, notes, and expectations are required' }, { status: 400 })
  }

  await query(
    `UPDATE accountability_docs
     SET title = $1, notes = $2, expectations = $3, status = 'pending_approval'
     WHERE id = $4`,
    [title.trim(), notes.trim(), expectations.trim(), doc.id]
  )

  // Re-notify SD and owners
  const { sendPushToUser } = await import('@/lib/apns')
  const { sendEmail } = await import('@/lib/notifications')
  const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

  if (doc.sd_id) {
    sendPushToUser(doc.sd_id, 'Accountability Doc Revised & Resubmitted',
      `${session.fullName} has revised and resubmitted ${doc.ref_number} for your review.`,
      'accountability'
    ).catch(() => {})
  }

  // Notify owners
  const owners = await query<{ id: string; email: string; full_name: string }>(
    `SELECT id, email, full_name FROM users WHERE org_id = $1 AND role IN ('owner','developer') AND is_active = TRUE`,
    [doc.org_id]
  )
  for (const owner of owners) {
    sendPushToUser(owner.id, 'Accountability Doc Resubmitted',
      `${session.fullName} has resubmitted ${doc.ref_number} after revision. Please review.`,
      'accountability'
    ).catch(() => {})
    sendEmail(owner.email,
      `[ACTION REQUIRED] Accountability Doc Resubmitted — ${doc.ref_number}`,
      `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#e5e7eb;font-family:'Arial',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #d1d5db;"><tr><td style="background:#1e3a5f;padding:22px 32px;text-align:center;"><h1 style="color:#bfdbfe;font-size:15px;letter-spacing:1px;text-transform:uppercase;margin:0;">Accountability Doc Resubmitted for Approval</h1></td></tr><tr><td style="padding:28px 32px;"><p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;"><strong>${session.fullName}</strong> has revised and resubmitted accountability document <strong>${doc.ref_number}</strong> after your revision request. Please log in to <a href="${APP_URL}/accountability" style="color:#1e3a5f;">Field Manager Pro</a> to review.</p></td></tr></table></td></tr></table></body></html>`
    ).catch(() => {})
  }

  await query(
    `INSERT INTO accountability_audit_log (doc_id, action, actor_id, actor_name, notes) VALUES ($1,'resubmitted',$2,$3,$4)`,
    [doc.id, session.id, session.fullName, 'Document revised and resubmitted for approval after revision request']
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'developer') return NextResponse.json({ error: 'Forbidden — developer only' }, { status: 403 })

  const { id } = await params

  await query(`DELETE FROM accountability_audit_log WHERE doc_id = $1`, [id])
  await query(`DELETE FROM accountability_prior_convos WHERE doc_id = $1`, [id])
  await query(`DELETE FROM accountability_linked_verbals WHERE doc_id = $1 OR linked_verbal_id = $1`, [id])
  await query(`DELETE FROM accountability_docs WHERE id = $1`, [id])

  return NextResponse.json({ ok: true })
}
