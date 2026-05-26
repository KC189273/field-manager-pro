import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, taskCompletedHtml } from '@/lib/notifications'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'
import { getS3ObjectBuffer } from '@/lib/s3'

const canAlwaysComplete = (role: string) => isOwner(role as never) || role === 'developer'

async function assertAccess(session: { id: string; role: string }, taskId: string): Promise<boolean> {
  if (canAlwaysComplete(session.role)) return true
  // Managers (DMs) can complete tasks they created or are assigned to
  if (session.role === 'manager') {
    const task = await queryOne<{ assignee_id: string; created_by: string | null }>(
      `SELECT assignee_id, created_by FROM tasks WHERE id = $1`,
      [taskId]
    )
    return task?.assignee_id === session.id || task?.created_by === session.id
  }
  const task = await queryOne<{ assignee_id: string }>(
    `SELECT assignee_id FROM tasks WHERE id = $1`,
    [taskId]
  )
  return task?.assignee_id === session.id
}

// POST — mark task complete (upsert)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId, note, photoKey, photoKeys } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  if (!(await assertAccess(session, taskId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch task info (for require_photo check + notification email)
  const task = await queryOne<{ require_photo: boolean; title: string; created_by: string | null; group_task_id: string | null }>(
    `SELECT require_photo, title, created_by, group_task_id::text FROM tasks WHERE id = $1`,
    [taskId]
  )
  if (task?.require_photo && (!photoKeys?.length && !photoKey)) {
    return NextResponse.json({ error: 'A photo is required to complete this task.' }, { status: 400 })
  }

  await query(
    `INSERT INTO task_completions (task_id, completed_by, note, photo_key, photo_keys)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (task_id) DO UPDATE
       SET completed_by = EXCLUDED.completed_by,
           completed_at = NOW(),
           note = EXCLUDED.note,
           photo_key = EXCLUDED.photo_key,
           photo_keys = EXCLUDED.photo_keys`,
    [taskId, session.id, note || null, photoKey || null, photoKeys?.length ? photoKeys : []]
  )

  // Complete all sibling group tasks
  if (task?.group_task_id) {
    const siblings = await query<{ id: string }>(
      `SELECT id FROM tasks WHERE group_task_id = $1 AND id != $2`,
      [task.group_task_id, taskId]
    )
    for (const { id } of siblings) {
      await query(
        `INSERT INTO task_completions (task_id, completed_by, note, photo_key, photo_keys)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (task_id) DO UPDATE
           SET completed_by = EXCLUDED.completed_by,
               completed_at = NOW(),
               note = EXCLUDED.note,
               photo_key = EXCLUDED.photo_key,
               photo_keys = EXCLUDED.photo_keys`,
        [id, session.id, note || null, photoKey || null, photoKeys?.length ? photoKeys : []]
      )
    }
  }

  // Notify the task creator
  if (task?.created_by && task.created_by !== session.id) {
    const creator = await queryOne<{ email: string; full_name: string }>(
      `SELECT email, full_name FROM users WHERE id = $1`,
      [task.created_by]
    )
    if (creator?.email && await isEmailEnabled(task.created_by)) {
      const completedAt = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      // Attach completion photos
      const allKeys = [...(photoKeys ?? []), ...(photoKey && !photoKeys?.includes(photoKey) ? [photoKey] : [])].filter(Boolean) as string[]
      const attachments: { filename: string; content: string }[] = []
      await Promise.all(allKeys.map(async (key, i) => {
        const buf = await getS3ObjectBuffer(key)
        if (buf) {
          const ext = key.split('.').pop() ?? 'jpg'
          attachments.push({ filename: `completion-photo-${i + 1}.${ext}`, content: buf.toString('base64') })
        }
      }))
      sendEmail(
        creator.email,
        `Task completed: ${task.title}`,
        taskCompletedHtml(creator.full_name, session.fullName, task.title, note || null, completedAt),
        attachments
      ).catch(() => {})
    }
    sendPushToUser(task.created_by, 'Task Completed', `${session.fullName} completed: ${task.title}`, 'task_completed').catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

// DELETE — uncheck a task
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  if (!(await assertAccess(session, taskId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await query(`DELETE FROM task_completions WHERE task_id = $1`, [taskId])

  // Uncheck all sibling group tasks
  const groupTask = await queryOne<{ group_task_id: string | null }>(
    `SELECT group_task_id::text FROM tasks WHERE id = $1`, [taskId]
  )
  if (groupTask?.group_task_id) {
    const siblings = await query<{ id: string }>(
      `SELECT id FROM tasks WHERE group_task_id = $1 AND id != $2`,
      [groupTask.group_task_id, taskId]
    )
    for (const { id } of siblings) {
      await query(`DELETE FROM task_completions WHERE task_id = $1`, [id])
    }
  }

  return NextResponse.json({ ok: true })
}
