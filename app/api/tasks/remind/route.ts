import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, taskReminderHtml } from '@/lib/notifications'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'

const canRemind = (role: string) =>
  role === 'manager' || role === 'ops_manager' || role === 'owner' ||
  role === 'sales_director' || role === 'developer'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canRemind(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const task = await queryOne<{
    title: string
    description: string | null
    due_date: string | null
    assignee_id: string
    assignee_name: string
    assignee_email: string
    completed_at: string | null
  }>(
    `SELECT t.title, t.description, t.due_date::text,
            t.assignee_id, a.full_name AS assignee_name, a.email AS assignee_email,
            tc.completed_at::text
     FROM tasks t
     JOIN users a ON a.id = t.assignee_id
     LEFT JOIN task_completions tc ON tc.task_id = t.id
     WHERE t.id = $1`,
    [taskId]
  )

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (task.completed_at) return NextResponse.json({ error: 'Task already completed' }, { status: 400 })

  const dueLabel = task.due_date
    ? new Date(task.due_date).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : 'No due date'

  // Send push + email
  await sendPushToUser(task.assignee_id, 'Task Reminder', `Don't forget: ${task.title}`, 'task_assigned')
  if (await isEmailEnabled(task.assignee_id)) {
    await sendEmail(
      task.assignee_email,
      `Reminder: ${task.title}`,
      taskReminderHtml(task.assignee_name, task.title, task.description, dueLabel, session.fullName)
    )
  }

  // Record last reminded time
  await query(`UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1`, [taskId])

  return NextResponse.json({ ok: true })
}
