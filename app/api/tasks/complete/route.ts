import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, taskCompletedHtml } from '@/lib/notifications'

const canAlwaysComplete = (role: string) => isOwner(role as never) || role === 'developer'

async function assertAccess(session: { id: string; role: string }, taskId: string): Promise<boolean> {
  if (canAlwaysComplete(session.role)) return true
  const task = await queryOne<{ assignee_id: string }>(
    `SELECT assignee_id FROM tasks WHERE id = $1`,
    [taskId]
  )
  return task?.assignee_id === session.id
}

// POST — mark task complete (upsert)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId, note, photoKey } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  if (!(await assertAccess(session, taskId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await query(
    `INSERT INTO task_completions (task_id, completed_by, note, photo_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (task_id) DO UPDATE
       SET completed_by = EXCLUDED.completed_by,
           completed_at = NOW(),
           note = EXCLUDED.note,
           photo_key = EXCLUDED.photo_key`,
    [taskId, session.id, note || null, photoKey || null]
  )

  // Email the task creator
  const task = await queryOne<{ title: string; created_by: string | null }>(
    `SELECT title, created_by FROM tasks WHERE id = $1`,
    [taskId]
  )
  if (task?.created_by && task.created_by !== session.id) {
    const creator = await queryOne<{ email: string; full_name: string }>(
      `SELECT email, full_name FROM users WHERE id = $1`,
      [task.created_by]
    )
    if (creator?.email) {
      const completedAt = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      sendEmail(
        creator.email,
        `Task completed: ${task.title}`,
        taskCompletedHtml(creator.full_name, session.fullName, task.title, note || null, completedAt)
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}

// DELETE — uncheck a task
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  if (!(await assertAccess(session, taskId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await query(`DELETE FROM task_completions WHERE task_id = $1`, [taskId])
  return NextResponse.json({ ok: true })
}
