import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner, type Role } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import ExcelJS from 'exceljs'

const canAccess = (role: Role) => role !== 'employee'
const canViewAll = (role: Role) => role === 'ops_manager' || isOwner(role) || role === 'developer'

const CST = 'America/Chicago'
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, month: 'short', day: 'numeric', year: 'numeric' })
}
function yesNo(v: boolean | null) {
  if (v === null || v === undefined) return '—'
  return v ? 'Yes' : 'No'
}

interface VisitRow {
  id: string
  submitted_at: string
  dm_name: string
  store_address: string
  employees_working: string
  assigned_rdm: string
  reason_for_visit: string
  additional_comments: string | null
  pre_visit_1: string
  pre_visit_2: string
  pre_visit_3: string
  scorecard_grade: string
  scorecard_1: string
  scorecard_2: string
  scorecard_3: string
  live_interaction_observed: boolean
  heart_hello: boolean | null
  heart_engage: boolean | null
  heart_assess: boolean | null
  heart_recommend: boolean | null
  heart_thank: boolean | null
  sales_process_1: boolean | null
  sales_process_2: boolean | null
  sales_process_3: boolean | null
  sales_evaluation_comments: string | null
  ops_check_1: boolean
  ops_check_2: boolean
  ops_check_3: boolean
  ops_check_4: boolean
  ops_check_5: boolean
  ops_notes: string | null
  coaching_1: string
  coaching_2: string
  coaching_3: string
  impact_1: string
  impact_2: string
  impact_3: string
  impact_4: string
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const dmId = searchParams.get('dmId')
  const rdm = searchParams.get('rdm')

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []

  let where = 'WHERE 1=1'
  where += appendOrgFilter(orgFilter, params, 'v')

  if (!canViewAll(session.role)) {
    params.push(session.id)
    where += ` AND v.submitted_by_id = $${params.length}`
  } else if (dmId) {
    params.push(dmId)
    where += ` AND v.submitted_by_id = $${params.length}`
  }

  if (rdm) { params.push(rdm); where += ` AND v.assigned_rdm = $${params.length}` }
  if (from) { params.push(from); where += ` AND v.submitted_at >= $${params.length}` }
  if (to) { params.push(to + 'T23:59:59'); where += ` AND v.submitted_at <= $${params.length}` }

  const visits = await query<VisitRow>(`
    SELECT
      v.id, v.submitted_at,
      u.full_name AS dm_name,
      v.store_address, v.employees_working, v.assigned_rdm,
      v.reason_for_visit, v.additional_comments,
      v.pre_visit_1, v.pre_visit_2, v.pre_visit_3,
      v.scorecard_grade, v.scorecard_1, v.scorecard_2, v.scorecard_3,
      v.live_interaction_observed,
      v.heart_hello, v.heart_engage, v.heart_assess, v.heart_recommend, v.heart_thank,
      v.sales_process_1, v.sales_process_2, v.sales_process_3, v.sales_evaluation_comments,
      v.ops_check_1, v.ops_check_2, v.ops_check_3, v.ops_check_4, v.ops_check_5, v.ops_notes,
      v.coaching_1, v.coaching_2, v.coaching_3,
      v.impact_1, v.impact_2, v.impact_3, v.impact_4
    FROM dm_store_visits v
    JOIN users u ON u.id = v.submitted_by_id
    ${where}
    ORDER BY v.submitted_at DESC
  `, params)

  const workbook = new ExcelJS.Workbook()

  if (visits.length === 0) {
    const ws = workbook.addWorksheet('No Data')
    ws.getCell('A1').value = 'No visits found for the selected filters.'
  }

