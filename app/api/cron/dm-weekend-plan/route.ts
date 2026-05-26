import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'

// Runs every Wednesday at 10 AM CST (16:00 UTC).
// Creates a "Discuss Weekend Plan w/ RDM" task for every active manager,
// due that day by 8 PM CST.

const TITLE = 'Discuss Weekend Plan w/ RDM'
const DESCRIPTION = 'Connect with your RDM today to discuss weekend coverage, staffing levels, and any action items needed before the weekend.'

function getThisMonday(): string {
  const d = new Date()
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

function getThisWednesday(): string {
  // Cron runs at 16:00 UTC on Wednesday — UTC day is Wednesday
  const d = new Date()
  return d.toISOString().split('T')[0]
}

export async function GET() {
  const monday = getThisMonday()
  const wednesday = getThisWednesday()

  // Due at 8 PM CST = 02:00 UTC the following day (Thursday UTC)
  const dueDate = (() => {
    const d = new Date(wednesday + 'T00:00:00.000Z')
    d.setUTCDate(d.getUTCDate() + 1)
    d.setUTCHours(2, 0, 0, 0) // Thursday 02:00 UTC = Wednesday 8 PM CST
    return d.toISOString()
  })()

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

    sendPushToUser(manager.id, 'New Task', TITLE).catch(() => {})

    const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
    sendEmail(
      manager.email,
      `Task due today: ${TITLE}`,
      `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Weekly Task Reminder</p>
          </div>
          <div style="background:#fff7ed;border:1px solid #fb923c;border-radius:0 0 12px 12px;padding:24px;">
            <p style="font-size:16px;font-weight:700;color:#c2410c;margin:0 0 12px;">📅 ${TITLE}</p>
            <p style="font-size:14px;color:#555;margin:0 0 16px;">Hi ${manager.full_name}, ${DESCRIPTION}</p>
            <p style="font-size:13px;color:#888;margin:0 0 20px;">Due today by <strong>8:00 PM CST</strong>.</p>
            <a href="${appUrl}/tasks" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View Tasks</a>
          </div>
        </div>
      `
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, created, total: managers.length })
}
