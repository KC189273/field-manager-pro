import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

const CAN_ACCESS = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

// GET /api/calendar/attachment-url?id=<attachmentId>
// Returns a presigned view URL for a calendar attachment
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const row = await queryOne<{ s3_key: string; filename: string }>(
    `SELECT s3_key, filename FROM calendar_event_attachments WHERE id = $1`, [id]
  )
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const url = await getReceiptViewUrl(row.s3_key)
  return NextResponse.json({ url, filename: row.filename })
}

// POST /api/calendar/attachment-url
// Saves attachment metadata after successful S3 upload
// Body: { eventId, key, filename, contentType }
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { eventId, key, filename, contentType } = await req.json()
  if (!eventId || !key || !filename) {
    return NextResponse.json({ error: 'eventId, key, and filename required' }, { status: 400 })
  }

  const result = await queryOne<{ id: string }>(`
    INSERT INTO calendar_event_attachments (event_id, s3_key, filename, content_type, created_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id::text as id
  `, [eventId, key, filename, contentType || null, session.id])

  return NextResponse.json({ ok: true, id: result?.id })
}

// DELETE /api/calendar/attachment-url
// Removes attachment record
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const row = await queryOne<{ created_by: string | null }>(
    `SELECT created_by::text FROM calendar_event_attachments WHERE id = $1`, [id]
  )
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const elevated = ['ops_manager', 'owner', 'developer', 'sales_director'].includes(session.role)
  if (row.created_by !== session.id && !elevated) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await query(`DELETE FROM calendar_event_attachments WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
