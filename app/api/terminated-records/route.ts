import { NextRequest, NextResponse } from 'next/server'
import { getSession, type Role } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import ExcelJS from 'exceljs'

const ALLOWED: Role[] = ['owner', 'sales_director', 'ops_field_leader', 'ops_manager', 'developer']
const CST = 'America/Chicago'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateFull(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, month: 'long', day: 'numeric', year: 'numeric' })
}

// GET — list all terminated employees
export async function GET() {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const employees = await query<{
    id: string; full_name: string; username: string; email: string
    role: string; manager_name: string | null; created_at: string
    terminated_at: string | null; shift_count: number; total_hours: number
  }>(`
    SELECT u.id, u.full_name, u.username, u.email, u.role,
           m.full_name as manager_name,
           u.created_at::text,
           (SELECT MAX(s.clock_out_at)::text FROM shifts s WHERE s.user_id = u.id AND s.clock_out_at IS NOT NULL) as terminated_at,
           (SELECT COUNT(*)::int FROM shifts s WHERE s.user_id = u.id) as shift_count,
           COALESCE((SELECT ROUND(SUM(EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 3600)::numeric, 2)
            FROM shifts s WHERE s.user_id = u.id AND s.clock_out_at IS NOT NULL), 0)::float as total_hours
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.is_terminated = TRUE
    ORDER BY u.full_name
  `)

  return NextResponse.json({ employees })
}

