import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

const ALLOWED_ROLES = ['owner', 'sales_director', 'developer']

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const doc = await queryOne<{
    id: string; ref_number: string; level: string
    subject_id: string; subject_name: string
    status: string; ack_status: string; org_id: string
  }>(
    `SELECT id, ref_number, level, subject_id, subject_name, status, ack_status, org_id
     FROM accountability_docs WHERE id = $1`,
    [id]
  )

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status !== 'approved') return NextResponse.json({ error: 'Document is not yet approved' }, { status: 400 })
  if (doc.ack_status !== 'pending') return NextResponse.json({ error: 'Document has already been acknowledged' }, { status: 400 })

  const levelLabel = doc.level === 'verbal' ? 'Verbal Notice'
    : doc.level === 'written' ? 'Written Notice (2nd Level)' : 'Final Written Notice (3rd Level)'

  await sendPushToUser(
    doc.subject_id,
    'Reminder — Acknowledgment Required',
    `Please acknowledge your ${levelLabel} (${doc.ref_number}) in Field Manager Pro.`,
    'accountability'
  ).catch(() => {})

  await query(
    `INSERT INTO accountability_audit_log (doc_id, action, actor_id, actor_name, notes)
     VALUES ($1, 'manual_reminder_sent', $2, $3, $4)`,
    [id, session.id, session.fullName, `Manual reminder sent to ${doc.subject_name} by ${session.fullName}`]
  )

  return NextResponse.json({ ok: true })
}
