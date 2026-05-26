import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const ANCHOR = new Date('2026-03-30T12:00:00.000Z')

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

interface ShiftInfo { shift_date: string; start_time: string; end_time: string }

async function calcImpact(userId: string, periodStart: string, periodEnd: string, removeShift: ShiftInfo, addShift: ShiftInfo) {
  const scheduled = await query<ShiftInfo>(
    `SELECT shift_date::text, start_time::text, end_time::text
     FROM scheduled_shifts
     WHERE employee_id = $1 AND shift_date >= $2::date AND shift_date <= $3::date`,
    [userId, periodStart, periodEnd]
  )

  const weekMap = new Map<string, number>()
  let total = 0
  for (const s of scheduled) {
    const h = shiftHrs(s.start_time, s.end_time)
    total += h
    const wk = getWeekStart(s.shift_date)
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + h)
  }

  const removeHrs = shiftHrs(removeShift.start_time, removeShift.end_time)
  const addHrs = shiftHrs(addShift.start_time, addShift.end_time)
  const removeWk = getWeekStart(removeShift.shift_date)
  const addWk = getWeekStart(addShift.shift_date)

  const projected = total - removeHrs + addHrs
  const projWeekMap = new Map(weekMap)
  projWeekMap.set(removeWk, (projWeekMap.get(removeWk) ?? 0) - removeHrs)
  projWeekMap.set(addWk, (projWeekMap.get(addWk) ?? 0) + addHrs)

  return {
    currentPeriodHours: Math.round(total * 100) / 100,
    projectedPeriodHours: Math.round(projected * 100) / 100,
    weekOtRisk: [...projWeekMap.values()].some(h => h > 40),
    periodOtRisk: projected > 80,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const swap = await queryOne<{
    manager_id: string
    requester_id: string
    target_id: string
    requester_shift_id: string
    target_shift_id: string
    status: string
  }>(
    `SELECT manager_id, requester_id, target_id, requester_shift_id, target_shift_id, status
     FROM shift_swap_requests WHERE id = $1`,
    [id]
  )
  if (!swap) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only the manager (or developer) can fetch impact data
  if (session.id !== swap.manager_id && session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [rShift, tShift] = await Promise.all([
    queryOne<ShiftInfo>(
      `SELECT shift_date::text, start_time::text, end_time::text FROM scheduled_shifts WHERE id = $1`,
      [swap.requester_shift_id]
    ),
    queryOne<ShiftInfo>(
      `SELECT shift_date::text, start_time::text, end_time::text FROM scheduled_shifts WHERE id = $1`,
      [swap.target_shift_id]
    ),
  ])

  if (!rShift || !tShift) return NextResponse.json({ error: 'Shift data unavailable' }, { status: 404 })

  const rPeriod = getBiWeeklyPeriod(rShift.shift_date)
  const tPeriod = getBiWeeklyPeriod(tShift.shift_date)

  const [requester, target] = await Promise.all([
    calcImpact(swap.requester_id, rPeriod.start, rPeriod.end, rShift, tShift),
    calcImpact(swap.target_id, tPeriod.start, tPeriod.end, tShift, rShift),
  ])

  return NextResponse.json({ requester, target })
}
