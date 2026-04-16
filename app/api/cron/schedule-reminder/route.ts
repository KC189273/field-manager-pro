import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

// Runs every Monday morning.
// Creates a "Submit staff schedule" task for every active manager with at least one store assigned.
// Also sends them an email reminder.

function getMonday(offsetWeeks = 0): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff + offsetWeeks * 7)
  return d.toISOString().split('T')[0]
}

export async function GET() {
  const thisMonday = getMonday(0)   // current week — task lives here
  const targetWeek = getMonday(2)   // the week managers must schedule
  const targetLabel = new Date(targetWeek + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  })
  const taskTitle = `Submit staff schedule for week of ${targetLabel}`

  // Find all active managers who have at least one store assigned
  const managers = await query<{ id: string; full_name: string; email: string; org_id: string | null }>(
    `SELECT DISTINCT u.id, u.full_name, u.email, u.org_id
     FROM users u
     JOIN dm_manager_stores dms ON dms.manager_id = u.id
     WHERE u.role = 'manager' AND u.is_active = TRUE`
  )

  if (managers.length === 0) return NextResponse.json({ ok: true, created: 0 })

  let created = 0
  for (const manager of managers) {
    // Skip if task already exists for this manager this week
    const existing = await query(
      `SELECT id FROM tasks WHERE assignee_id = $1 AND week_start = $2 AND title = $3`,
      [manager.id, thisMonday, taskTitle]
    )
    if (existing.length > 0) continue

    await query(
      `INSERT INTO tasks (org_id, week_start, title, description, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [
        manager.org_id,
        thisMonday,
        taskTitle,
        `Please log in to Staff Schedule and enter shifts for all your stores for the week of ${targetLabel}. Schedules are required 2 weeks in advance.`,
        manager.id,
      ]
    )
    created++

    // Send reminder email
    const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
    sendEmail(
      manager.email,
      `Action required: Submit staff schedule for ${targetLabel}`,
      `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Weekly Schedule Reminder</p>
          </div>
          <div style="background:#fff3e0;border:1px solid #ff9f0a;border-radius:0 0 12px 12px;padding:24px;">
            <p style="font-size:16px;font-weight:700;color:#e65100;margin:0 0 12px;">⚠ Schedule Due Today</p>
            <p style="font-size:14px;color:#555;margin:0 0 16px;">Hi ${manager.full_name}, your staff schedule for <strong>${targetLabel}</strong> is due by end of day today.</p>
            <p style="font-size:14px;color:#555;margin:0 0 20px;">Please log in and enter all shifts for your stores for that week.</p>
            <a href="${appUrl}/staff-schedule" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Open Staff Schedule</a>
          </div>
        </div>
      `
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, created, total: managers.length })
}
