import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

interface EmployeeSummary {
  full_name: string
  total_hours: number
  shift_count: number
  days_scheduled: number[]
}

interface ExpenseSummary {
  full_name: string
  category: string
  amount: string
  status: string
  date: string
}

function weeklyReportHtml(
  dateLabel: string,
  employees: EmployeeSummary[],
  expenses: ExpenseSummary[],
  outstanding: ExpenseSummary[]
): string {
  const hoursRows = employees.map(e => {
    const hours = (e.total_hours / 3600).toFixed(1)
    const overtime = e.total_hours / 3600 > 8
    return `
      <tr style="border-bottom:1px solid #e5e5ea;">
        <td style="padding:10px 14px;font-size:14px;color:#1c1c1e;">${e.full_name}</td>
        <td style="padding:10px 14px;font-size:14px;text-align:center;">${e.shift_count}</td>
        <td style="padding:10px 14px;font-size:14px;text-align:center;color:${overtime ? '#e65100' : '#1c1c1e'};font-weight:${overtime ? '700' : '400'};">${hours}h${overtime ? ' ⚠' : ''}</td>
      </tr>
    `
  }).join('')

  const totalExpenses = expenses.reduce((s, e) => s + parseFloat(e.amount), 0)
  const pendingExpenses = expenses.filter(e => e.status === 'pending')
  const pendingTotal = pendingExpenses.reduce((s, e) => s + parseFloat(e.amount), 0)

  const statusColor: Record<string, string> = {
    pending: '#b45309',
    approved: '#166534',
    paid: '#1d4ed8',
    rejected: '#991b1b',
  }
  const statusBg: Record<string, string> = {
    pending: '#fef3c7',
    approved: '#dcfce7',
    paid: '#dbeafe',
    rejected: '#fee2e2',
  }

  const expenseRows = expenses.map(e => `
    <tr style="border-bottom:1px solid #e5e5ea;">
      <td style="padding:8px 14px;font-size:13px;color:#1c1c1e;">${e.full_name}</td>
      <td style="padding:8px 14px;font-size:13px;color:#555;">${e.category}</td>
      <td style="padding:8px 14px;font-size:13px;color:#555;">${e.date}</td>
      <td style="padding:8px 14px;font-size:13px;font-weight:600;text-align:right;">$${parseFloat(e.amount).toFixed(2)}</td>
      <td style="padding:8px 14px;text-align:center;">
        <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:${statusBg[e.status] ?? '#f2f2f7'};color:${statusColor[e.status] ?? '#555'};text-transform:capitalize;">${e.status}</span>
      </td>
    </tr>
  `).join('')

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:650px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Daily Summary — ${dateLabel}</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">

        <h2 style="font-size:15px;font-weight:700;color:#1c1c1e;margin:0 0 12px;">Yesterday's Shifts</h2>
        ${employees.length === 0
          ? '<p style="color:#8e8e93;font-size:14px;margin:0 0 20px;">No shifts recorded yesterday.</p>'
          : `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
              <thead>
                <tr style="background:#f2f2f7;">
                  <th style="padding:10px 14px;text-align:left;font-size:13px;color:#8e8e93;font-weight:600;">Employee</th>
                  <th style="padding:10px 14px;text-align:center;font-size:13px;color:#8e8e93;font-weight:600;">Shifts</th>
                  <th style="padding:10px 14px;text-align:center;font-size:13px;color:#8e8e93;font-weight:600;">Hours</th>
                </tr>
              </thead>
              <tbody>${hoursRows}</tbody>
            </table>
            <p style="font-size:12px;color:#8e8e93;margin:0 0 24px;">⚠ = Over 8 hours.</p>`
        }

        <h2 style="font-size:15px;font-weight:700;color:#1c1c1e;margin:0 0 12px;">Expenses Submitted Yesterday</h2>
        ${expenses.length === 0
          ? '<p style="color:#8e8e93;font-size:14px;margin:0;">No expenses submitted yesterday.</p>'
          : `<div style="display:flex;gap:16px;margin-bottom:16px;">
              <div style="flex:1;background:#f2f2f7;border-radius:10px;padding:12px 16px;">
                <p style="font-size:12px;color:#8e8e93;margin:0 0 2px;">Total Submitted</p>
                <p style="font-size:18px;font-weight:700;color:#1c1c1e;margin:0;">$${totalExpenses.toFixed(2)}</p>
              </div>
              <div style="flex:1;background:#fef3c7;border-radius:10px;padding:12px 16px;">
                <p style="font-size:12px;color:#92400e;margin:0 0 2px;">Pending Approval</p>
                <p style="font-size:18px;font-weight:700;color:#b45309;margin:0;">$${pendingTotal.toFixed(2)} <span style="font-size:13px;font-weight:400;">(${pendingExpenses.length})</span></p>
              </div>
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#f2f2f7;">
                  <th style="padding:8px 14px;text-align:left;font-size:13px;color:#8e8e93;font-weight:600;">Submitted By</th>
                  <th style="padding:8px 14px;text-align:left;font-size:13px;color:#8e8e93;font-weight:600;">Category</th>
                  <th style="padding:8px 14px;text-align:left;font-size:13px;color:#8e8e93;font-weight:600;">Date</th>
                  <th style="padding:8px 14px;text-align:right;font-size:13px;color:#8e8e93;font-weight:600;">Amount</th>
                  <th style="padding:8px 14px;text-align:center;font-size:13px;color:#8e8e93;font-weight:600;">Status</th>
                </tr>
              </thead>
              <tbody>${expenseRows}</tbody>
            </table>`
        }

        <h2 style="font-size:15px;font-weight:700;color:#1c1c1e;margin:24px 0 12px;">All Outstanding Expenses</h2>
        ${outstanding.length === 0
          ? '<p style="color:#8e8e93;font-size:14px;margin:0 0 20px;">No outstanding expenses.</p>'
          : (() => {
              const outTotal = outstanding.reduce((s, e) => s + parseFloat(e.amount), 0)
              const pendingOut = outstanding.filter(e => e.status === 'pending')
              const approvedOut = outstanding.filter(e => e.status === 'approved')
              const outRows = outstanding.map(e => `
                <tr style="border-bottom:1px solid #e5e5ea;">
                  <td style="padding:8px 14px;font-size:13px;color:#1c1c1e;">${e.full_name}</td>
                  <td style="padding:8px 14px;font-size:13px;color:#555;">${e.category}</td>
                  <td style="padding:8px 14px;font-size:13px;color:#555;">${e.date}</td>
                  <td style="padding:8px 14px;font-size:13px;font-weight:600;text-align:right;">$${parseFloat(e.amount).toFixed(2)}</td>
                  <td style="padding:8px 14px;text-align:center;">
                    <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:${e.status === 'pending' ? '#fef3c7' : '#dcfce7'};color:${e.status === 'pending' ? '#b45309' : '#166534'};text-transform:capitalize;">${e.status}</span>
                  </td>
                </tr>
              `).join('')
              return `
                <div style="display:flex;gap:16px;margin-bottom:16px;">
                  <div style="flex:1;background:#f2f2f7;border-radius:10px;padding:12px 16px;">
                    <p style="font-size:12px;color:#8e8e93;margin:0 0 2px;">Total Outstanding</p>
                    <p style="font-size:18px;font-weight:700;color:#1c1c1e;margin:0;">$${outTotal.toFixed(2)}</p>
                  </div>
                  <div style="flex:1;background:#fef3c7;border-radius:10px;padding:12px 16px;">
                    <p style="font-size:12px;color:#92400e;margin:0 0 2px;">Pending</p>
                    <p style="font-size:18px;font-weight:700;color:#b45309;margin:0;">$${pendingOut.reduce((s,e)=>s+parseFloat(e.amount),0).toFixed(2)} <span style="font-size:13px;font-weight:400;">(${pendingOut.length})</span></p>
                  </div>
                  <div style="flex:1;background:#dcfce7;border-radius:10px;padding:12px 16px;">
                    <p style="font-size:12px;color:#166534;margin:0 0 2px;">Approved</p>
                    <p style="font-size:18px;font-weight:700;color:#166534;margin:0;">$${approvedOut.reduce((s,e)=>s+parseFloat(e.amount),0).toFixed(2)} <span style="font-size:13px;font-weight:400;">(${approvedOut.length})</span></p>
                  </div>
                </div>
                <table style="width:100%;border-collapse:collapse;">
                  <thead>
                    <tr style="background:#f2f2f7;">
                      <th style="padding:8px 14px;text-align:left;font-size:13px;color:#8e8e93;font-weight:600;">Employee</th>
                      <th style="padding:8px 14px;text-align:left;font-size:13px;color:#8e8e93;font-weight:600;">Category</th>
                      <th style="padding:8px 14px;text-align:left;font-size:13px;color:#8e8e93;font-weight:600;">Date</th>
                      <th style="padding:8px 14px;text-align:right;font-size:13px;color:#8e8e93;font-weight:600;">Amount</th>
                      <th style="padding:8px 14px;text-align:center;font-size:13px;color:#8e8e93;font-weight:600;">Status</th>
                    </tr>
                  </thead>
                  <tbody>${outRows}</tbody>
                </table>
              `
            })()
        }

        <p style="font-size:12px;color:#8e8e93;margin:20px 0 0;">Log in to Field Manager Pro to review expenses and time history.</p>
      </div>
    </div>
  `
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if weekly report is enabled
  const config = await queryOne<{ value: string }>(
    `SELECT value FROM dev_config WHERE key = 'weekly_report_enabled'`
  )
  if (config?.value === 'false') {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Yesterday's date range (in UTC, cron runs at 10am UTC = 4am CST)
  const now = new Date()
  const yesterdayStart = new Date(now)
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1)
  yesterdayStart.setUTCHours(0, 0, 0, 0)
  const yesterdayEnd = new Date(yesterdayStart)
  yesterdayEnd.setUTCHours(23, 59, 59, 999)

  const dateLabel = yesterdayStart.toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  // Aggregate hours per employee for yesterday
  const employees = await query<{
    full_name: string
    total_hours: number
    shift_count: number
  }>(`
    SELECT
      u.full_name,
      COUNT(s.id) AS shift_count,
      COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at))), 0) AS total_hours
    FROM users u
    INNER JOIN shifts s ON s.user_id = u.id
      AND s.clock_in_at >= $1
      AND s.clock_in_at <= $2
    WHERE u.role = 'employee' AND u.is_active = TRUE
    GROUP BY u.id, u.full_name
    ORDER BY u.full_name
  `, [yesterdayStart.toISOString(), yesterdayEnd.toISOString()])

  // Expenses submitted yesterday
  const expenses = await query<ExpenseSummary>(`
    SELECT u.full_name, e.category, e.amount, e.status, e.date::text
    FROM expenses e
    JOIN users u ON u.id = e.submitted_by
    WHERE e.created_at >= $1 AND e.created_at <= $2
    ORDER BY e.created_at DESC
  `, [yesterdayStart.toISOString(), yesterdayEnd.toISOString()])

  // All outstanding expenses (pending or approved, not yet paid)
  const outstanding = await query<ExpenseSummary>(`
    SELECT u.full_name, e.category, e.amount, e.status, e.date::text
    FROM expenses e
    JOIN users u ON u.id = e.submitted_by
    WHERE e.status IN ('pending', 'approved')
    ORDER BY e.date ASC, u.full_name
  `)

  const html = weeklyReportHtml(
    dateLabel,
    employees.map(e => ({
      ...e,
      total_hours: Number(e.total_hours),
      shift_count: Number(e.shift_count),
      days_scheduled: [],
    })),
    expenses,
    outstanding
  )

  // Collect recipients: managers + ops_managers + owners + developer if enabled
  const recipients = await query<{ email: string }>(
    `SELECT email FROM users WHERE role IN ('manager','ops_manager','owner','sales_director') AND is_active = TRUE`
  )

  const devConfig = await queryOne<{ value: string }>(
    `SELECT value FROM dev_config WHERE key = 'schedule_submit_notify_developer'`
  )
  if (devConfig?.value !== 'false') {
    const devs = await query<{ email: string }>(
      `SELECT email FROM users WHERE role = 'developer' AND is_active = TRUE`
    )
    recipients.push(...devs)
  }

  const emails = [...new Set(recipients.map(r => r.email))]
  const subject = `FMP Daily Report — ${dateLabel}`

  for (const email of emails) {
    await sendEmail(email, subject, html)
  }

  return NextResponse.json({ ok: true, sent: emails.length })
}
