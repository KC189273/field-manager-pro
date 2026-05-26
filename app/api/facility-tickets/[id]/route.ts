import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'
import { sendPushToUser } from '@/lib/apns'

const canManage = (role: string) =>
  isOwner(role as never) || role === 'developer' || role === 'ops_manager' || role === 'manager'

// GET /api/facility-tickets/[id] — single ticket with update timeline
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const ticket = await queryOne<{
    id: string; store_address: string | null; category: string; custom_category: string | null
    title: string; description: string | null; urgency: string; photo_key: string | null
    status: string; submitted_by: string | null; submitted_by_name: string
    created_at: string; updated_at: string
  }>(`
    SELECT id, store_address, category, custom_category, title, description,
           urgency, photo_key, status, submitted_by, submitted_by_name,
           created_at::text, updated_at::text
    FROM facility_tickets WHERE id = $1
  `, [id])

  if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Scope check
  if (session.role === 'employee' && ticket.submitted_by !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updates = await query<{
    id: string; updated_by_name: string; status: string; note: string | null; created_at: string
  }>(`
    SELECT id, updated_by_name, status, note, created_at::text
    FROM facility_ticket_updates
    WHERE ticket_id = $1
    ORDER BY created_at ASC
  `, [id])

  const photo_url = ticket.photo_key ? await getReceiptViewUrl(ticket.photo_key) : null

  return NextResponse.json({ ticket: { ...ticket, photo_url }, updates })
}

// PATCH /api/facility-tickets/[id] — update status with note
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session || !canManage(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { status, note } = await req.json()

  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const ticket = await queryOne<{ submitted_by: string | null; title: string; status: string; store_id: string | null }>(
    `SELECT submitted_by, title, status, store_id FROM facility_tickets WHERE id = $1`, [id]
  )
  if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // DMs can only update tickets for their assigned stores
  if (session.role === 'manager') {
    if (!ticket.store_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const owned = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, ticket.store_id]
    )
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await query(
    `UPDATE facility_tickets SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id]
  )

  await query(`
    INSERT INTO facility_ticket_updates (ticket_id, updated_by, updated_by_name, status, note)
    VALUES ($1,$2,$3,$4,$5)
  `, [id, session.id, session.fullName, status, note?.trim() || null])

  // Notify submitter via push only
  if (ticket.submitted_by) {
    const statusLabel = status === 'in_progress' ? 'In Progress' : status === 'closed' ? 'Closed' : status === 'open' ? 'Reopened' : 'Resolved'
    const msg = note?.trim()
      ? `${statusLabel}: ${note.trim()}`
      : `Your request "${ticket.title}" has been marked ${statusLabel}.`
    sendPushToUser(ticket.submitted_by, `Facility Request ${statusLabel}`, msg, 'facility_update').catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