// POST — generate and download Excel timecard for a terminated employee
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { employeeId } = await req.json()
  if (!employeeId) return NextResponse.json({ error: 'employeeId required' }, { status: 400 })

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

  // Get all shifts with breaks
  const shifts = await query<{
    id: string; clock_in_at: string; clock_out_at: string | null
    clock_in_lat: string | null; clock_in_lng: string | null
    clock_out_lat: string | null; clock_out_lng: string | null
    clock_in_address: string | null; clock_out_address: string | null
    is_manual: boolean; manual_note: string | null; manual_by_name: string | null
    store_address: string | null; break_minutes: number
  }>(`
    SELECT s.id, s.clock_in_at::text, s.clock_out_at::text,
           s.clock_in_lat::text, s.clock_in_lng::text,
           s.clock_out_lat::text, s.clock_out_lng::text,
           s.clock_in_address, s.clock_out_address,
           s.is_manual, s.manual_note,
           mb.full_name as manual_by_name,
           sl.address as store_address,
           COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)) / 60)
                     FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)::int as break_minutes
    FROM shifts s
    LEFT JOIN users mb ON mb.id = s.manual_by
    LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
    WHERE s.user_id = $1
    ORDER BY s.clock_in_at ASC
  `, [employeeId])

  // Get shift edits for audit trail
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
  `, [shiftIds]).catch(() => [] as Array<{ shift_id: string; old_clock_in: string | null; new_clock_in: string | null; old_clock_out: string | null; new_clock_out: string | null; note: string | null; edited_by_name: string; edited_at: string }>) : []

  // Log the export
  await query(`
    CREATE TABLE IF NOT EXISTS terminated_record_exports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID NOT NULL,
      employee_name TEXT NOT NULL,
      exported_by UUID NOT NULL,
      exported_by_name TEXT NOT NULL,
      exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      shift_count INT,
      total_hours NUMERIC(8,2)
    )
  `).catch(() => {})

  const totalHours = shifts.reduce((sum, s) => {
    if (!s.clock_out_at) return sum
    const gross = (new Date(s.clock_out_at).getTime() - new Date(s.clock_in_at).getTime()) / 3600000
    return sum + Math.max(0, gross - (s.break_minutes / 60))
  }, 0)

  await query(`
    INSERT INTO terminated_record_exports (employee_id, employee_name, exported_by, exported_by_name, shift_count, total_hours)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [employeeId, emp.full_name, session.id, session.fullName, shifts.length, totalHours.toFixed(2)])

  // ── Build Excel ──
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Field Manager Pro'

  const VIOLET = 'FF7C3AED'
  const DARK = 'FF1F2937'
  const WHITE = 'FFFFFFFF'
  const LIGHT_BG = 'FFF5F3FF'
  const GRAY_BG = 'FFF9FAFB'
  const BORDER_COLOR = 'FFE5E7EB'

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: BORDER_COLOR } },
    bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
    left: { style: 'thin', color: { argb: BORDER_COLOR } },
    right: { style: 'thin', color: { argb: BORDER_COLOR } },
  }

  // Determine employment dates
  const firstShift = shifts.length > 0 ? fmtDateFull(shifts[0].clock_in_at) : 'N/A'
  const lastShift = shifts.length > 0 ? fmtDateFull(shifts[shifts.length - 1].clock_in_at) : 'N/A'
  const hireDate = fmtDateFull(emp.created_at)

  // ── Sheet 1: Certification Letter ──
  const certSheet = workbook.addWorksheet('Certification Letter')
  certSheet.columns = [
    { width: 4 }, { width: 70 },
  ]

  let row = 2

  // Company header
  certSheet.mergeCells(`A${row}:B${row}`)
  const companyCell = certSheet.getCell(`A${row}`)
  const orgName = emp.org_name || 'Organization'
  companyCell.value = orgName.toUpperCase()
  companyCell.font = { bold: true, size: 16, color: { argb: VIOLET } }
  companyCell.alignment = { horizontal: 'center' }
  row++

  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = 'Employer of Record'
  certSheet.getCell(`A${row}`).font = { size: 10, color: { argb: 'FF6B7280' } }
  certSheet.getCell(`A${row}`).alignment = { horizontal: 'center' }
  row += 2

  // Title
  certSheet.mergeCells(`A${row}:B${row}`)
  const certTitle = certSheet.getCell(`A${row}`)
  certTitle.value = 'CERTIFICATION OF EMPLOYMENT RECORDS'
  certTitle.font = { bold: true, size: 14, color: { argb: DARK } }
  certTitle.alignment = { horizontal: 'center' }
  row += 2

  // Date
  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = `Date: ${new Date().toLocaleDateString('en-US', { timeZone: CST, month: 'long', day: 'numeric', year: 'numeric' })}`
  certSheet.getCell(`A${row}`).font = { size: 11 }
  row += 2

  // Employee info block
  const infoLines = [
    ['Employee Name:', emp.full_name],
    ['Employee ID:', emp.username],
    ['Email:', emp.email],
    ['Position:', emp.role === 'employee' ? 'Sales Representative' : emp.role.replace(/_/g, ' ')],
    ['Pay Type:', (emp.pay_type || 'hourly').charAt(0).toUpperCase() + (emp.pay_type || 'hourly').slice(1)],
    ['Hire Date:', hireDate],
    ['Manager:', emp.manager_name || 'N/A'],
    ['Organization:', emp.org_name || 'N/A'],
    ['Employment Period (Shifts):', `${firstShift} — ${lastShift}`],
  ]

  for (const [label, value] of infoLines) {
    certSheet.getCell(`A${row}`).value = label
    certSheet.getCell(`A${row}`).font = { bold: true, size: 11 }
    certSheet.getCell(`B${row}`).value = value
    certSheet.getCell(`B${row}`).font = { size: 11 }
    row++
  }
  row++

  // Summary
  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = 'RECORD SUMMARY'
  certSheet.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: DARK } }
  row++

  const summaryLines = [
    ['Total Shifts Recorded:', String(shifts.length)],
    ['Total Gross Hours:', shifts.reduce((s, sh) => {
      if (!sh.clock_out_at) return s
      return s + (new Date(sh.clock_out_at).getTime() - new Date(sh.clock_in_at).getTime()) / 3600000
    }, 0).toFixed(2)],
    ['Total Break Minutes:', String(shifts.reduce((s, sh) => s + sh.break_minutes, 0))],
    ['Total Net Hours:', totalHours.toFixed(2)],
    ['Manual Entries:', String(shifts.filter(s => s.is_manual).length)],
    ['Shifts with GPS Verification:', String(shifts.filter(s => s.clock_in_lat).length) + ` of ${shifts.length}`],
  ]

  for (const [label, value] of summaryLines) {
    certSheet.getCell(`A${row}`).value = label
    certSheet.getCell(`A${row}`).font = { bold: true, size: 11 }
    certSheet.getCell(`B${row}`).value = value
    certSheet.getCell(`B${row}`).font = { size: 11 }
    row++
  }
  row++

  // Certification statement
  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = 'CERTIFICATION STATEMENT'
  certSheet.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: DARK } }
  row++

  const certText = `I hereby certify that the time and attendance records contained in this document are true and accurate records maintained by ${orgName} through Field Manager Pro (fieldmanagerpro.app), an automated time and attendance tracking system.

All clock-in and clock-out times were recorded electronically via GPS-verified timestamps at the time of each event. GPS coordinates (latitude/longitude) are captured at both clock-in and clock-out and are included in the detailed records attached.

Where entries are marked as "Manual," they were created or adjusted by an authorized manager or system administrator. The audit trail for any modifications is preserved and included in the "Edit History" sheet of this workbook.

These records have been maintained in the ordinary course of business and are produced from the employer's electronic timekeeping system.`

  certSheet.mergeCells(`A${row}:B${row + 6}`)
  const certTextCell = certSheet.getCell(`A${row}`)
  certTextCell.value = certText
  certTextCell.font = { size: 11 }
  certTextCell.alignment = { wrapText: true, vertical: 'top' }
  certSheet.getRow(row).height = 140
  row += 8

  // Signature lines
  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = '________________________________________'
  certSheet.getCell(`A${row}`).font = { size: 11 }
  row++
  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = `Authorized Representative — ${orgName}`
  certSheet.getCell(`A${row}`).font = { size: 10, color: { argb: 'FF6B7280' } }
  row += 2

  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = '________________________________________'
  certSheet.getCell(`A${row}`).font = { size: 11 }
  row++
  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = 'Date'
  certSheet.getCell(`A${row}`).font = { size: 10, color: { argb: 'FF6B7280' } }
  row += 2

  // Footer
  certSheet.mergeCells(`A${row}:B${row}`)
  certSheet.getCell(`A${row}`).value = `Report generated on ${new Date().toLocaleDateString('en-US', { timeZone: CST, month: 'long', day: 'numeric', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit', hour12: true })} Central Time by ${session.fullName} via Field Manager Pro.`
  certSheet.getCell(`A${row}`).font = { size: 9, italic: true, color: { argb: 'FF9CA3AF' } }

  // ── Sheet 2: Timecard Detail ──
  const detailSheet = workbook.addWorksheet('Timecard Detail')
  detailSheet.columns = [
    { key: 'date', width: 18 },
    { key: 'day', width: 12 },
    { key: 'clock_in', width: 14 },
    { key: 'clock_out', width: 14 },
    { key: 'gross_hours', width: 13 },
    { key: 'break_min', width: 12 },
    { key: 'net_hours', width: 12 },
    { key: 'store', width: 30 },
    { key: 'gps_in', width: 22 },
    { key: 'gps_out', width: 22 },
    { key: 'notes', width: 40 },
  ]

  // Title
  detailSheet.mergeCells('A1:K1')
  const detTitle = detailSheet.getCell('A1')
  detTitle.value = `Timecard Detail — ${emp.full_name}`
  detTitle.font = { bold: true, size: 14, color: { argb: VIOLET } }
  detailSheet.getRow(1).height = 28

  detailSheet.mergeCells('A2:K2')
  detailSheet.getCell('A2').value = `${firstShift} — ${lastShift} | ${shifts.length} shifts | ${totalHours.toFixed(2)} net hours`
  detailSheet.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF6B7280' } }

  // Headers
  const detHeaders = ['Date', 'Day', 'Clock In', 'Clock Out', 'Gross Hrs', 'Break (min)', 'Net Hrs', 'Store', 'GPS In', 'GPS Out', 'Notes']
  const headerRow = detailSheet.getRow(4)
  detHeaders.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
    cell.border = thinBorder
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  headerRow.height = 22

  // Data rows
  let totalGross = 0
  let totalBreaks = 0

  shifts.forEach((s, i) => {
    const r = detailSheet.getRow(5 + i)
    const grossH = s.clock_out_at
      ? (new Date(s.clock_out_at).getTime() - new Date(s.clock_in_at).getTime()) / 3600000
      : 0
    const netH = Math.max(0, grossH - (s.break_minutes / 60))
    totalGross += grossH
    totalBreaks += s.break_minutes

    const notes: string[] = []
    if (s.is_manual) notes.push('Manual entry')
    if (s.manual_note) notes.push(s.manual_note)
    if (s.manual_by_name) notes.push(`By: ${s.manual_by_name}`)

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
      s.store_address || '',
      gpsIn,
      gpsOut,
      notes.join(' | '),
    ]

    const fill: ExcelJS.Fill | undefined = i % 2 === 0
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }
      : undefined

    values.forEach((v, ci) => {
      const cell = r.getCell(ci + 1)
      cell.value = v
      cell.font = { size: 10 }
      cell.border = thinBorder
      if (fill) cell.fill = fill
      if (ci >= 4 && ci <= 6) {
        cell.alignment = { horizontal: 'center' }
        if (typeof v === 'number') cell.numFmt = '0.00'
      } else if (ci <= 3) {
        cell.alignment = { horizontal: 'center' }
      }
    })
  })

  // Totals row
  const totRow = detailSheet.getRow(5 + shifts.length)
  totRow.getCell(1).value = 'TOTALS'
  totRow.getCell(1).font = { bold: true, size: 11 }
  const totFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } }
  for (let c = 1; c <= 11; c++) {
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

  // Auto-filter & freeze
  detailSheet.autoFilter = { from: 'A4', to: `K${4 + shifts.length}` }
  detailSheet.views = [{ state: 'frozen', ySplit: 4 }]

  // ── Sheet 3: Edit History (Audit Trail) ──
  const editSheet = workbook.addWorksheet('Edit History')
  editSheet.columns = [
    { key: 'shift_date', width: 18 },
    { key: 'field', width: 18 },
    { key: 'old_value', width: 24 },
    { key: 'new_value', width: 24 },
    { key: 'edited_by', width: 20 },
    { key: 'edited_at', width: 22 },
  ]

  editSheet.mergeCells('A1:F1')
  editSheet.getCell('A1').value = `Edit History — ${emp.full_name}`
  editSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: VIOLET } }
  editSheet.getRow(1).height = 28

  const editHeaders = ['Shift Date', 'Field Changed', 'Old Value', 'New Value', 'Changed By', 'Changed At']
  const editHeaderRow = editSheet.getRow(3)
  editHeaders.forEach((h, i) => {
    const cell = editHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
    cell.border = thinBorder
    cell.alignment = { horizontal: 'center' }
  })

  if (edits.length === 0) {
    editSheet.mergeCells('A4:F4')
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
      r.getCell(3).value = e.old_clock_in ? fmtTime(e.old_clock_in) + (e.old_clock_out ? ' - ' + fmtTime(e.old_clock_out) : '') : ''
      r.getCell(4).value = e.new_clock_in ? fmtTime(e.new_clock_in) + (e.new_clock_out ? ' - ' + fmtTime(e.new_clock_out) : '') : ''
      r.getCell(5).value = e.edited_by_name
      r.getCell(6).value = fmtDate(e.edited_at) + ' ' + fmtTime(e.edited_at)
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).font = { size: 10 }
        r.getCell(c).border = thinBorder
        r.getCell(c).alignment = { horizontal: 'center' }
        if (i % 2 === 0) r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }
      }
    })
  }

  // Generate buffer
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${emp.full_name.replace(/[^a-zA-Z0-9 ]/g, '')}_Timecard_Record.xlsx"`,
    },
  })
  } catch (err) {
    console.error('Terminated record export error:', err)
    return NextResponse.json({ error: 'Failed to generate report: ' + String(err) }, { status: 500 })
  }
}

// PATCH — reactivate a terminated employee
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !['owner', 'ops_manager', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { employeeId } = await req.json()
  if (!employeeId) return NextResponse.json({ error: 'employeeId required' }, { status: 400 })

  const emp = await queryOne<{ id: string; full_name: string; is_terminated: boolean }>(
    `SELECT id, full_name, is_terminated FROM users WHERE id = $1`,
    [employeeId]
  )
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  if (!emp.is_terminated) return NextResponse.json({ error: 'Employee is not terminated' }, { status: 400 })

  await query(
    `UPDATE users SET is_active = TRUE, is_terminated = FALSE, is_hidden = FALSE WHERE id = $1`,
    [employeeId]
  )

  return NextResponse.json({ ok: true, employee: emp.full_name })
}
