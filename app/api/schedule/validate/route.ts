import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export interface ScheduleFlag {
  type: 'no_opener' | 'no_closer' | 'gap' | 'overlap' | 'overtime'
  date: string
  detail: string
  employeeId?: string
  employeeName?: string
  storeId?: string
  storeAddress?: string
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function timeToHours(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const storeId = searchParams.get('storeId')
  const weekStart = searchParams.get('weekStart')
  if (!storeId || !weekStart) {
    return NextResponse.json({ error: 'storeId and weekStart required' }, { status: 400 })
  }

  const flags: ScheduleFlag[] = []

  // Build week date range
  const weekEnd = new Date(weekStart + 'T12:00:00')
  weekEnd.setDate(weekEnd.getDate() + 6)
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // --- STORE-LEVEL FLAGS (opener, closer, gap) ---
  const storeHoursRows = await query<{
    day_of_week: number; open_time: string; close_time: string; is_closed: boolean; address: string
  }>(
    `SELECT h.day_of_week, h.open_time::text, h.close_time::text, h.is_closed, l.address
     FROM dm_store_hours h
     JOIN dm_store_locations l ON l.id = h.store_location_id
     WHERE h.store_location_id = $1`,
    [storeId]
  )
  const hoursMap = new Map(storeHoursRows.map(h => [h.day_of_week, h]))
  const storeAddress = storeHoursRows[0]?.address ?? ''

  const storeShifts = await query<{
    shift_date: string; start_time: string; end_time: string
    employee_id: string; employee_name: string
  }>(
    `SELECT ss.shift_date::text, ss.start_time::text, ss.end_time::text,
            ss.employee_id, u.full_name AS employee_name
     FROM scheduled_shifts ss
     JOIN users u ON u.id = ss.employee_id
     WHERE ss.store_location_id = $1
       AND ss.shift_date >= $2 AND ss.shift_date <= $3
       AND COALESCE(ss.is_on_call, FALSE) = FALSE
     ORDER BY ss.shift_date, ss.start_time`,
    [storeId, weekStart, weekEndStr]
  )

  const shiftsByDate = new Map<string, typeof storeShifts>()
  for (const s of storeShifts) {
    if (!shiftsByDate.has(s.shift_date)) shiftsByDate.set(s.shift_date, [])
    shiftsByDate.get(s.shift_date)!.push(s)
  }

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    const dow = d.getDay()
    const hours = hoursMap.get(dow)
    if (!hours || hours.is_closed) continue

    const dayShifts = shiftsByDate.get(dateStr) ?? []
    const openTime = hours.open_time.slice(0, 5)
    const closeTime = hours.close_time.slice(0, 5)
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

    if (dayShifts.length === 0) {
      flags.push({ type: 'no_opener', date: dateStr, storeId, storeAddress, detail: `${dayLabel} — no opener scheduled (store opens ${fmtTime(openTime)})` })
      flags.push({ type: 'no_closer', date: dateStr, storeId, storeAddress, detail: `${dayLabel} — no closer scheduled (store closes ${fmtTime(closeTime)})` })
      continue
    }

    // Opener: first shift must start at or before open time
    if (dayShifts[0].start_time.slice(0, 5) > openTime) {
      flags.push({
        type: 'no_opener', date: dateStr, storeId, storeAddress,
        detail: `${dayLabel} — first shift starts ${fmtTime(dayShifts[0].start_time)} but store opens ${fmtTime(openTime)}`,
      })
    }

    // Closer: last shift must end at or after close time
    const last = dayShifts[dayShifts.length - 1]
    if (last.end_time.slice(0, 5) < closeTime) {
      flags.push({
        type: 'no_closer', date: dateStr, storeId, storeAddress,
        detail: `${dayLabel} — last shift ends ${fmtTime(last.end_time)} but store closes ${fmtTime(closeTime)}`,
      })
    }

    // Gaps between consecutive shifts
    for (let j = 0; j < dayShifts.length - 1; j++) {
      const curr = dayShifts[j]
      const next = dayShifts[j + 1]
      if (curr.end_time.slice(0, 5) < next.start_time.slice(0, 5)) {
        flags.push({
          type: 'gap', date: dateStr, storeId, storeAddress,
          detail: `${dayLabel} — coverage gap ${fmtTime(curr.end_time)} to ${fmtTime(next.start_time)}`,
        })
      }
    }
  }

  // --- EMPLOYEE-LEVEL FLAGS (overlap, overtime) ---
  const managerParams: unknown[] = [weekStart, weekEndStr]
  const managerClause = session.role === 'manager'
    ? ` AND u.manager_id = $${managerParams.push(session.id)}`
    : ''

  const allShifts = await query<{
    shift_date: string; start_time: string; end_time: string
    employee_id: string; employee_name: string
    store_location_id: string; store_address: string
    pay_type: string; break_minutes: number
  }>(
    `SELECT ss.shift_date::text, ss.start_time::text, ss.end_time::text,
            ss.employee_id, u.full_name AS employee_name,
            ss.store_location_id, l.address AS store_address,
            COALESCE(u.pay_type, 'hourly') AS pay_type,
            COALESCE(ss.break_minutes, 0) AS break_minutes
     FROM scheduled_shifts ss
     JOIN users u ON u.id = ss.employee_id
     JOIN dm_store_locations l ON l.id = ss.store_location_id
     WHERE ss.shift_date >= $1 AND ss.shift_date <= $2
       AND COALESCE(ss.is_on_call, FALSE) = FALSE${managerClause}
     ORDER BY ss.employee_id, ss.shift_date, ss.start_time`,
    managerParams
  )

  // Check overlaps: same employee, same date, different stores, overlapping times
  const byEmpDate = new Map<string, typeof allShifts>()
  for (const s of allShifts) {
    const key = `${s.employee_id}|${s.shift_date}`
    if (!byEmpDate.has(key)) byEmpDate.set(key, [])
    byEmpDate.get(key)!.push(s)
  }
  const overlapSeen = new Set<string>()
  for (const [, empShifts] of byEmpDate) {
    if (empShifts.length < 2) continue
    for (let i = 0; i < empShifts.length - 1; i++) {
      for (let j = i + 1; j < empShifts.length; j++) {
        const a = empShifts[i], b = empShifts[j]
        if (a.store_location_id === b.store_location_id) continue
        if (a.start_time < b.end_time && a.end_time > b.start_time) {
          const key = `${a.employee_id}|${a.shift_date}`
          if (overlapSeen.has(key)) continue
          overlapSeen.add(key)
          const d = new Date(a.shift_date + 'T12:00:00')
          const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          flags.push({
            type: 'overlap', date: a.shift_date,
            employeeId: a.employee_id, employeeName: a.employee_name,
            detail: `${a.employee_name} — ${dayLabel} double-booked at ${a.store_address.split(',')[0]} (${fmtTime(a.start_time)}–${fmtTime(a.end_time)}) and ${b.store_address.split(',')[0]} (${fmtTime(b.start_time)}–${fmtTime(b.end_time)})`,
          })
        }
      }
    }
  }

  // Check overtime: >40h scheduled in the week per employee (skip salary)
  const hoursPerEmp = new Map<string, { name: string; hours: number; pay_type: string }>()
  for (const s of allShifts) {
    const raw = timeToHours(s.end_time) - timeToHours(s.start_time)
    const h = Math.max(0, raw - (s.break_minutes ?? 0) / 60)
    const cur = hoursPerEmp.get(s.employee_id) ?? { name: s.employee_name, hours: 0, pay_type: s.pay_type }
    cur.hours += h
    hoursPerEmp.set(s.employee_id, cur)
  }
  for (const [empId, { name, hours, pay_type }] of hoursPerEmp) {
    if (pay_type === 'salary') continue
    if (hours > 40) {
      flags.push({
        type: 'overtime', date: weekStart,
        employeeId: empId, employeeName: name,
        detail: `${name} — ${hours.toFixed(1)}h scheduled this week (exceeds 40h)`,
      })
    }
  }

  return NextResponse.json({ flags })
}
