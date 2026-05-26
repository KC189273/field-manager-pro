import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail, taskReminderHtml } from '@/lib/notifications'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'

// Runs daily at 8am CST (14:00 UTC)
// Sends reminders for overdue tasks that haven't been reminded today.
export async function GET() {
  const authHeader = arguments[0]?.headers?.get?.('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Vercel cron calls without a secret in dev — allow if no secret set
    if (process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Find all overdue pending tasks not yet reminded today
  const tasks = await query<{
    id: string
    title: string
    description: string | null
    due_date: string
    assignee_id: string
    assignee_name: string
    assignee_email: string
    creator_id: string | null
    creator_name: string
  }>(
    `SELECT t.id, t.title, t.description, t.due_date::text,
            t.assignee_id, a.full_name AS assignee_name, a.email AS assignee_email,
            cb.id AS creator_id, COALESCE(cb.full_name, 'Your manager') AS creator_name
     FROM tasks t
     JOIN users a ON a.id = t.assignee_id
     LEFT JOIN users cb ON cb.id = t.created_by
     LEFT JOIN task_completions tc ON tc.task_id = t.id
     WHERE tc.task_id IS NULL
       AND t.due_date < NOW()
       AND (t.last_reminded_at IS NULL OR t.last_reminded_at::date < CURRENT_DATE)
     ORDER BY t.due_date ASC`
  )

  let sent = 0
  for (const task of tasks) {
    const dueLabel = new Date(task.due_date).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })

    // Push assignee
    await sendPushToUser(task.assignee_id, 'Overdue Task', `Still pending: ${task.title}`, 'task_assigned')
    if (await isEmailEnabled(task.assignee_id)) {
      await sendEmail(
        task.assignee_email,
        `Overdue: ${task.title}`,
        taskReminderHtml(task.assignee_name, task.title, task.description, dueLabel, task.creator_name)
      )
    }

    // Push creator (DM) — only if different from assignee
    if (task.creator_id && task.creator_id !== task.assignee_id) {
      await sendPushToUser(
        task.creator_id,
        'Task Not Completed',
        `${task.assignee_name} has not completed "${task.title}" (due ${dueLabel}).`,
        'task_assigned'
      )
    }

    await query(`UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1`, [task.id])
    sent++
  }

  return NextResponse.json({ ok: true, reminded: sent })
}
