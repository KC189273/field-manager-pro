import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

// POST /api/calendar/task-reminder
// Lets a DM add a quick "follow up" calendar reminder for a task they created
// Body: { taskId }
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'manager') {
    return NextResponse.json({ error: 'Only managers can add task reminders to their calendar' }, { status: 403 })
  }

  const { taskId } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const task = await queryOne<{ title: string; due_date: string | null; assignee_id: string; created_by: string | null }>(
    `SELECT title, due_date::text, assignee_id::text, created_by::text FROM tasks WHERE id = $1`, [taskId]
  )
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  // Must be the creator or the assignee
  if (task.created_by !== session.id && task.assignee_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const targetDate = task.due_date ?? new Date().toISOString().split('T')[0]

  // Check if a calendar reminder already exists for this task on this user's calendar
  const existing = await queryOne(
    `SELECT id FROM calendar_events WHERE task_id = $1 AND calendar_owner_id = $2 AND title LIKE 'Follow up:%'`,
    [taskId, session.id]
  )
  if (existing) {
    return NextResponse.json({ error: 'Reminder already added to your calendar' }, { status: 409 })
  }

  const result = await queryOne<{ id: string }>(`
    INSERT INTO calendar_events
      (title, category, start_date, end_date, all_day, notes,
       calendar_owner_id, task_id, created_by, created_by_name, recurrence)
    VALUES ($1, 'other', $2, $2, TRUE, $3, $4, $5, $4, $6, 'none')
    RETURNING id
  `, [
    `Follow up: ${task.title}`,
    targetDate,
    `Task reminder — tap to view in Tasks`,
    session.id,
    taskId,
    session.fullName,
  ])

  return NextResponse.json({ ok: true, id: result?.id })
}
