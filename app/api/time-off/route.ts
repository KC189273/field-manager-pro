import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendEmail, timeOffRequestedHtml, timeOffDecisionHtml } from '@/lib/notifications'
import { getReceiptViewUrl } from '@/lib/s3'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS time_off_requests (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id),
      approver_id UUID NOT NULL REFERENCES users(id),
      org_id      UUID,
      start_date  DATE NOT NULL,
      end_date    DATE NOT NULL,
      reason      TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      notes       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE time_off_requests ADD COLUMN IF NOT EXISTS partial_day BOOLEAN NOT NULL DEFAULT FALSE`)
  await query(`ALTER TABLE time_off_requests ADD COLUMN IF NOT EXISTS partial_start_time TIME`)
  await query(`ALTER TABLE time_off_requests ADD COLUMN IF NOT EXISTS partial_end_time TIME`)
}

function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`
}

// GET /api/time-off — own requests + pending approvals
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const myRequests = await query(`
    SELECT tor.id, tor.start_date::text, tor.end_date::text, tor.reason,
           tor.status, tor.notes, tor.created_at::text,
           tor.partial_day, tor.partial_start_time::text, tor.partial_end_time::text,
           a.full_name AS approver_name
    FROM time_off_requests tor
    JOIN users a ON a.id = tor.approver_id
    WHERE tor.user_id = $1
    ORDER BY tor.created_at DESC
  `, [session.id])

  const pendingApprovals = await query(`
    SELECT tor.id, tor.start_date::text, tor.end_date::text, tor.reason,
           tor.status, tor.notes, tor.created_at::text,
           tor.partial_day, tor.partial_start_time::text, tor.partial_end_time::text,
           u.full_name AS user_name, u.id AS user_id, u.avatar_key AS user_avatar_key
    FROM time_off_requests tor
    JOIN users u ON u.id = tor.user_id
    WHERE tor.approver_id = $1 AND tor.status = 'pending'
    ORDER BY tor.created_at ASC
  `, [session.id])

  const pendingApprovalsWithAvatars = await Promise.all(
    (pendingApprovals as Record<string, unknown>[]).map(async p => ({
      ...p,
      user_avatar_url: p.user_avatar_key ? await getReceiptViewUrl(p.user_avatar_key as string) : null,
    }))
  )
  return NextResponse.json({ myRequests, pendingApprovals: pendingApprovalsWithAvatars })
}

// POST /api/time-off — submit a new request
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const { startDate, endDate, reason, partialDay, partialStartTime, partialEndTime } = await req.json()
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }
  if (new Date(startDate) > new Date(endDate)) {
    return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 })
  }
  if (partialDay && (!partialStartTime || !partialEndTime)) {
    return NextResponse.json({ error: 'Start time and end time are required for partial day requests' }, { status: 400 })
  }

  // Find approver via manager_id chain
  const user = await queryOne<{ manager_id: string | null; org_id: string | null }>(
    `SELECT manager_id, org_id FROM users WHERE id = $1`,
    [session.id]
  )

  let approverId: string | null = user?.manager_id ?? null

  // Fall back to org owner if no manager assigned
  if (!approverId && user?.org_id) {
    const orgOwner = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE org_id = $1 AND role = 'owner' AND is_active = TRUE LIMIT 1`,
      [user.org_id]
    )
    approverId = orgOwner?.id ?? null
  }

  if (!approverId) {
    return NextResponse.json({ error: 'No approver found. Please contact your manager.' }, { status: 400 })
  }

  const orgFilter = await getOrgFilter(session)
  const orgId = orgFilter.filterByOrg ? orgFilter.orgId : (user?.org_id ?? null)

  const result = await queryOne<{ id: string }>(
    `INSERT INTO time_off_requests (user_id, approver_id, org_id, start_date, end_date, reason, partial_day, partial_start_time, partial_end_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [session.id, approverId, orgId, startDate, endDate, reason?.trim() || null,
     partialDay ? true : false,
     partialDay ? partialStartTime : null,
     partialDay ? partialEndTime : null]
  )

  const dateDisplay = partialDay && partialStartTime && partialEndTime
    ? `${fmtDate(startDate)} (${fmtTime12(partialStartTime)} – ${fmtTime12(partialEndTime)})`
    : `${fmtDate(startDate)} – ${fmtDate(endDate)}`

  // Create a flag so it appears in the approver's flags list
  try {
    await query(
      `INSERT INTO flags (user_id, type, date, detail) VALUES ($1, 'time_off_request', CURRENT_DATE, $2)`,
      [session.id, `${session.fullName} requested time off: ${dateDisplay}`]
    )
  } catch {}

  // Notify approver
  const approver = await queryOne<{ email: string; full_name: string }>(
    `SELECT email, full_name FROM users WHERE id = $1`,
    [approverId]
  )

  if (approver?.email && await isEmailEnabled(approverId)) {
    sendEmail(
      approver.email,
      `Time off request from ${session.fullName}`,
      timeOffRequestedHtml(approver.full_name, session.fullName, fmtDate(startDate), fmtDate(endDate), reason?.trim() || null)
    ).catch(() => {})
  }
  sendPushToUser(approverId, 'Time Off Request', `${session.fullName} requested ${dateDisplay}`, 'time_off_request').catch(() => {})

  return NextResponse.json({ ok: true, id: result?.id })
}

