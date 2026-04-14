import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import ExcelJS from 'exceljs'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

function cell(row: ExcelJS.Row, col: number): string {
  const val = row.getCell(col).value
  if (val === null || val === undefined) return ''
  if (typeof val === 'object' && 'richText' in (val as object)) {
    return (val as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('').trim()
  }
  return String(val).trim()
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const allowed = session.role === 'developer' || isOwner(session.role) || session.role === 'ops_manager'
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const orgId = formData.get('orgId') as string | null

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Determine target org
  let targetOrgId: string | null = null
  if (session.role === 'developer') {
    targetOrgId = orgId || null
  } else {
    targetOrgId = session.org_id ?? null
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]

  if (!sheet) return NextResponse.json({ error: 'Excel file has no sheets' }, { status: 400 })

  // Load managers in this org for name lookup
  const managers = await query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM users WHERE role IN ('manager','ops_manager','owner') AND org_id ${targetOrgId ? '= $1' : 'IS NULL'}`,
    targetOrgId ? [targetOrgId] : []
  )

  const results: { row: number; username: string; fullName: string; status: 'created' | 'error'; reason?: string }[] = []

  // Find first data row (skip header rows — detect by checking if row 1 looks like a header)
  let startRow = 1
  const firstRow = sheet.getRow(1)
  const firstCellVal = cell(firstRow, 1).toLowerCase()
  if (firstCellVal.includes('name') || firstCellVal.includes('full') || firstCellVal === '') {
    startRow = 2
  }

  for (let i = startRow; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i)
    const fullName = cell(row, 1)
    const username = cell(row, 2)
    const password = cell(row, 3) || 'Metro'
    const managerName = cell(row, 4)

    // Skip blank rows
    if (!fullName && !username) continue

    if (!fullName) {
      results.push({ row: i, username: username || '(blank)', fullName: '', status: 'error', reason: 'Missing full name' })
      continue
    }
    if (!username) {
      results.push({ row: i, username: '(blank)', fullName, status: 'error', reason: 'Missing username' })
      continue
    }

    const normalizedUsername = username.toLowerCase().replace(/\s+/g, '')

    // Check for duplicate username
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE username = $1`,
      [normalizedUsername]
    )
    if (existing) {
      results.push({ row: i, username: normalizedUsername, fullName, status: 'error', reason: 'Username already taken' })
      continue
    }

    // Find manager by name (fuzzy: case-insensitive contains)
    let managerId: string | null = null
    if (managerName) {
      const match = managers.find(m =>
        m.full_name.toLowerCase() === managerName.toLowerCase() ||
        m.full_name.toLowerCase().includes(managerName.toLowerCase())
      )
      if (!match) {
        results.push({ row: i, username: normalizedUsername, fullName, status: 'error', reason: `Manager "${managerName}" not found in this org` })
        continue
      }
      managerId = match.id
    }

    try {
      const hash = await bcrypt.hash(password, 12)
      await query(
        `INSERT INTO users (username, email, password_hash, role, full_name, manager_id, org_id, created_by)
         VALUES ($1, $2, $3, 'employee', $4, $5, $6, $7)`,
        [normalizedUsername, `${normalizedUsername}@placeholder.local`, hash, fullName, managerId, targetOrgId, session.id]
      )
      results.push({ row: i, username: normalizedUsername, fullName, status: 'created' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      results.push({ row: i, username: normalizedUsername, fullName, status: 'error', reason: msg })
    }
  }

  const created = results.filter(r => r.status === 'created').length
  const errors = results.filter(r => r.status === 'error').length

  return NextResponse.json({ ok: true, created, errors, results })
}
