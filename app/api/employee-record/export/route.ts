import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import ExcelJS from 'exceljs'

const CST = 'America/Chicago'
const ALLOWED_ROLES = ['ops_manager', 'owner', 'sales_director', 'developer']

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, month: 'short', day: 'numeric', year: 'numeric' })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { employeeId, from, to } = await req.json()
  if (!employeeId || !from || !to) {
    return NextResponse.json({ error: 'employeeId, from, and to required' }, { status: 400 })
  }

  try {
    // Get employee info
    const emp = await queryOne<{
      id: string; full_name: string; username: string; email: string
      role: string; pay_type: string; created_at: string; manager_name: string | null
      org_name: string | null
    }>(`
      SELECT u.id, u.full_name, u.username, u.email, u.role, u.pay_type,
             u.created_at::text, m.full_name as manager_name, o.name as org_name
      FROM users u
      LEFT JOIN users m ON m.id = u.manager_id
      LEFT JOIN organizations o ON o.id = u.org_id
      WHERE u.id = $1
    `, [employeeId])

    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    // Get shifts
    const shifts = await query<{
      id: string; clock_in_at: string; clock_out_at: string | null
      clock_in_lat: string | null; clock_in_lng: string | null
      clock_out_lat: string | null; clock_out_lng: string | null
      clock_in_address: string | null; clock_out_address: string | null
      is_manual: boolean; manual_note: string | null; manual_by_name: string | null
      store_address: string | null; break_minutes: number
      geofence_override: boolean
    }>(`
      SELECT s.id, s.clock_in_at::text, s.clock_out_at::text,
             s.clock_in_lat::text, s.clock_in_lng::text,
             s.clock_out_lat::text, s.clock_out_lng::text,
             s.clock_in_address, s.clock_out_address,
             s.is_manual, s.manual_note,
             COALESCE(s.geofence_override, FALSE) as geofence_override,
             mb.full_name as manual_by_name,
             sl.address as store_address,
             COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)) / 60)
                       FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)::int as break_minutes
      FROM shifts s
      LEFT JOIN users mb ON mb.id = s.manual_by
      LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
      WHERE s.user_id = $1
        AND (s.clock_in_at AT TIME ZONE $2)::date >= $3::date
        AND (s.clock_in_at AT TIME ZONE $2)::date <= $4::date
      ORDER BY s.clock_in_at ASC
    `, [employeeId, CST, from, to])

    // Get edits
    const shiftIds = shifts.map(s => s.id)
    const edits = shiftIds.length > 0 ? await query<{
      shift_id: string; old_clock_in: string | null; new_clock_in: string | null
      old_clock_out: string | null; new_clock_out: string | null
      note: string | null; edited_by_name: string; edited_at: string
    }>(`
      SELECT se.shift_id, se.old_clock_in::text, se.new_clock_in::text,
             se.old_clock_out::text, se.new_clock_out::text,
             se.note, u.full_name as edited_by_name, se.edited_at::text
      FROM shift_edits se
      JOIN users u ON u.id = se.edited_by
      WHERE se.shift_id = ANY($1::uuid[])
      ORDER BY se.edited_at ASC
    `, [shiftIds]) : []

    // Get accountability docs
    const accountability = await query<{
      level: string; title: string; incident_date: string
      notes: string; expectations: string; status: string; ack_status: string
      author_name: string; created_at: string
    }>(`
      SELECT level, title, incident_date::text, notes, expectations,
             status, ack_status, author_name, created_at::text
      FROM accountability_docs
      WHERE subject_id = $1
        AND created_at::date >= $2::date AND created_at::date <= $3::date
      ORDER BY created_at ASC
    `, [employeeId, from, to])

    // Get flags
    const flags = await query<{
      type: string; detail: string | null; date: string
      resolved: boolean; resolved_by_name: string | null; resolution_note: string | null
      created_at: string
    }>(`
      SELECT type, detail, date::text, resolved,
             resolved_by_name, resolution_note, created_at::text
      FROM flags
      WHERE user_id = $1
        AND created_at::date >= $2::date AND created_at::date <= $3::date
      ORDER BY created_at ASC
    `, [employeeId, from, to])

    // Get geofence overrides
    const overrides = await query<{
      approved_by_name: string; store_address: string | null
      reason: string; reported_distance_ft: number | null; created_at: string
    }>(`
      SELECT approved_by_name, store_address, reason,
             reported_distance_ft, created_at::text
      FROM geofence_overrides
      WHERE employee_id = $1
        AND created_at::date >= $2::date AND created_at::date <= $3::date
      ORDER BY created_at ASC
    `, [employeeId, from, to])

    // Get time-off
    const timeOff = await query<{
      start_date: string; end_date: string; reason: string | null
      status: string; approver_name: string | null; created_at: string
    }>(`
      SELECT tor.start_date::text, tor.end_date::text, tor.reason,
             tor.status, a.full_name as approver_name, tor.created_at::text
      FROM time_off_requests tor
      LEFT JOIN users a ON a.id = tor.approver_id
      WHERE tor.user_id = $1
        AND tor.start_date <= $2::date AND tor.end_date >= $3::date
      ORDER BY tor.start_date ASC
    `, [employeeId, to, from])

    // ── Build Excel ──
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Field Manager Pro'

    const VIOLET = 'FF7C3AED'
    const DARK = 'FF1F2937'
    const WHITE = 'FFFFFFFF'
    const GRAY_BG = 'FFF9FAFB'
    const LIGHT_BG = 'FFF5F3FF'
    const BORDER_COLOR = 'FFE5E7EB'
    const RED_BG = 'FFFEF2F2'
    const AMBER_BG = 'FFFFFBEB'
    const GREEN_BG = 'FFF0FDF4'

    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } },
    }

    const totalHours = shifts.reduce((sum, s) => {
      if (!s.clock_out_at) return sum
      const gross = (new Date(s.clock_out_at).getTime() - new Date(s.clock_in_at).getTime()) / 3600000
      return sum + Math.max(0, gross - (s.break_minutes / 60))
    }, 0)

    // ── Sheet 1: Summary ──
    const summarySheet = workbook.addWorksheet('Summary')
    summarySheet.columns = [{ width: 28 }, { width: 50 }]

    let row = 2
    summarySheet.mergeCells(`A${row}:B${row}`)
    const titleCell = summarySheet.getCell(`A${row}`)
    titleCell.value = `EMPLOYEE RECORD — ${emp.full_name.toUpperCase()}`
    titleCell.font = { bold: true, size: 16, color: { argb: VIOLET } }
    titleCell.alignment = { horizontal: 'center' }
    row++

    summarySheet.mergeCells(`A${row}:B${row}`)
    summarySheet.getCell(`A${row}`).value = `${fmtDateShort(from)} — ${fmtDateShort(to)}`
    summarySheet.getCell(`A${row}`).font = { size: 11, italic: true, color: { argb: 'FF6B7280' } }
    summarySheet.getCell(`A${row}`).alignment = { horizontal: 'center' }
    row += 2

    const infoLines: [string, string][] = [
      ['Employee:', emp.full_name],
      ['Username:', emp.username],
      ['Email:', emp.email],
      ['Role:', emp.role === 'employee' ? 'Sales Representative' : emp.role.replace(/_/g, ' ')],
      ['Manager:', emp.manager_name || 'N/A'],
      ['Pay Type:', (emp.pay_type || 'hourly').charAt(0).toUpperCase() + (emp.pay_type || 'hourly').slice(1)],
      ['Hire Date:', fmtDate(emp.created_at)],
    ]

    for (const [label, value] of infoLines) {
      summarySheet.getCell(`A${row}`).value = label
      summarySheet.getCell(`A${row}`).font = { bold: true, size: 11 }
      summarySheet.getCell(`B${row}`).value = value
      summarySheet.getCell(`B${row}`).font = { size: 11 }
      row++
    }
    row++

    summarySheet.mergeCells(`A${row}:B${row}`)
    summarySheet.getCell(`A${row}`).value = 'PERIOD SUMMARY'
    summarySheet.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: DARK } }
    row++

    const statsLines: [string, string][] = [
      ['Total Shifts:', String(shifts.length)],
      ['Total Net Hours:', totalHours.toFixed(2)],
      ['Total Break Minutes:', String(shifts.reduce((s, sh) => s + sh.break_minutes, 0))],
      ['Manual Entries:', String(shifts.filter(s => s.is_manual).length)],
      ['Edited Shifts:', String(new Set(edits.map(e => e.shift_id)).size)],
      ['GPS Verified:', `${shifts.filter(s => s.clock_in_lat).length} of ${shifts.length}`],
      ['Geofence Overrides:', String(overrides.length)],
      ['Flags:', String(flags.length)],
      ['Accountability Docs:', String(accountability.length)],
      ['Time-Off Requests:', String(timeOff.length)],
    ]

    for (const [label, value] of statsLines) {
      summarySheet.getCell(`A${row}`).value = label
      summarySheet.getCell(`A${row}`).font = { bold: true, size: 11 }
      summarySheet.getCell(`B${row}`).value = value
      summarySheet.getCell(`B${row}`).font = { size: 11 }
      row++
    }
    row += 2

    summarySheet.mergeCells(`A${row}:B${row}`)
    summarySheet.getCell(`A${row}`).value = `Generated by ${session.fullName} on ${new Date().toLocaleDateString('en-US', { timeZone: CST, month: 'long', day: 'numeric', year: 'numeric' })} at ${fmtTime(new Date().toISOString())} via Field Manager Pro`
    summarySheet.getCell(`A${row}`).font = { size: 9, italic: true, color: { argb: 'FF9CA3AF' } }

    // ── Sheet 2: Shift Detail ──
    const shiftSheet = workbook.addWorksheet('Shift Detail')
    shiftSheet.columns = [
      { key: 'date', width: 18 },
      { key: 'day', width: 12 },
      { key: 'clock_in', width: 14 },
      { key: 'clock_out', width: 14 },
      { key: 'gross_hours', width: 13 },
      { key: 'break_min', width: 12 },
      { key: 'net_hours', width: 12 },
      { key: 'method', width: 14 },
      { key: 'edited', width: 10 },
      { key: 'store', width: 30 },
      { key: 'gps_in', width: 22 },
      { key: 'gps_out', width: 22 },
      { key: 'notes', width: 40 },
    ]

    shiftSheet.mergeCells('A1:M1')
    shiftSheet.getCell('A1').value = `Shift Detail — ${emp.full_name}`
    shiftSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: VIOLET } }
    shiftSheet.getRow(1).height = 28

    shiftSheet.mergeCells('A2:M2')
    shiftSheet.getCell('A2').value = `${fmtDateShort(from)} — ${fmtDateShort(to)} | ${shifts.length} shifts | ${totalHours.toFixed(2)} net hours`
    shiftSheet.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF6B7280' } }

    const shiftHeaders = ['Date', 'Day', 'Clock In', 'Clock Out', 'Gross Hrs', 'Break (min)', 'Net Hrs', 'Method', 'Edited?', 'Store', 'GPS In', 'GPS Out', 'Notes']
    const shRow = shiftSheet.getRow(4)
    shiftHeaders.forEach((h, i) => {
      const cell = shRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, color: { argb: WHITE }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.border = thinBorder
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    shRow.height = 22

    let totalGross = 0
    let totalBreaks = 0

    shifts.forEach((s, i) => {
      const r = shiftSheet.getRow(5 + i)
      const grossH = s.clock_out_at ? (new Date(s.clock_out_at).getTime() - new Date(s.clock_in_at).getTime()) / 3600000 : 0
      const netH = Math.max(0, grossH - (s.break_minutes / 60))
      totalGross += grossH
      totalBreaks += s.break_minutes

      const shiftEdits = edits.filter(e => e.shift_id === s.id)
      const wasEdited = shiftEdits.length > 0

      const notes: string[] = []
      if (s.manual_note) notes.push(s.manual_note)
      if (s.manual_by_name) notes.push(`By: ${s.manual_by_name}`)
      if (s.geofence_override) notes.push('Geofence override')

      const gpsIn = s.clock_in_lat && s.clock_in_lng ? `${s.clock_in_lat}, ${s.clock_in_lng}` : ''
      const gpsOut = s.clock_out_lat && s.clock_out_lng ? `${s.clock_out_lat}, ${s.clock_out_lng}` : ''

      const values = [
        fmtDate(s.clock_in_at),
        new Date(s.clock_in_at).toLocaleDateString('en-US', { timeZone: CST, weekday: 'long' }),
        fmtTime(s.clock_in_at),
        s.clock_out_at ? fmtTime(s.clock_out_at) : 'MISSING',
        Math.round(grossH * 100) / 100,
        s.break_minutes,
        Math.round(netH * 100) / 100,
        s.is_manual ? 'Manual' : 'Live',
        wasEdited ? 'YES' : '',
        s.store_address || '',
        gpsIn,
        gpsOut,
        notes.join(' | '),
      ]

      let fill: ExcelJS.Fill | undefined
      if (wasEdited) fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER_BG } }
      else if (s.is_manual) fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } }
      else if (i % 2 === 0) fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }

      values.forEach((v, ci) => {
        const cell = r.getCell(ci + 1)
        cell.value = v
        cell.font = { size: 10 }
        cell.border = thinBorder
        if (fill) cell.fill = fill
        if (ci >= 4 && ci <= 6) {
          cell.alignment = { horizontal: 'center' }
          if (typeof v === 'number') cell.numFmt = '0.00'
        } else if (ci <= 3 || ci === 7 || ci === 8) {
          cell.alignment = { horizontal: 'center' }
        }
      })
    })

    // Totals row
    const totRow = shiftSheet.getRow(5 + shifts.length)
    totRow.getCell(1).value = 'TOTALS'
    totRow.getCell(1).font = { bold: true, size: 11 }
    const totFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } }
    for (let c = 1; c <= 13; c++) {
      totRow.getCell(c).fill = totFill
      totRow.getCell(c).border = thinBorder
      totRow.getCell(c).font = { bold: true, size: 10 }
    }
    totRow.getCell(5).value = Math.round(totalGross * 100) / 100
    totRow.getCell(5).numFmt = '0.00'
    totRow.getCell(5).alignment = { horizontal: 'center' }
    totRow.getCell(6).value = totalBreaks
    totRow.getCell(6).alignment = { horizontal: 'center' }
    totRow.getCell(7).value = Math.round(totalHours * 100) / 100
    totRow.getCell(7).numFmt = '0.00'
    totRow.getCell(7).alignment = { horizontal: 'center' }
    totRow.getCell(8).value = `${shifts.filter(s => s.is_manual).length} manual`
    totRow.getCell(8).alignment = { horizontal: 'center' }

    shiftSheet.autoFilter = { from: 'A4', to: `M${4 + shifts.length}` }
    shiftSheet.views = [{ state: 'frozen', ySplit: 4 }]

    // ── Sheet 3: Edit History ──
    const editSheet = workbook.addWorksheet('Edit History')
    editSheet.columns = [
      { key: 'shift_date', width: 18 },
      { key: 'change', width: 40 },
      { key: 'note', width: 30 },
      { key: 'edited_by', width: 20 },
      { key: 'edited_at', width: 22 },
    ]

    editSheet.mergeCells('A1:E1')
    editSheet.getCell('A1').value = `Edit History — ${emp.full_name}`
    editSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: VIOLET } }
    editSheet.getRow(1).height = 28

    const editHeaders = ['Shift Date', 'Change', 'Note', 'Changed By', 'Changed At']
    const eRow = editSheet.getRow(3)
    editHeaders.forEach((h, i) => {
      const cell = eRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, color: { argb: WHITE }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.border = thinBorder
      cell.alignment = { horizontal: 'center' }
    })

    if (edits.length === 0) {
      editSheet.mergeCells('A4:E4')
      editSheet.getCell('A4').value = 'No edits recorded — all time entries are original.'
      editSheet.getCell('A4').font = { size: 11, italic: true, color: { argb: 'FF6B7280' } }
    } else {
      edits.forEach((e, i) => {
        const shift = shifts.find(s => s.id === e.shift_id)
        const r = editSheet.getRow(4 + i)

        const changes: string[] = []
        if (e.old_clock_in && e.new_clock_in) changes.push(`Clock In: ${fmtTime(e.old_clock_in)} → ${fmtTime(e.new_clock_in)}`)
        if (e.old_clock_out && e.new_clock_out) changes.push(`Clock Out: ${fmtTime(e.old_clock_out)} → ${fmtTime(e.new_clock_out)}`)

        r.getCell(1).value = shift ? fmtDate(shift.clock_in_at) : ''
        r.getCell(2).value = changes.join('; ') || 'Time adjusted'
        r.getCell(3).value = e.note || ''
        r.getCell(4).value = e.edited_by_name
        r.getCell(5).value = fmtDate(e.edited_at) + ' ' + fmtTime(e.edited_at)

        for (let c = 1; c <= 5; c++) {
          r.getCell(c).font = { size: 10 }
          r.getCell(c).border = thinBorder
          r.getCell(c).alignment = { horizontal: c === 2 || c === 3 ? 'left' : 'center' }
          if (i % 2 === 0) r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }
        }
      })
    }

    // ── Sheet 4: Documentation & Flags ──
    const docsSheet = workbook.addWorksheet('Documentation & Flags')
    docsSheet.columns = [
      { key: 'date', width: 18 },
      { key: 'type', width: 22 },
      { key: 'detail', width: 50 },
      { key: 'status', width: 16 },
      { key: 'by', width: 20 },
    ]

    docsSheet.mergeCells('A1:E1')
    docsSheet.getCell('A1').value = `Documentation & Flags — ${emp.full_name}`
    docsSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: VIOLET } }
    docsSheet.getRow(1).height = 28

    const docHeaders = ['Date', 'Type', 'Detail', 'Status', 'By / Resolved By']
    const dRow = docsSheet.getRow(3)
    docHeaders.forEach((h, i) => {
      const cell = dRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, color: { argb: WHITE }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.border = thinBorder
      cell.alignment = { horizontal: 'center' }
    })

    // Combine and sort all docs chronologically
    interface TimelineEntry { date: string; type: string; detail: string; status: string; by: string; color: string }
    const timeline: TimelineEntry[] = []

    for (const a of accountability) {
      const levelLabel = a.level === 'documented_conversation' ? 'Documented Conversation'
        : a.level.charAt(0).toUpperCase() + a.level.slice(1) + ' Notice'
      timeline.push({
        date: a.created_at, type: levelLabel, detail: `${a.title}\n${a.notes}`,
        status: a.status === 'approved' ? 'Approved' : a.status === 'pending_approval' ? 'Pending' : a.status,
        by: a.author_name, color: a.level === 'final' ? RED_BG : AMBER_BG,
      })
    }

    for (const f of flags) {
      timeline.push({
        date: f.created_at, type: `Flag: ${f.type.replace(/_/g, ' ')}`,
        detail: f.detail || '', status: f.resolved ? 'Resolved' : 'Open',
        by: f.resolved_by_name || '', color: f.resolved ? GREEN_BG : RED_BG,
      })
    }

    for (const o of overrides) {
      timeline.push({
        date: o.created_at, type: 'Geofence Override',
        detail: `${o.store_address || ''} — ${o.reason}${o.reported_distance_ft ? ` (${o.reported_distance_ft}ft)` : ''}`,
        status: 'Applied', by: o.approved_by_name, color: AMBER_BG,
      })
    }

    for (const t of timeOff) {
      timeline.push({
        date: t.created_at, type: 'Time Off Request',
        detail: `${fmtDateShort(t.start_date)} — ${fmtDateShort(t.end_date)}${t.reason ? ': ' + t.reason : ''}`,
        status: t.status.charAt(0).toUpperCase() + t.status.slice(1),
        by: t.approver_name || '', color: t.status === 'approved' ? GREEN_BG : t.status === 'denied' ? RED_BG : GRAY_BG,
      })
    }

    timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    if (timeline.length === 0) {
      docsSheet.mergeCells('A4:E4')
      docsSheet.getCell('A4').value = 'No documentation or flags in this period.'
      docsSheet.getCell('A4').font = { size: 11, italic: true, color: { argb: 'FF6B7280' } }
    } else {
      timeline.forEach((t, i) => {
        const r = docsSheet.getRow(4 + i)
        r.getCell(1).value = fmtDate(t.date) + ' ' + fmtTime(t.date)
        r.getCell(2).value = t.type
        r.getCell(3).value = t.detail
        r.getCell(3).alignment = { wrapText: true }
        r.getCell(4).value = t.status
        r.getCell(5).value = t.by

        for (let c = 1; c <= 5; c++) {
          r.getCell(c).font = { size: 10 }
          r.getCell(c).border = thinBorder
          r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: t.color } }
          if (c !== 3) r.getCell(c).alignment = { horizontal: 'center' }
        }
      })
    }

    docsSheet.autoFilter = { from: 'A3', to: `E${3 + timeline.length}` }

    // Generate buffer
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const filename = `${emp.full_name.replace(/[^a-zA-Z0-9 ]/g, '')}_Employee_Record_${from}_to_${to}.xlsx`

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('Employee record export error:', err)
    return NextResponse.json({ error: 'Failed to generate report: ' + String(err) }, { status: 500 })
  }
}
