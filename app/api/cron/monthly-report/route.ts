import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { Resend } from 'resend'
import ExcelJS from 'exceljs'

const resend = new Resend(process.env.RESEND_API_KEY!)

interface ExpenseRow {
  org_name: string
  org_id: string
  full_name: string
  category: string
  date: string
  amount: string
  status: string
  description: string | null
}

interface Recipient {
  email: string
  org_id: string | null // null = developer (gets all)
}

async function buildWorkbook(expenses: ExpenseRow[], orgIds: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()

  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } },
    alignment: { horizontal: 'center' },
    border: {
      bottom: { style: 'thin', color: { argb: 'FFE5E5EA' } },
    },
  }

  for (const orgId of orgIds) {
    const orgExpenses = expenses.filter(e => e.org_id === orgId)
    if (orgExpenses.length === 0) continue
    const orgName = orgExpenses[0].org_name

    const sheet = workbook.addWorksheet(orgName.slice(0, 31))

    sheet.columns = [
      { header: 'Employee', key: 'full_name', width: 22 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Amount', key: 'amount', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Description', key: 'description', width: 35 },
    ]

    // Style header row
    sheet.getRow(1).eachCell(cell => { Object.assign(cell, headerStyle) })
    sheet.getRow(1).height = 20

    // Data rows
    let totalAmount = 0
    orgExpenses.forEach((exp, i) => {
      const amt = parseFloat(exp.amount)
      totalAmount += amt
      const row = sheet.addRow({
        full_name: exp.full_name,
        category: exp.category,
        date: exp.date,
        amount: amt,
        status: exp.status,
        description: exp.description ?? '',
      })
      row.getCell('amount').numFmt = '"$"#,##0.00'
      row.getCell('status').alignment = { horizontal: 'center' }
      if (i % 2 === 1) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9FF' } }
        })
      }
    })

    // Totals row
    const totalsRow = sheet.addRow({ full_name: 'TOTAL', amount: totalAmount })
    totalsRow.getCell('full_name').font = { bold: true }
    totalsRow.getCell('amount').font = { bold: true }
    totalsRow.getCell('amount').numFmt = '"$"#,##0.00'
    totalsRow.eachCell(cell => {
      cell.border = { top: { style: 'thin', color: { argb: 'FF7C3AED' } } }
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Previous month date range
  const now = new Date()
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const firstOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const monthLabel = firstOfLastMonth.toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    month: 'long',
    year: 'numeric',
  })

  // All expenses from last month with org info
  const expenses = await query<ExpenseRow>(`
    SELECT
      o.id AS org_id,
      o.name AS org_name,
      u.full_name,
      e.category,
      e.date::text,
      e.amount::text,
      e.status,
      e.description
    FROM expenses e
    JOIN users u ON u.id = e.submitted_by
    JOIN organizations o ON o.id = u.org_id
    WHERE e.date >= $1 AND e.date < $2
    ORDER BY o.name, e.date, u.full_name
  `, [firstOfLastMonth.toISOString().slice(0, 10), firstOfThisMonth.toISOString().slice(0, 10)])

  if (expenses.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'No expenses last month' })
  }

  const orgIds = [...new Set(expenses.map(e => e.org_id))]

  // Recipients: owners of each org + developer
  const owners = await query<{ email: string; org_id: string }>(`
    SELECT email, org_id FROM users
    WHERE role IN ('owner','sales_director') AND is_active = TRUE AND org_id IS NOT NULL
  `)

  const developers = await query<{ email: string }>(`
    SELECT email FROM users WHERE role = 'developer' AND is_active = TRUE
  `)

  const subject = `FMP Monthly Expense Report — ${monthLabel}`
  const htmlBody = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Monthly Expense Report — ${monthLabel}</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        <p style="color:#555;font-size:14px;">Please find the monthly expense report attached as an Excel file.</p>
        <p style="color:#8e8e93;font-size:12px;margin-top:16px;">Log in to Field Manager Pro to review and manage expenses.</p>
      </div>
    </div>
  `

  const sent: string[] = []

  // Send org-specific workbook to each owner
  for (const owner of owners) {
    const orgExpenses = expenses.filter(e => e.org_id === owner.org_id)
    if (orgExpenses.length === 0) continue
    const buffer = await buildWorkbook(expenses, [owner.org_id])
    await resend.emails.send({
      from: process.env.REPORT_EMAIL_FROM!,
      to: [owner.email],
      subject,
      html: htmlBody,
      attachments: [{
        filename: `FMP_Expenses_${monthLabel.replace(' ', '_')}.xlsx`,
        content: buffer.toString('base64'),
      }],
    })
    sent.push(owner.email)
  }

  // Send full workbook (all orgs as tabs) to developers
  if (developers.length > 0) {
    const buffer = await buildWorkbook(expenses, orgIds)
    for (const dev of developers) {
      await resend.emails.send({
        from: process.env.REPORT_EMAIL_FROM!,
        to: [dev.email],
        subject: `[All Orgs] ${subject}`,
        html: htmlBody,
        attachments: [{
          filename: `FMP_Expenses_All_${monthLabel.replace(' ', '_')}.xlsx`,
          content: buffer.toString('base64'),
        }],
      })
      sent.push(dev.email)
    }
  }

  return NextResponse.json({ ok: true, sent: sent.length, month: monthLabel })
}
