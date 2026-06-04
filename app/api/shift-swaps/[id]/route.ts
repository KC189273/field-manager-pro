import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'
import { sendEmail, shiftSwapDmReviewHtml } from '@/lib/notifications'

const ANCHOR = new Date('2026-03-30T12:00:00.000Z')
const CST = 'America/Chicago'

function getBiWeeklyPeriod(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + 'T12:00:00Z')
  const daysSince = Math.floor((d.getTime() - ANCHOR.getTime()) / 86400000)
  const periodIdx = Math.floor(daysSince / 14)
  const start = new Date(ANCHOR)
  start.setUTCDate(start.getUTCDate() + periodIdx * 14)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 13)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

function shiftHrs(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, (eh + em / 60) - (sh + sm / 60))
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d.toISOString().split('T')[0]
}

interface ShiftInfo {
  shift_date: string
  start_time: string
  end_time: string
}

export interface HoursImpact {
  currentPeriodHours: number
  projectedPeriodHours: number
  weekOtRisk: boolean
  periodOtRisk: boolean
}

async function calcImpact(
  userId: string,
  periodStart: string,
  periodEnd: string,
  removeShift: ShiftInfo,
  addShift: ShiftInfo
): Promise<HoursImpact> {
  const scheduled = await query<{ shift_date: string; start_time: string; end_time: string }>(
    `SELECT shift_date::text, start_time::text, end_time::text
     FROM scheduled_shifts
     WHERE employee_id = $1 AND shift_date >= $2::date AND shift_date <= $3::date`,
    [userId, periodStart, periodEnd]
  )

  const weekMap = new Map<string, number>()
  let totalScheduled = 0
  for (const s of scheduled) {
    const h = shiftHrs(s.start_time, s.end_time)
    totalScheduled += h
    const wk = getWeekStart(s.shift_date)
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + h)
  }

  const removeHrs = shiftHrs(removeShift.start_time, removeShift.end_time)
  const addHrs = shiftHrs(addShift.start_time, addShift.end_time)
  const removeWk = getWeekStart(removeShift.shift_date)
  const addWk = getWeekStart(addShift.shift_date)

  const projectedTotal = totalScheduled - removeHrs + addHrs

  const projWeekMap = new Map(weekMap)
  projWeekMap.set(removeWk, (projWeekMap.get(removeWk) ?? 0) - removeHrs)
  projWeekMap.set(addWk, (projWeekMap.get(addWk) ?? 0) + addHrs)

  const weekOtRisk = [...projWeekMap.values()].some(h => h > 40)
  const periodOtRisk = projectedTotal > 80

  return {
    currentPeriodHours: Math.round(totalScheduled * 100) / 100,
    projectedPeriodHours: Math.round(projectedTotal * 100) / 100,
    weekOtRisk,
    periodOtRisk,
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { action, note } = await req.json()

  const swap = await queryOne<{
    id: string
    status: string
    requester_id: string
    target_id: string
    manager_id: string
    requester_shift_id: string
    target_shift_id: string
    org_id: string | null
    requester_note: string | null
  }>(
    `SELECT id, status, requester_id, target_id, manager_id, requester_shift_id, target_shift_id, org_id, requester_note
     FROM shift_swap_requests WHERE id = $1`,
    [id]
  )
  if (!swap) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── Target responds ──────────────────────────────────────────────────────
  if (action === 'accept' || action === 'decline') {
    if (session.id !== swap.target_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (swap.status !== 'pending_target') return NextResponse.json({ error: 'Not awaiting your response' }, { status: 400 })

    if (action === 'decline') {
      await query(
        `UPDATE shift_swap_requests SET status = 'target_declined', target_note = $1, responded_at = NOW() WHERE id = $2`,
        [note?.trim() || null, id]
      )
      sendPushToUser(swap.requester_id, 'Swap Request Declined', `${session.fullName} declined your shift swap request`, 'shift_swap').catch(() => {})
      return NextResponse.json({ ok: true })
    }

    // accept — move to pending_dm and notify manager with hours impact
    await query(
      `UPDATE shift_swap_requests SET status = 'pending_dm', target_note = $1, responded_at = NOW() WHERE id = $2`,
      [note?.trim() || null, id]
    )

    const [rShift, tShift, requesterInfo, targetInfo, managerInfo] = await Promise.all([
      queryOne<ShiftInfo>(
        `SELECT shift_date::text, start_time::text, end_time::text FROM scheduled_shifts WHERE id = $1`,
        [swap.requester_shift_id]
      ),
      queryOne<ShiftInfo>(
        `SELECT shift_date::text, start_time::text, end_time::text FROM scheduled_shifts WHERE id = $1`,
        [swap.target_shift_id]
      ),
      queryOne<{ full_name: string; email: string }>(`SELECT full_name, email FROM users WHERE id = $1`, [swap.requester_id]),
      queryOne<{ full_name: string; email: string }>(`SELECT full_name, email FROM users WHERE id = $1`, [swap.target_id]),
      queryOne<{ full_name: string; email: string }>(`SELECT full_name, email FROM users WHERE id = $1`, [swap.manager_id]),
    ])

    // Notify requester that target accepted
    sendPushToUser(swap.requester_id, 'Swap Request Accepted!', `${targetInfo?.full_name} accepted — awaiting manager approval`, 'shift_swap').catch(() => {})

    if (rShift && tShift && managerInfo) {
      const rPeriod = getBiWeeklyPeriod(rShift.shift_date)
      const tPeriod = getBiWeeklyPeriod(tShift.shift_date)

      const [requesterImpact, targetImpact] = await Promise.all([
        calcImpact(swap.requester_id, rPeriod.start, rPeriod.end, rShift, tShift),
        calcImpact(swap.target_id, tPeriod.start, tPeriod.end, tShift, rShift),
      ])

      sendPushToUser(swap.manager_id, 'Shift Swap Needs Approval',
        `${requesterInfo?.full_name} ↔ ${targetInfo?.full_name} — tap to review`, 'shift_swap').catch(() => {})

      if (managerInfo.email && await isEmailEnabled(swap.manager_id)) {
        const html = shiftSwapDmReviewHtml({
          managerName: managerInfo.full_name,
          requesterName: requesterInfo?.full_name ?? '',
          targetName: targetInfo?.full_name ?? '',
          requesterShift: rShift,
          targetShift: tShift,
          requesterImpact,
          targetImpact,
          requesterNote: swap.requester_note,
          targetNote: note?.trim() || null,
        })
        sendEmail(
          managerInfo.email,
          `Shift Swap Request: ${requesterInfo?.full_name ?? ''} ↔ ${targetInfo?.full_name ?? ''}`,
          html
        ).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true })
  }

  // ── Manager approves/denies ──────────────────────────────────────────────
  if (action === 'approve' || action === 'deny') {
    if (session.id !== swap.manager_id && session.role !== 'developer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (swap.status !== 'pending_dm') {
      return NextResponse.json({ error: 'Not awaiting manager decision' }, { status: 400 })
    }

    if (action === 'deny') {
      if (!note?.trim()) {
        return NextResponse.json({ error: 'A note is required when denying a swap request' }, { status: 400 })
      }
      await query(
        `UPDATE shift_swap_requests SET status = 'denied', dm_note = $1, decided_at = NOW() WHERE id = $2`,
        [note.trim(), id]
      )
      sendPushToUser(swap.requester_id, 'Shift Swap Denied', 'Your manager denied the swap request. Check the app for details.', 'shift_swap').catch(() => {})
      sendPushToUser(swap.target_id, 'Shift Swap Denied', 'Your manager denied the swap request. Check the app for details.', 'shift_swap').catch(() => {})
      return NextResponse.json({ ok: true })
    }

    // approve — swap the employee_id on both scheduled_shifts rows
    await query(`UPDATE scheduled_shifts SET employee_id = $1, updated_at = NOW() WHERE id = $2`, [swap.target_id, swap.requester_shift_id])
    await query(`UPDATE scheduled_shifts SET employee_id = $1, updated_at = NOW() WHERE id = $2`, [swap.requester_id, swap.target_shift_id])
    await query(
      `UPDATE shift_swap_requests SET status = 'approved', dm_note = $1, decided_at = NOW() WHERE id = $2`,
      [note?.trim() || null, id]
    )

    const [rShift, tShift, rInfo, tInfo] = await Promise.all([
      queryOne<{ shift_date: string }>(`SELECT shift_date::text FROM scheduled_shifts WHERE id = $1`, [swap.requester_shift_id]),
      queryOne<{ shift_date: string }>(`SELECT shift_date::text FROM scheduled_shifts WHERE id = $1`, [swap.target_shift_id]),
      queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [swap.requester_id]),
      queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [swap.target_id]),
    ])

    const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

    sendPushToUser(swap.requester_id, 'Shift Swap Approved!',
      `Your ${rShift ? fmtDate(rShift.shift_date) : ''} shift has been swapped with ${tInfo?.full_name}`, 'shift_swap').catch(() => {})
    sendPushToUser(swap.target_id, 'Shift Swap Approved!',
      `Your ${tShift ? fmtDate(tShift.shift_date) : ''} shift has been swapped with ${rInfo?.full_name}`, 'shift_swap').catch(() => {})

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
