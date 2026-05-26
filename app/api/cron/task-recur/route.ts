import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'
import { sendEmail, taskAssignedHtml } from '@/lib/notifications'

// Runs hourly — creates the next instance of each recurring task series
// when no future instance exists yet.
export async function GET() {
  // Get the latest task in each recurrence series
  const series = await query<{
    recurrence_id: string
    recurrence: string
    title: string
    description: string | null
    due_date: string
    week_start: string
    assignee_id: string
    org_id: string | null
    require_photo: boolean
    created_by: string | null
  }>(
    `SELECT DISTINCT ON (recurrence_id)
       recurrence_id::text, recurrence, title, description,
       due_date::text, week_start::text, assignee_id::text,
       org_id::text, require_photo, created_by::text
     FROM tasks
     WHERE recurrence != 'none' AND recurrence_id IS NOT NULL
     ORDER BY recurrence_id, due_date DESC`
  )

  let created = 0

  for (const task of series) {
    // Check assignee is still active
    const assignee = await queryOne<{ is_active: boolean; full_name: string; email: string }>(
      `SELECT is_active, full_name, email FROM users WHERE id = $1`,
      [task.assignee_id]
    )
    if (!assignee?.is_active) continue

    // Check if a future instance already exists for this series
    const futureExists = await queryOne(
      `SELECT id FROM tasks WHERE recurrence_id = $1 AND due_date > NOW()`,
      [task.recurrence_id]
    )
    if (futureExists) continue

    // Calculate next due date
    const latestDue = new Date(task.due_date)
    const nextDue = new Date(latestDue)
    switch (task.recurrence) {
      case 'daily':    nextDue.setDate(nextDue.getDate() + 1); break
      case 'weekly':   nextDue.setDate(nextDue.getDate() + 7); break
      case 'biweekly': nextDue.setDate(nextDue.getDate() + 14); break
      case 'monthly':  nextDue.setMonth(nextDue.getMonth() + 1); break
      default: continue
    }

    // Calculate the Monday of the week nextDue falls in
    const d = new Date(nextDue)
    const dow = d.getDay()
    const diff = dow === 0 ? -6 : 1 - dow
    d.setDate(d.getDate() + diff)
    const nextWeekStart = d.toISOString().split('T')[0]

    // Create the next instance
    const result = await queryOne<{ id: string }>(
      `INSERT INTO tasks (org_id, week_start, title, description, due_date, assignee_id, created_by,
                          require_photo, recurrence, recurrence_id, notification_sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       RETURNING id`,
      [
        task.org_id, nextWeekStart, task.title, task.description,
        nextDue.toISOString(), task.assignee_id, task.created_by,
        task.require_photo, task.recurrence, task.recurrence_id,
      ]
    )

    // Send push notification
    sendPushToUser(task.assignee_id, 'Recurring Task', task.title, 'task_assigned').catch(() => {})

    // Send email if enabled
    if (assignee.email && await isEmailEnabled(task.assignee_id)) {
      const creator = task.created_by
        ? await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [task.created_by])
        : null
      const weekOf = new Date(nextWeekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      sendEmail(
        assignee.email,
        `Recurring task: ${task.title}`,
        taskAssignedHtml(assignee.full_name, creator?.full_name ?? 'Your manager', task.title, task.description, weekOf, nextDue.toISOString())
      ).catch(() => {})
    }

    created++
    void result
  }

  return NextResponse.json({ ok: true, created })
}
