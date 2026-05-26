import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

// Fully public endpoint — no auth required
// Called by the employee acknowledgment page (no login needed)

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const doc = await queryOne<{
    id: string; ref_number: string; level: string; title: string
    subject_name: string; author_name: string; incident_date: string
    ack_status: string; ack_at: string | null; status: string
  }>(
    `SELECT id, ref_number, level, title, subject_name, author_name,
            incident_date::text, ack_status, ack_at, status
     FROM accountability_docs WHERE ack_token = $1`,
    [token]
  )

  if (!doc) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  return NextResponse.json({
    refNumber: doc.ref_number,
    level: doc.level,
    title: doc.title,
    subjectName: doc.subject_name,
    authorName: doc.author_name,
    incidentDate: doc.incident_date,
    ackStatus: doc.ack_status,
    ackAt: doc.ack_at,
    status: doc.status,
  })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const doc = await queryOne<{
    id: string; ref_number: string; level: string; title: string
    subject_name: string; author_id: string; author_name: string
    ack_status: string; status: string; sd_id: string | null
  }>(
    `SELECT id, ref_number, level, title, subject_name, author_id, author_name,
            ack_status, status, sd_id
     FROM accountability_docs WHERE ack_token = $1`,
    [token]
  )

  if (!doc) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  if (doc.ack_status === 'acknowledged') return NextResponse.json({ ok: true, alreadyAcknowledged: true })
  if (doc.status !== 'approved') return NextResponse.json({ error: 'Document is not yet approved' }, { status: 400 })

  await query(
    `UPDATE accountability_docs SET ack_status = 'acknowledged', ack_at = NOW() WHERE id = $1`,
    [doc.id]
  )

  await query(
    `INSERT INTO accountability_audit_log (doc_id, action, notes) VALUES ($1, 'acknowledged', 'Employee acknowledged receipt via email link')`,
    [doc.id]
  ).catch(() => {})

  // Notify the author that the subject acknowledged
  sendPushToUser(
    doc.author_id,
    'Acknowledgment Received',
    `${doc.subject_name} acknowledged receipt of ${doc.ref_number}.`,
    'accountability'
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
