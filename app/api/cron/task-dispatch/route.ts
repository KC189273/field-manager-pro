import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail, taskAssignedHtml } from '@/lib/notifications'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'

// Runs every 15 minutes — dispatches task notifications that were scheduled for later
export async function GET() {
  const tasks = await query<{
    id: string
    title: string
    description: string | null
    due_date: string | null
    week_start: string
    assignee_id: string
    assignee_name: string
    assignee_email: string
    creator_name: string
  }>(
    `SELECT t.id, t.title, t.description, t.due_date::text, t.week_start::text,
            t.assignee_id, a.full_name AS assignee_name, a.email AS assignee_email,
            COALESCE(cb.full_name, 'Your manager') AS creator_name
     FROM tasks t
     JOIN users a ON a.id = t.assignee_id
     LEFT JOIN users cb ON cb.id = t.created_by
     LEFT JOIN task_completions tc ON tc.task_id = t.id
     WHERE tc.task_id IS NULL
       AND t.scheduled_send_at IS NOT NULL
       AND t.scheduled_send_at <= NOW()
       AND t.notification_sent_at IS NULL`
  )

  for (const task of tasks) {
    sendPushToUser(task.assignee_id, 'New Task Assigned', task.title, 'task_assigned').catch(() => {})

    if (await isEmailEnabled(task.assignee_id)) {
      const weekOf = new Date(task.week_start + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
      sendEmail(
        task.assignee_email,
        `New task assigned: ${task.title}`,
        taskAssignedHtml(task.assignee_name, task.creator_name, task.title, task.description, weekOf, task.due_date)
      ).catch(() => {})
    }

    await query(`UPDATE tasks SET notification_sent_at = NOW() WHERE id = $1`, [task.id])
  }

  return NextResponse.json({ ok: true, dispatched: tasks.length })
}
