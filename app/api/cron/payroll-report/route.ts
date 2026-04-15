import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { Resend } from 'resend'
import ExcelJS from 'exceljs'

const resend = new Resend(process.env.RESEND_API_KEY!)

interface ShiftRow {
  user_id: string
  full_name: string
  org_id: string | null
  org_name: string | null
  clock_in_at: string
  clock_out_at: string | null
  duration_seconds: number
  is_manual: boolean
  manual_note: string | null
  manual_by_name: string | null
}

interface PayCodeRow {
  user_id: string
  full_name: string
  org_id: string | null
  org_name: string | null
  date: string
  type: string
  hours: number | null
  note: string | null
  created_by_name: string | null
}

interface ExpenseRow {
  user_id: string
  full_name: string
  org_id: string | null
  org_name: string | null
  date: string
  category: string
  amount: string
  description: string | null
}

const CST = 'America/Chicago'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, weekday: 'short', month: 'short', day: 'numeric' })
}

async function buildPayrollWorkbook(
  shifts: ShiftRow[],
  payCodes: PayCodeRow[],
  weekLabel: string,
  expenses: ExpenseRow[] = []
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Field Manager Pro'

  const VIOLET = 'FF7C3AED'
  const AMBER = 'FFFEF3C7'
  const AMBER_TEXT = 'FF92400E'
  const GRAY_BG = 'FFF9FAFB'
  const WHITE = 'FFFFFFFF'
  const YELLOW_INPUT = 'FFFFF9C4'

  const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: WHITE }, size: 11 }
  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VIOLET } }
  const headerBorder: Partial<ExcelJS.Borders> = {
    bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  }

  // ── Sheet 1: Payroll Summary ──────────────────────────────────────────────

  const summarySheet = workbook.addWorksheet('Payroll Summary')
  summarySheet.columns = [
    { key: 'name', width: 24 },
    { key: 'org', width: 18 },
    { key: 'work_hours', width: 14 },
    { key: 'pto_hours', width: 12 },
    { key: 'sick_days', width: 12 },
    { key: 'total_paid', width: 16 },
    { key: 'rate', width: 16 },
    { key: 'pay', width: 16 },
    { key: 'corrected', width: 14 },
  ]

  // Title
  summarySheet.mergeCells('A1:I1')
  const title = summarySheet.getCell('A1')
  title.value = `Payroll Summary — ${weekLabel}`
  title.font = { bold: true, size: 13, color: { argb: VIOLET } }
  title.alignment = { horizontal: 'left' }
  summarySheet.getRow(1).height = 28

  summarySheet.mergeCells('A2:I2')
  const subtitle = summarySheet.getCell('A2')
  subtitle.value = 'Enter hourly rate in column G — column H will calculate estimated pre-tax pay automatically.'
  subtitle.font = { size: 9, color: { argb: 'FF6B7280' }, italic: true }
  summarySheet.getRow(2).height = 16

  // Header row (row 3)
  // A: Employee, B: Organization, C: Work Hours, D: PTO Hours, E: Sick Days,
  // F: Total Paid Hours, G: Hourly Rate, H: Est. Pre-Tax Pay, I: Corrections
  const sumHeaders = [
    'Employee', 'Organization', 'Work Hours', 'PTO Hours', 'Sick Days',
    'Total Paid Hours', 'Hourly Rate ($)', 'Est. Pre-Tax Pay', 'Corrections',
  ]
  const summaryHeaderRow = summarySheet.getRow(3)
  sumHeaders.forEach((h, i) => {
    const cell = summaryHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font = headerFont
    cell.fill = headerFill
    cell.border = headerBorder
    cell.alignment = { horizontal: i >= 2 ? 'center' : 'left', vertical: 'middle' }
  })
  summaryHeaderRow.height = 22

  // Aggregate by user
  const byUser = new Map<string, {
    name: string
    org: string | null
    totalSeconds: number
    ptoHours: number
    sickDays: number
    corrections: number
  }>()

  for (const s of shifts) {
    if (!byUser.has(s.user_id)) {
      byUser.set(s.user_id, { name: s.full_name, org: s.org_name, totalSeconds: 0, ptoHours: 0, sickDays: 0, corrections: 0 })
    }
    const u = byUser.get(s.user_id)!
    u.totalSeconds += Number(s.duration_seconds)
    if (s.is_manual) u.corrections++
  }

  for (const pc of payCodes) {
    if (!byUser.has(pc.user_id)) {
      byUser.set(pc.user_id, { name: pc.full_name, org: pc.org_name, totalSeconds: 0, ptoHours: 0, sickDays: 0, corrections: 0 })
    }
    const u = byUser.get(pc.user_id)!
    if (pc.type === 'pto') u.ptoHours += Number(pc.hours ?? 0)
    if (pc.type === 'sick') u.sickDays++
  }

  let dataRow = 4
  const userList = [...byUser.entries()]
  userList.sort((a, b) => a[1].name.localeCompare(b[1].name))

  for (const [, u] of userList) {
    const workHours = u.totalSeconds / 3600
    const row = summarySheet.getRow(dataRow)

    row.getCell(1).value = u.name
    row.getCell(2).value = u.org ?? 'Unassigned'

    // C: Work Hours
    row.getCell(3).value = parseFloat(workHours.toFixed(2))
    row.getCell(3).numFmt = '0.00'
    row.getCell(3).alignment = { horizontal: 'center' }

    // D: PTO Hours
    row.getCell(4).value = parseFloat(u.ptoHours.toFixed(2))
    row.getCell(4).numFmt = '0.00'
    row.getCell(4).alignment = { horizontal: 'center' }

    // E: Sick Days (count)
    row.getCell(5).value = u.sickDays
    row.getCell(5).alignment = { horizontal: 'center' }

    // F: Total Paid Hours (formula =C+D)
    const totalCell = row.getCell(6)
    totalCell.value = { formula: `=C${dataRow}+D${dataRow}` }
    totalCell.numFmt = '0.00'
    totalCell.font = { bold: true }
    totalCell.alignment = { horizontal: 'center' }

    // G: Hourly Rate — yellow input cell
    const rateCell = row.getCell(7)
    rateCell.value = null
    rateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_INPUT } }
    rateCell.font = { color: { argb: AMBER_TEXT }, bold: true }
    rateCell.numFmt = '"$"#,##0.00'
    rateCell.alignment = { horizontal: 'center' }

    // H: Est. Pre-Tax Pay (formula =F*G)
    const payCell = row.getCell(8)
    payCell.value = { formula: `=F${dataRow}*G${dataRow}` }
    payCell.numFmt = '"$"#,##0.00'
    payCell.font = { bold: true, color: { argb: 'FF1D4ED8' } }
    payCell.alignment = { horizontal: 'center' }

    // I: Corrections
    const corrCell = row.getCell(9)
    corrCell.value = u.corrections > 0 ? `⚠ ${u.corrections}` : ''
    corrCell.font = u.corrections > 0 ? { color: { argb: 'FFB45309' }, bold: true } : {}
    corrCell.alignment = { horizontal: 'center' }

    if (dataRow % 2 === 0) {
      ;[1, 2, 3, 4, 5, 6, 8, 9].forEach(col => {
        row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }
      })
    }
    row.height = 18
    dataRow++
  }

  // Totals row
  if (userList.length > 0) {
    const totRow = summarySheet.getRow(dataRow)
    totRow.getCell(1).value = 'TOTAL'
    totRow.getCell(1).font = { bold: true }
    totRow.getCell(3).value = { formula: `=SUM(C4:C${dataRow - 1})` }
    totRow.getCell(3).numFmt = '0.00'
    totRow.getCell(3).font = { bold: true }
    totRow.getCell(3).alignment = { horizontal: 'center' }
    totRow.getCell(4).value = { formula: `=SUM(D4:D${dataRow - 1})` }
    totRow.getCell(4).numFmt = '0.00'
    totRow.getCell(4).font = { bold: true }
    totRow.getCell(4).alignment = { horizontal: 'center' }
    totRow.getCell(6).value = { formula: `=SUM(F4:F${dataRow - 1})` }
    totRow.getCell(6).numFmt = '0.00'
    totRow.getCell(6).font = { bold: true }
    totRow.getCell(6).alignment = { horizontal: 'center' }
    totRow.getCell(8).value = { formula: `=SUM(H4:H${dataRow - 1})` }
    totRow.getCell(8).numFmt = '"$"#,##0.00'
    totRow.getCell(8).font = { bold: true, color: { argb: 'FF1D4ED8' } }
    totRow.getCell(8).alignment = { horizontal: 'center' }
    totRow.eachCell(cell => {
      cell.border = { top: { style: 'medium', color: { argb: VIOLET } } }
    })
    totRow.height = 20
  }

  // ── Sheet 2: Time Detail ──────────────────────────────────────────────────

  const detailSheet = workbook.addWorksheet('Time Detail')
  detailSheet.columns = [
    { key: 'name', width: 22 },
    { key: 'org', width: 16 },
    { key: 'date', width: 16 },
    { key: 'in', width: 14 },
    { key: 'out', width: 14 },
    { key: 'hours', width: 10 },
    { key: 'corrected', width: 14 },
    { key: 'note', width: 32 },
    { key: 'by', width: 18 },
  ]

  // Title
  detailSheet.mergeCells('A1:I1')
  const dTitle = detailSheet.getCell('A1')
  dTitle.value = `Time Detail — ${weekLabel}`
  dTitle.font = { bold: true, size: 13, color: { argb: VIOLET } }
  detailSheet.getRow(1).height = 28

  const detailHeaders = ['Employee', 'Organization', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Corrected?', 'Correction Note', 'Corrected By']
  const detailHeaderRow = detailSheet.getRow(2)
  detailHeaders.forEach((h, i) => {
    const cell = detailHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font = headerFont
    cell.fill = headerFill
    cell.border = headerBorder
    cell.alignment = { horizontal: i >= 3 ? 'center' : 'left', vertical: 'middle' }
  })
  detailHeaderRow.height = 22

  const sortedShifts = [...shifts].sort((a, b) => a.full_name.localeCompare(b.full_name) || a.clock_in_at.localeCompare(b.clock_in_at))

  sortedShifts.forEach((s, i) => {
    const hours = Number(s.duration_seconds) / 3600
    const row = detailSheet.getRow(i + 3)
    row.getCell(1).value = s.full_name
    row.getCell(2).value = s.org_name ?? 'Unassigned'
    row.getCell(3).value = fmtDate(s.clock_in_at)
    row.getCell(4).value = fmtTime(s.clock_in_at)
    row.getCell(5).value = s.clock_out_at ? fmtTime(s.clock_out_at) : 'Still In'
    row.getCell(6).value = parseFloat(hours.toFixed(2))
    row.getCell(6).numFmt = '0.00'
    row.getCell(7).value = s.is_manual ? '⚠ Yes' : ''
    row.getCell(8).value = s.manual_note ?? ''
    row.getCell(9).value = s.manual_by_name ?? ''

    if (s.is_manual) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } }
        if (!cell.font?.bold) cell.font = { ...cell.font, color: { argb: AMBER_TEXT } }
      })
      row.getCell(7).font = { bold: true, color: { argb: AMBER_TEXT } }
    } else if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }
      })
    }

    ;[4, 5, 6, 7].forEach(col => {
      row.getCell(col).alignment = { horizontal: 'center' }
    })
    row.height = 18
  })

  // ── Sheet 3: PTO & Sick ───────────────────────────────────────────────────

  const ptoSheet = workbook.addWorksheet('PTO & Sick')
  ptoSheet.columns = [
    { key: 'name', width: 24 },
    { key: 'org', width: 18 },
    { key: 'date', width: 14 },
    { key: 'type', width: 12 },
    { key: 'hours', width: 10 },
    { key: 'note', width: 32 },
    { key: 'entered_by', width: 20 },
  ]

  ptoSheet.mergeCells('A1:G1')
  const pTitle = ptoSheet.getCell('A1')
  pTitle.value = `PTO & Sick — ${weekLabel}`
  pTitle.font = { bold: true, size: 13, color: { argb: VIOLET } }
  ptoSheet.getRow(1).height = 28

  const ptoHeaders = ['Employee', 'Organization', 'Date', 'Type', 'Hours', 'Note', 'Entered By']
  const ptoHeaderRow = ptoSheet.getRow(2)
  ptoHeaders.forEach((h, i) => {
    const cell = ptoHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font = headerFont
    cell.fill = headerFill
    cell.border = headerBorder
    cell.alignment = { horizontal: i >= 2 ? 'center' : 'left', vertical: 'middle' }
  })
  ptoHeaderRow.height = 22

  const sortedCodes = [...payCodes].sort((a, b) => a.full_name.localeCompare(b.full_name) || a.date.localeCompare(b.date))

  sortedCodes.forEach((pc, i) => {
    const row = ptoSheet.getRow(i + 3)
    row.getCell(1).value = pc.full_name
    row.getCell(2).value = pc.org_name ?? 'Unassigned'
    row.getCell(3).value = pc.date
    row.getCell(3).alignment = { horizontal: 'center' }
    row.getCell(4).value = pc.type === 'pto' ? 'PTO' : 'Sick'
    row.getCell(4).alignment = { horizontal: 'center' }
    row.getCell(5).value = pc.hours != null ? parseFloat(Number(pc.hours).toFixed(2)) : ''
    row.getCell(5).numFmt = '0.00'
    row.getCell(5).alignment = { horizontal: 'center' }
    row.getCell(6).value = pc.note ?? ''
    row.getCell(7).value = pc.created_by_name ?? ''

    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }
      })
    }
    row.height = 18
  })

  // ── Sheet 4: Expenses Paid ────────────────────────────────────────────────

  const expSheet = workbook.addWorksheet('Expenses Paid')
  expSheet.columns = [
    { key: 'name', width: 24 },
    { key: 'org', width: 18 },
    { key: 'date', width: 14 },
    { key: 'category', width: 14 },
    { key: 'amount', width: 12 },
    { key: 'description', width: 36 },
  ]

  expSheet.mergeCells('A1:F1')
  const eTitle = expSheet.getCell('A1')
  eTitle.value = `Expenses Paid — ${weekLabel}`
  eTitle.font = { bold: true, size: 13, color: { argb: VIOLET } }
  expSheet.getRow(1).height = 28

  const expHeaders = ['Employee', 'Organization', 'Date', 'Category', 'Amount', 'Description']
  const expHeaderRow = expSheet.getRow(2)
  expHeaders.forEach((h, i) => {
    const cell = expHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font = headerFont
    cell.fill = headerFill
    cell.border = headerBorder
    cell.alignment = { horizontal: i >= 2 ? 'center' : 'left', vertical: 'middle' }
  })
  expHeaderRow.height = 22

  const sortedExpenses = [...expenses].sort((a, b) => a.full_name.localeCompare(b.full_name) || a.date.localeCompare(b.date))
  let expTotal = 0

  sortedExpenses.forEach((e, i) => {
    const amt = parseFloat(e.amount)
    expTotal += amt
    const row = expSheet.getRow(i + 3)
    row.getCell(1).value = e.full_name
    row.getCell(2).value = e.org_name ?? 'Unassigned'
    row.getCell(3).value = e.date
    row.getCell(3).alignment = { horizontal: 'center' }
    row.getCell(4).value = e.category
    row.getCell(4).alignment = { horizontal: 'center' }
    row.getCell(5).value = amt
    row.getCell(5).numFmt = '"$"#,##0.00'
    row.getCell(5).alignment = { horizontal: 'center' }
    row.getCell(6).value = e.description ?? ''

    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }
      })
    }
    row.height = 18
  })

  if (sortedExpenses.length > 0) {
    const totRow = expSheet.getRow(sortedExpenses.length + 3)
    totRow.getCell(1).value = 'TOTAL'
    totRow.getCell(1).font = { bold: true }
    totRow.getCell(5).value = expTotal
    totRow.getCell(5).numFmt = '"$"#,##0.00'
    totRow.getCell(5).font = { bold: true, color: { argb: 'FF1D4ED8' } }
    totRow.getCell(5).alignment = { horizontal: 'center' }
    totRow.eachCell(cell => {
      cell.border = { top: { style: 'medium', color: { argb: VIOLET } } }
    })
    totRow.height = 20
  } else {
    const emptyRow = expSheet.getRow(3)
    expSheet.mergeCells(`A3:F3`)
    emptyRow.getCell(1).value = 'No expenses paid this week'
    emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } }
    emptyRow.height = 20
  }

  const buf = await workbook.xlsx.writeBuffer()
  return Buffer.from(buf)
}

