import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CST = 'America/Chicago'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

async function getOrgId(session: { role: string; id: string; org_id?: string | null }): Promise<string | null> {
  if (session.org_id) return session.org_id
  const row = await queryOne<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [session.id])
  return row?.org_id ?? null
}

export async function GET(req: NextRequest) {
  try {
  const session = await getSession()
  const canDownload =
    session &&
    (isOwner(session.role as never) ||
      session.role === 'ops_field_leader' ||
      session.role === 'ops_manager' ||
      session.role === 'sales_director' ||
      session.role === 'developer')

  if (!canDownload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const dmId = searchParams.get('dmId') ?? null
  const detailed = searchParams.get('detailed') === 'true'

  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const orgId = await getOrgId(session!)

  // If dmId provided and role is SD/ops_manager, record download in payroll_sr_approvals
  const canRecordDownload =
    dmId &&
    (session!.role === 'sales_director' || session!.role === 'ops_field_leader' || session!.role === 'ops_manager')

  if (canRecordDownload && orgId) {
    // Find the period that covers these dates
    const period = await queryOne<{ id: string }>(`
      SELECT id FROM payroll_periods
      WHERE org_id = $1
        AND period_start <= $2::date
        AND period_end >= $3::date
      LIMIT 1
    `, [orgId, from, to])

    if (period) {
      await queryOne(`
        INSERT INTO payroll_sr_approvals (period_id, dm_id, downloaded_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (period_id, dm_id) DO UPDATE
          SET downloaded_at = COALESCE(payroll_sr_approvals.downloaded_at, NOW())
      `, [period.id, dmId])
    }
  }

  // Build org filter SQL
  const orgFilter = orgId ? `AND u.org_id = '${orgId.replace(/'/g, "''")}'` : ''

  // Build manager filter SQL if dmId provided
  const dmFilter = dmId ? `AND u.manager_id = '${dmId.replace(/'/g, "''")}'` : ''

  const rows = await query<{
    user_id: string
    last_name: string
    first_name: string
    username: string
    org_name: string | null
    state: string | null
    regular_hours: number
    ot_hours: number
    total_hours: number
  }>(`
    WITH weekly_hours AS (
      SELECT
        s.user_id,
        COALESCE(u.legal_name, u.full_name) AS full_name,
        u.username,
        u.org_id,
        u.manager_id,
        o.name AS org_name,
        UPPER(TRIM(REGEXP_REPLACE(
          COALESCE(dsl.address, dm_dsl.address),
          '^.* ', ''
        ))) AS state,
        DATE_TRUNC('week', s.clock_in_at AT TIME ZONE $3)::date AS week_start,
        SUM(
          EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 3600.0
          - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) / 3600.0 FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
        ) AS total_hours
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN organizations o ON o.id = u.org_id
      LEFT JOIN dm_store_locations dsl ON dsl.id = s.store_location_id
      LEFT JOIN LATERAL (
        SELECT dsl2.address FROM dm_manager_stores dms2
        JOIN dm_store_locations dsl2 ON dsl2.id = dms2.store_location_id
        WHERE dms2.manager_id = CASE WHEN u.role = 'manager' THEN u.id ELSE u.manager_id END LIMIT 1
      ) dm_dsl ON s.store_location_id IS NULL
      WHERE s.clock_out_at IS NOT NULL
        AND (s.clock_in_at AT TIME ZONE $3)::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE $3)::date <= $2::date
        AND u.role IN ('employee', 'manager')
        ${orgFilter}
        ${dmFilter}
      GROUP BY s.user_id, u.legal_name, u.full_name, u.username, u.org_id, u.manager_id, o.name, COALESCE(dsl.address, dm_dsl.address), week_start
    )
    SELECT
      user_id,
      TRIM(SPLIT_PART(full_name, ' ', 2)) AS last_name,
      TRIM(SPLIT_PART(full_name, ' ', 1)) AS first_name,
      username,
      org_name,
      state,
      ROUND(SUM(LEAST(total_hours, 40))::numeric, 2)::float AS regular_hours,
      ROUND(SUM(GREATEST(total_hours - 40, 0))::numeric, 2)::float AS ot_hours,
      ROUND(SUM(total_hours)::numeric, 2)::float AS total_hours
    FROM weekly_hours
    GROUP BY user_id, full_name, username, org_name, state
    ORDER BY state, last_name, first_name
  `, [from, to, CST])

  if (rows.length === 0 && !detailed) {
    return NextResponse.json({ error: 'No data for selected period' }, { status: 404 })
  }

  // ── Detailed Excel export with per-shift breakdowns ──
  if (detailed) {
    const ExcelJS = (await import('exceljs')).default
    const shiftRows = await query<{
      user_id: string; full_name: string; username: string
      clock_in_at: string; clock_out_at: string | null
      is_manual: boolean; manual_note: string | null; manual_by_name: string | null
      store_address: string | null; break_minutes: number
      geofence_override: boolean; has_edits: boolean
    }>(`
      SELECT s.user_id,
             COALESCE(u.legal_name, u.full_name) as full_name,
             u.username,
             s.clock_in_at::text, s.clock_out_at::text,
             s.is_manual, s.manual_note,
             COALESCE(s.geofence_override, FALSE) as geofence_override,
             mb.full_name as manual_by_name,
             sl.address as store_address,
             COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)) / 60)
                       FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)::int as break_minutes,
             EXISTS(SELECT 1 FROM shift_edits se WHERE se.shift_id = s.id) as has_edits
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN users mb ON mb.id = s.manual_by
      LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
      WHERE s.clock_out_at IS NOT NULL
        AND (s.clock_in_at AT TIME ZONE $3)::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE $3)::date <= $2::date
        AND u.role IN ('employee', 'manager')
        ${orgFilter}
        ${dmFilter}
      ORDER BY u.full_name, s.clock_in_at ASC
    `, [from, to, CST])

    if (shiftRows.length === 0) {
      return NextResponse.json({ error: 'No data for selected period' }, { status: 404 })
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Field Manager Pro'

    const DARK = 'FF1F2937'
    const WHITE = 'FFFFFFFF'
    const VIOLET = 'FF7C3AED'
    const GRAY_BG = 'FFF9FAFB'
    const AMBER_BG = 'FFFFFBEB'
    const LIGHT_BG = 'FFF5F3FF'
    const BORDER_COLOR = 'FFE5E7EB'

    const thinBorder: Partial<import('exceljs').Borders> = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } },
    }

    // ── Sheet 1: Summary (same as existing CSV but in Excel) ──
    const sumSheet = workbook.addWorksheet('Summary')
    sumSheet.columns = [
      { key: 'name', width: 22 }, { key: 'username', width: 14 },
      { key: 'state', width: 8 }, { key: 'reg', width: 12 },
      { key: 'ot', width: 12 }, { key: 'total', width: 12 },
    ]

    sumSheet.mergeCells('A1:F1')
    sumSheet.getCell('A1').value = `Payroll Summary — ${from} to ${to}`
    sumSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: VIOLET } }
    sumSheet.getRow(1).height = 28

    const sumHeaders = ['Employee', 'Username', 'State', 'Reg Hours', 'OT Hours', 'Total Hours']
    const sumHRow = sumSheet.getRow(3)
    sumHeaders.forEach((h, i) => {
      const cell = sumHRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, color: { argb: WHITE }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.border = thinBorder
      cell.alignment = { horizontal: 'center' }
    })

    rows.forEach((r, i) => {
      const row = sumSheet.getRow(4 + i)
      const vals = [`${r.first_name} ${r.last_name}`, r.username, r.state ?? '', r.regular_hours, r.ot_hours, r.total_hours]
      vals.forEach((v, ci) => {
        const cell = row.getCell(ci + 1)
        cell.value = v
        cell.font = { size: 10 }
        cell.border = thinBorder
        if (typeof v === 'number') { cell.numFmt = '0.00'; cell.alignment = { horizontal: 'center' } }
        if (i % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }
      })
    })

    // Totals
    const tRow = sumSheet.getRow(4 + rows.length)
    tRow.getCell(1).value = 'TOTALS'
    tRow.getCell(1).font = { bold: true }
    for (let c = 1; c <= 6; c++) {
      tRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } }
      tRow.getCell(c).border = thinBorder
      tRow.getCell(c).font = { bold: true, size: 10 }
    }
    tRow.getCell(4).value = rows.reduce((s, r) => s + r.regular_hours, 0)
    tRow.getCell(4).numFmt = '0.00'
    tRow.getCell(4).alignment = { horizontal: 'center' }
    tRow.getCell(5).value = rows.reduce((s, r) => s + r.ot_hours, 0)
    tRow.getCell(5).numFmt = '0.00'
    tRow.getCell(5).alignment = { horizontal: 'center' }
    tRow.getCell(6).value = rows.reduce((s, r) => s + r.total_hours, 0)
    tRow.getCell(6).numFmt = '0.00'
    tRow.getCell(6).alignment = { horizontal: 'center' }

    // ── Sheet 2: Shift Detail ──
    const detSheet = workbook.addWorksheet('Shift Detail')
    detSheet.columns = [
      { key: 'name', width: 22 }, { key: 'date', width: 18 }, { key: 'day', width: 12 },
      { key: 'in', width: 13 }, { key: 'out', width: 13 },
      { key: 'gross', width: 11 }, { key: 'break', width: 10 }, { key: 'net', width: 11 },
      { key: 'method', width: 12 }, { key: 'edited', width: 10 },
      { key: 'store', width: 28 }, { key: 'notes', width: 35 },
    ]

    detSheet.mergeCells('A1:L1')
    detSheet.getCell('A1').value = `Shift Detail — ${from} to ${to}`
    detSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: VIOLET } }
    detSheet.getRow(1).height = 28

    const detHeaders = ['Employee', 'Date', 'Day', 'Clock In', 'Clock Out', 'Gross Hrs', 'Break', 'Net Hrs', 'Method', 'Edited?', 'Store', 'Notes']
    const dHRow = detSheet.getRow(3)
    detHeaders.forEach((h, i) => {
      const cell = dHRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, color: { argb: WHITE }, size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
      cell.border = thinBorder
      cell.alignment = { horizontal: 'center' }
    })

    shiftRows.forEach((s, i) => {
      const r = detSheet.getRow(4 + i)
      const grossH = s.clock_out_at ? (new Date(s.clock_out_at).getTime() - new Date(s.clock_in_at).getTime()) / 3600000 : 0
      const netH = Math.max(0, grossH - (s.break_minutes / 60))

      const notes: string[] = []
      if (s.manual_note) notes.push(s.manual_note)
      if (s.manual_by_name) notes.push(`By: ${s.manual_by_name}`)
      if (s.geofence_override) notes.push('Geofence override')

      const vals = [
        s.full_name, fmtDate(s.clock_in_at),
        new Date(s.clock_in_at).toLocaleDateString('en-US', { timeZone: CST, weekday: 'long' }),
        fmtTime(s.clock_in_at), s.clock_out_at ? fmtTime(s.clock_out_at) : 'MISSING',
        Math.round(grossH * 100) / 100, s.break_minutes,
        Math.round(netH * 100) / 100,
        s.is_manual ? 'Manual' : 'Live',
        s.has_edits ? 'YES' : '',
        s.store_address || '', notes.join(' | '),
      ]

      let fill: import('exceljs').Fill | undefined
      if (s.has_edits) fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER_BG } }
      else if (s.is_manual) fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } }
      else if (i % 2 === 0) fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } }

      vals.forEach((v, ci) => {
        const cell = r.getCell(ci + 1)
        cell.value = v
        cell.font = { size: 10 }
        cell.border = thinBorder
        if (fill) cell.fill = fill
        if (typeof v === 'number') { cell.numFmt = ci === 6 ? '0' : '0.00'; cell.alignment = { horizontal: 'center' } }
        else if (ci >= 2 && ci <= 4 || ci === 8 || ci === 9) cell.alignment = { horizontal: 'center' }
      })
    })

    detSheet.autoFilter = { from: 'A3', to: `L${3 + shiftRows.length}` }
    detSheet.views = [{ state: 'frozen', ySplit: 3 }]

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const filename = `Payroll_Detailed_${from}_to_${to}.xlsx`

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // ADP batch ID = 6-digit YYMMDD of today's processing date
  const todayAdp = new Date()
  const batchId = [
    String(todayAdp.getUTCFullYear()).slice(2),
    String(todayAdp.getUTCMonth() + 1).padStart(2, '0'),
    String(todayAdp.getUTCDate()).padStart(2, '0'),
  ].join('')

  // ADP date format: MM/DD/YYYY
  function toAdpDate(iso: string): string {
    const [y, m, d] = iso.split('-')
    return `${m}/${d}/${y}`
  }

  // ADP Workforce Now import format — headers must NOT be quoted
  const headers = [
    'Co Code', 'Batch ID', 'File #', 'First Name', 'Last Name',
    'State',
    'Pay Period Begin Date', 'Pay Period End Date',
    'Reg Hours', 'O/T Hours',
  ]

  const csvRows = [
    headers.join(','),
    ...rows.map(r => [
      '',                              // Co Code — filled by ADP admin (org-specific)
      batchId,                         // YYMMDD processing date
      `"${r.username}"`,               // File # — ADP employee ID / badge number
      `"${r.first_name}"`,
      `"${r.last_name}"`,
      `"${r.state ?? ''}"`,            // State from store location
      toAdpDate(from),                 // MM/DD/YYYY
      toAdpDate(to),                   // MM/DD/YYYY
      r.regular_hours.toFixed(2),
      r.ot_hours.toFixed(2),
    ].join(',')),
  ]

  const csv = csvRows.join('\r\n')
  const filename = `ADP_Payroll_${from}_to_${to}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
  } catch (err) {
    console.error('Payroll download error:', err)
    return NextResponse.json({ error: 'Download failed: ' + String(err) }, { status: 500 })
  }
}