  for (const v of visits) {
    const tabName = `${fmtDate(v.submitted_at).replace(',', '')} — ${v.store_address}`.slice(0, 31)
    const ws = workbook.addWorksheet(tabName)
    ws.getColumn(1).width = 34
    ws.getColumn(2).width = 52

    const header = (title: string) => {
      const row = ws.addRow([title])
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
      row.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      row.getCell(1).alignment = { vertical: 'middle' }
      ws.mergeCells(`A${row.number}:B${row.number}`)
      row.height = 20
    }

    const dataRow = (label: string, value: string | null) => {
      const row = ws.addRow([label, value ?? '—'])
      row.getCell(1).font = { bold: true, color: { argb: 'FF374151' } }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
      row.height = 18
    }

    header('VISIT DETAILS')
    dataRow('Date', fmtDate(v.submitted_at))
    dataRow('Store Address', v.store_address)
    dataRow('Employee(s) Working', v.employees_working)
    dataRow('DM Name', v.dm_name)
    dataRow('Assigned RDM', v.assigned_rdm)
    dataRow('Reason for Visit', v.reason_for_visit)
    if (v.additional_comments) dataRow('Additional Comments', v.additional_comments)

    ws.addRow([])
    header('PRE-VISIT PLANNING')
    dataRow('Store Metrics / Highlights', v.pre_visit_1)
    dataRow('Development Areas Pre-Visit', v.pre_visit_2)
    dataRow('Primary Objective', v.pre_visit_3)

    ws.addRow([])
    header('SCORECARD REVIEW')
    dataRow('Letter Grade', v.scorecard_grade)
    dataRow('Scorecard Strengths', v.scorecard_1)
    dataRow('Areas Needing Focus', v.scorecard_2)
    dataRow('Progress Since Last Visit', v.scorecard_3)

    ws.addRow([])
    header('SALES INTERACTION')
    dataRow('Live Interaction Observed', v.live_interaction_observed ? 'Yes' : 'No')

    if (v.live_interaction_observed) {
      ws.addRow([])
      header('HEART SALES MODEL')
      dataRow('Hello — Greeted within 10 seconds', yesNo(v.heart_hello))
      dataRow('Engage — Connected authentically', yesNo(v.heart_engage))
      dataRow('Assess — Identified needs', yesNo(v.heart_assess))
      dataRow('Recommend — Made specific recommendation', yesNo(v.heart_recommend))
      dataRow('Thank — Expressed genuine appreciation', yesNo(v.heart_thank))

      ws.addRow([])
      header('SALES PROCESS EXECUTION')
      dataRow('Demonstrated value and features', yesNo(v.sales_process_1))
      dataRow('Handled objections confidently', yesNo(v.sales_process_2))
      dataRow('Attempted to close / asked for sale', yesNo(v.sales_process_3))
      if (v.sales_evaluation_comments) dataRow('Evaluation Comments', v.sales_evaluation_comments)
    }

    ws.addRow([])
    header('OPERATIONS QUICK CHECK')
    dataRow('Store clean and presentable', yesNo(v.ops_check_1))
    dataRow('Demo devices charged and functional', yesNo(v.ops_check_2))
    dataRow('Current marketing / pricing displayed', yesNo(v.ops_check_3))
    dataRow('Team in compliance with dress code', yesNo(v.ops_check_4))
    dataRow('Compliance documentation current', yesNo(v.ops_check_5))
    if (v.ops_notes) dataRow('Operational Notes', v.ops_notes)

    ws.addRow([])
    header('COACHING')
    dataRow('Behaviors / Skills Coached', v.coaching_1)
    dataRow('Action Items Agreed Upon', v.coaching_2)
    dataRow('Follow-Up Plan', v.coaching_3)

    ws.addRow([])
    header('IMPACT & COMMITMENTS')
    dataRow('Visit Impact / Key Observations', v.impact_1)
    dataRow('Employee Commitments', v.impact_2)
    dataRow('Follow-Up / Check-In Date', v.impact_3)
    dataRow('Next Scheduled Visit Date', v.impact_4)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const filename = `dm-visits-${from ?? 'all'}${to ? `-to-${to}` : ''}.xlsx`

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