function getPreviousWeekRange(): { monday: Date; sunday: Date; label: string } {
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const daysToLastMonday = dayOfWeek === 0 ? 13 : dayOfWeek + 6
  const monday = new Date(now)
  monday.setUTCDate(monday.getUTCDate() - daysToLastMonday)
  monday.setUTCHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  sunday.setUTCHours(23, 59, 59, 999)
  const label = `${monday.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' })}`
  return { monday, sunday, label }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { monday, sunday, label } = getPreviousWeekRange()

  const shifts = await query<ShiftRow>(`
    SELECT
      s.user_id,
      u.org_id,
      u.full_name,
      o.name AS org_name,
      s.clock_in_at::text,
      s.clock_out_at::text,
      EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at)) AS duration_seconds,
      s.is_manual,
      s.manual_note,
      mb.full_name AS manual_by_name
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN organizations o ON o.id = u.org_id
    LEFT JOIN users mb ON mb.id = s.manual_by
    WHERE s.clock_in_at >= $1 AND s.clock_in_at <= $2
      AND u.role NOT IN ('developer')
    ORDER BY u.full_name, s.clock_in_at
  `, [monday.toISOString(), sunday.toISOString()])

  const payCodes = await query<PayCodeRow>(`
    SELECT
      pc.user_id,
      u.org_id,
      u.full_name,
      o.name AS org_name,
      pc.date::text,
      pc.type,
      pc.hours,
      pc.note,
      cb.full_name AS created_by_name
    FROM pay_codes pc
    JOIN users u ON u.id = pc.user_id
    LEFT JOIN organizations o ON o.id = u.org_id
    LEFT JOIN users cb ON cb.id = pc.created_by
    WHERE pc.date >= $1 AND pc.date <= $2
      AND u.role NOT IN ('developer')
    ORDER BY u.full_name, pc.date
  `, [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)])

  const expenses = await query<ExpenseRow>(`
    SELECT
      e.user_id,
      u.full_name,
      u.org_id,
      o.name AS org_name,
      e.date::text,
      e.category,
      e.amount::text,
      e.description
    FROM expenses e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN organizations o ON o.id = u.org_id
    WHERE e.status = 'paid'
      AND e.paid_at >= $1 AND e.paid_at <= $2
    ORDER BY u.full_name, e.date
  `, [monday.toISOString(), sunday.toISOString()])

  if (shifts.length === 0 && payCodes.length === 0 && expenses.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'No shifts, pay codes, or expenses last week' })
  }

  const buffer = await buildPayrollWorkbook(shifts, payCodes, label, expenses)
  const filename = `FMP_Payroll_${label.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`
  const subject = `FMP Weekly Payroll — ${label}`

  const htmlBody = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Weekly Payroll Report — ${label}</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        <p style="color:#555;font-size:14px;">The weekly payroll spreadsheet is attached. Please open the <strong>Payroll Summary</strong> tab and fill in the <strong>Hourly Rate</strong> column (highlighted in yellow) for each employee — the estimated pre-tax pay will calculate automatically.</p>
        <p style="color:#555;font-size:14px;margin-top:12px;">Entries highlighted in <span style="background:#fef3c7;padding:1px 4px;border-radius:3px;color:#92400e;font-weight:600;">amber</span> on the Time Detail tab were manually corrected by a manager and require your review.</p>
        <p style="color:#555;font-size:14px;margin-top:12px;">PTO and sick day entries are on the <strong>PTO &amp; Sick</strong> tab.</p>
        <p style="color:#555;font-size:14px;margin-top:12px;">Expenses that were paid out this week are on the <strong>Expenses Paid</strong> tab.</p>
        <p style="color:#8e8e93;font-size:12px;margin-top:16px;">Log in to Field Manager Pro to view full time history.</p>
      </div>
    </div>
  `

  // Send to owners (per org, just their org) + developer (all)
  const owners = await query<{ email: string; org_id: string | null }>(`
    SELECT email, org_id FROM users WHERE role = 'owner' AND is_active = TRUE
  `)
  const developers = await query<{ email: string }>(`
    SELECT email FROM users WHERE role = 'developer' AND is_active = TRUE
  `)

  const sent: string[] = []

  for (const owner of owners) {
    const orgShifts = shifts.filter(s => s.org_id === owner.org_id)
    const orgPayCodes = payCodes.filter(pc => pc.org_id === owner.org_id)
    const orgExpenses = expenses.filter(e => e.org_id === owner.org_id)
    if (orgShifts.length === 0 && orgPayCodes.length === 0 && orgExpenses.length === 0) continue
    const buf = await buildPayrollWorkbook(orgShifts, orgPayCodes, label, orgExpenses)
    await resend.emails.send({
      from: process.env.REPORT_EMAIL_FROM!,
      to: [owner.email],
      subject,
      html: htmlBody,
      attachments: [{ filename, content: buf.toString('base64') }],
    })
    sent.push(owner.email)
  }

  // Developer gets all orgs
  for (const dev of developers) {
    await resend.emails.send({
      from: process.env.REPORT_EMAIL_FROM!,
      to: [dev.email],
      subject: `[All Orgs] ${subject}`,
      html: htmlBody,
      attachments: [{ filename, content: buffer.toString('base64') }],
    })
    sent.push(dev.email)
  }

  return NextResponse.json({ ok: true, sent: sent.length, week: label, shifts: shifts.length, expenses: expenses.length })
}