// PUT /api/time-off — edit own pending request
export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { requestId, startDate, endDate, reason, partialDay, partialStartTime, partialEndTime } = await req.json()
  if (!requestId || !startDate || !endDate) {
    return NextResponse.json({ error: 'requestId, startDate, and endDate are required' }, { status: 400 })
  }
  if (new Date(startDate) > new Date(endDate)) {
    return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 })
  }
  if (partialDay && (!partialStartTime || !partialEndTime)) {
    return NextResponse.json({ error: 'Start time and end time are required for partial day requests' }, { status: 400 })
  }

  const request = await queryOne<{ user_id: string; status: string }>(
    `SELECT user_id, status FROM time_off_requests WHERE id = $1`,
    [requestId]
  )
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (request.user_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (request.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be edited' }, { status: 400 })

  await query(
    `UPDATE time_off_requests SET start_date = $1, end_date = $2, reason = $3,
     partial_day = $4, partial_start_time = $5, partial_end_time = $6, updated_at = NOW() WHERE id = $7`,
    [startDate, endDate, reason?.trim() || null,
     partialDay ? true : false,
     partialDay ? partialStartTime : null,
     partialDay ? partialEndTime : null,
     requestId]
  )

  return NextResponse.json({ ok: true })
}

// DELETE /api/time-off — cancel own request
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { requestId } = await req.json()
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

  const request = await queryOne<{ user_id: string; status: string }>(
    `SELECT user_id, status FROM time_off_requests WHERE id = $1`,
    [requestId]
  )
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (request.user_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (request.status === 'denied') return NextResponse.json({ error: 'Denied requests cannot be cancelled' }, { status: 400 })

  await query(`DELETE FROM time_off_requests WHERE id = $1`, [requestId])

  // Resolve any open flag for this request
  try {
    await query(
      `UPDATE flags SET resolved = TRUE WHERE user_id = $1 AND type = 'time_off_request' AND resolved = FALSE`,
      [session.id]
    )
  } catch {}

  return NextResponse.json({ ok: true })
}

// PATCH /api/time-off — approve or deny
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { requestId, status, notes } = await req.json()
  if (!requestId || !status) return NextResponse.json({ error: 'requestId and status required' }, { status: 400 })
  if (!['approved', 'denied'].includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  if (status === 'denied' && !notes?.trim()) {
    return NextResponse.json({ error: 'A note is required when denying a request' }, { status: 400 })
  }

  const request = await queryOne<{ user_id: string; approver_id: string; start_date: string; end_date: string; status: string }>(
    `SELECT user_id, approver_id, start_date::text, end_date::text, status FROM time_off_requests WHERE id = $1`,
    [requestId]
  )
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (request.approver_id !== session.id && session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (request.status !== 'pending') {
    return NextResponse.json({ error: 'This request has already been decided' }, { status: 400 })
  }

  await query(
    `UPDATE time_off_requests SET status = $1, notes = $2, updated_at = NOW() WHERE id = $3`,
    [status, notes?.trim() || null, requestId]
  )

  // Resolve the flag
  await query(
    `UPDATE flags SET resolved = TRUE, resolved_by = $1, resolved_at = NOW()
     WHERE user_id = $2 AND type = 'time_off_request' AND resolved = FALSE`,
    [session.id, request.user_id]
  )

  // Notify requester
  const requester = await queryOne<{ email: string; full_name: string }>(
    `SELECT email, full_name FROM users WHERE id = $1`,
    [request.user_id]
  )

  if (requester?.email && await isEmailEnabled(request.user_id)) {
    sendEmail(
      requester.email,
      `Your time off request was ${status}`,
      timeOffDecisionHtml(requester.full_name, status as 'approved' | 'denied', fmtDate(request.start_date), fmtDate(request.end_date), notes?.trim() || null)
    ).catch(() => {})
  }

  const pushTitle = status === 'approved' ? 'Time Off Approved ✓' : 'Time Off Request Denied'
  const pushBody = `Your request for ${fmtDate(request.start_date)} – ${fmtDate(request.end_date)} was ${status}.`
  sendPushToUser(request.user_id, pushTitle, pushBody, 'time_off_request').catch(() => {})

  return NextResponse.json({ ok: true })
}
