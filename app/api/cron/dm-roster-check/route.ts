import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'

// Runs every Monday at 10 AM CST (16:00 UTC).
// Creates a "Check Roster for accuracy" task for every active manager.

const TITLE = 'Check Roster for accuracy'
const DESCRIPTION = 'Review your employee roster to ensure all active employees are correctly listed, inactive employees are deactivated, and manager assignments are up to date.'

function getThisMonday(): string {
  const d = new Date()
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

export async function GET() {
  const monday = getThisMonday()

  // Due at 10 AM CST = 16:00 UTC the same Monday
  const dueDate = new Date(monday + 'T16:00:00.000Z').toISOString()

  // All active managers
  const managers = await query<{ id: string; full_name: string; email: string; org_id: string | null }>(
    `SELECT id, full_name, email, org_id FROM users WHERE role = 'manager' AND is_active = TRUE`
  )

  if (managers.length === 0) return NextResponse.json({ ok: true, created: 0 })

  let created = 0
  for (const manager of managers) {
    const existing = await query(
      `SELECT id FROM tasks WHERE assignee_id = $1 AND week_start = $2 AND title = $3`,
      [manager.id, monday, TITLE]
    )
    if (existing.length > 0) continue

    await query(
      `INSERT INTO tasks (org_id, week_start, title, description, due_date, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
      [manager.org_id, monday, TITLE, DESCRIPTION, dueDate, manager.id]
    )
    created++

    sendPushToUser(manager.id, 'New Task', TITLE, 'task_assigned').catch(() => {})

    const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
    sendEmail(
      manager.email,
      `Weekly task: ${TITLE}`,
      `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Weekly Task Reminder</p>
          </div>
          <div style="background:#f0f9ff;border:1px solid #38bdf8;border-radius:0 0 12px 12px;padding:24px;">
            <p style="font-size:16px;font-weight:700;color:#0369a1;margin:0 0 12px;">📋 ${TITLE}</p>
            <p style="font-size:14px;color:#555;margin:0 0 16px;">Hi ${manager.full_name}, ${DESCRIPTION}</p>
            <p style="font-size:13px;color:#888;margin:0 0 20px;">Due today by 10:00 AM CST.</p>
            <a href="${appUrl}/tasks" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View Tasks</a>
          </div>
        </div>
      `
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, created, total: managers.length })
}
