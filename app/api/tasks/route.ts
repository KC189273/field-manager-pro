import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { getReceiptViewUrl } from '@/lib/s3'
import { sendEmail, taskAssignedHtml } from '@/lib/notifications'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'

interface TaskRow {
  id: string
  week_start: string
  title: string
  description: string | null
  due_date: string | null
  assignee_id: string
  assignee_name: string
  created_by: string | null
  created_by_name: string | null
  created_at: string
  completed_at: string | null
  note: string | null
  photo_key: string | null
  photo_keys: string[]
  completed_by_name: string | null
  require_photo: boolean
}

const canCreate = (role: string) => isOwner(role as never) || role === 'developer' || role === 'manager' || role === 'ops_manager'

let ensured = false
async function ensureColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS require_photo BOOLEAN DEFAULT FALSE`)
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_task_id UUID`)
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ`)
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_send_at TIMESTAMPTZ`)
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ`)
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none'`)
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_id UUID`)
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS store_id UUID`)
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS store_address TEXT`)
}

// GET /api/tasks?weekStart=YYYY-MM-DD  OR  ?history=true[&assigneeId=...]
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const isHistory = searchParams.get('history') === 'true'
  const weekStart = searchParams.get('weekStart')
  const filterAssigneeId = searchParams.get('assigneeId')

  if (!isHistory && !weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  try { await ensureColumns() } catch {}

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []

  // weekStart must be added BEFORE appendOrgFilter so param indices are correct
  let whereClause = ''
  if (isHistory) {
    whereClause = `tc.completed_at IS NOT NULL AND tc.completed_at >= NOW() - INTERVAL '60 days'`
  } else {
    params.push(weekStart) // $1
    whereClause = `t.week_start = $1`
  }

  const orgClause = appendOrgFilter(orgFilter, params, 'a')

  // Scope by role
  let assigneeClause = ''
  if (session.role === 'employee') {
    params.push(session.id)
    assigneeClause = ` AND t.assignee_id = $${params.length}`
  } else if (session.role === 'manager') {
    params.push(session.id)
    params.push(session.id)
    assigneeClause = ` AND (t.assignee_id = $${params.length - 1} OR t.created_by = $${params.length})`
  }

  // Optional assignee filter (for history tab)
  if (filterAssigneeId && session.role !== 'employee') {
    params.push(filterAssigneeId)
    assigneeClause += ` AND t.assignee_id = $${params.length}`
  }

  const tasks = await query<TaskRow>(`
    SELECT
      t.id, t.week_start::text, t.title, t.description, t.due_date::text,
      t.assignee_id, a.full_name AS assignee_name,
      t.created_by, cb.full_name AS created_by_name,
      t.created_at::text,
      tc.completed_at::text, tc.note, tc.photo_key, tc.photo_keys,
      cu.full_name AS completed_by_name,
      t.require_photo, t.group_task_id::text,
      t.scheduled_send_at::text, t.notification_sent_at::text,
      t.recurrence, t.recurrence_id::text,
      t.store_id::text, t.store_address
    FROM tasks t
    JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users cb ON cb.id = t.created_by
    LEFT JOIN task_completions tc ON tc.task_id = t.id
    LEFT JOIN users cu ON cu.id = tc.completed_by
    WHERE ${whereClause}${orgClause}${assigneeClause}
    ORDER BY ${isHistory ? 'tc.completed_at DESC' : 't.created_at'}
  `, params)

  // Generate signed photo URLs server-side
  const tasksWithUrls = await Promise.all(
    tasks.map(async t => ({
      ...t,
      photo_url: t.photo_key ? await getReceiptViewUrl(t.photo_key) : null,
      photo_urls: await Promise.all((t.photo_keys ?? []).map(k => getReceiptViewUrl(k))),
    }))
  )

  return NextResponse.json({ tasks: tasksWithUrls })
}

// POST /api/tasks — create a task
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canCreate(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { weekStart, title, description, assigneeId, dueDate, requirePhoto, groupTaskId, scheduledSendAt, recurrence, storeId, storeAddress, storeAssigneeIds } = await req.json()

  if (!weekStart || !title) {
    return NextResponse.json({ error: 'weekStart and title are required' }, { status: 400 })
  }

  try { await ensureColumns() } catch {}

  const orgFilter = await getOrgFilter(session)

  // ── Store task: create one task per scheduled employee ──
  if (storeId && Array.isArray(storeAssigneeIds) && storeAssigneeIds.length) {
    const gid = crypto.randomUUID()

    // Auto schedule: 8pm CST the night before the due date
    let autoScheduledSendAt: string | null = null
    if (dueDate) {
      const dueDateDay = new Date(dueDate).toISOString().split('T')[0]
      const prev = new Date(dueDateDay + 'T00:00:00Z')
      prev.setDate(prev.getDate() - 1)
      const prevStr = prev.toISOString().split('T')[0]
      const nightBefore = new Date(prevStr + 'T20:00:00-06:00')
      if (nightBefore > new Date()) autoScheduledSendAt = nightBefore.toISOString()
    }

    const insertedIds: string[] = []
    for (const aid of storeAssigneeIds) {
      const assigneeOrg = await queryOne<{ org_id: string | null }>(`SELECT org_id FROM users WHERE id = $1`, [aid])
      const taskOrgId = orgFilter.filterByOrg ? orgFilter.orgId : (assigneeOrg?.org_id ?? null)
      const result = await queryOne<{ id: string }>(
        `INSERT INTO tasks (org_id, week_start, title, description, due_date, assignee_id, created_by,
          require_photo, group_task_id, scheduled_send_at, recurrence, recurrence_id, store_id, store_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'none',NULL,$11,$12) RETURNING id`,
        [taskOrgId, weekStart, title.trim(), description?.trim() || null, dueDate || null, aid,
         session.id, !!requirePhoto, gid, autoScheduledSendAt, storeId, storeAddress ?? null]
      )
      if (result) insertedIds.push(result.id)
    }

    if (!autoScheduledSendAt) {
      // Send immediately
      for (const aid of storeAssigneeIds) {
        const assignee = await queryOne<{ email: string; full_name: string }>(`SELECT email, full_name FROM users WHERE id = $1`, [aid])
        if (assignee?.email && await isEmailEnabled(aid)) {
          const weekOf = new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          sendEmail(assignee.email, `New task assigned: ${title.trim()}`,
            taskAssignedHtml(assignee.full_name, session.fullName, title.trim(), description?.trim() || null, weekOf, dueDate || null)
          ).catch(() => {})
        }
        sendPushToUser(aid, 'New Task Assigned', title.trim(), 'task_assigned').catch(() => {})
      }
      if (insertedIds.length) {
        await query(`UPDATE tasks SET notification_sent_at = NOW() WHERE id = ANY($1::uuid[])`, [insertedIds])
      }
    }

    return NextResponse.json({ ok: true, ids: insertedIds })
  }

  // ── Regular task ──
  if (!assigneeId) {
    return NextResponse.json({ error: 'assigneeId is required' }, { status: 400 })
  }

  const validRecurrences = ['none', 'daily', 'weekly', 'biweekly', 'monthly']
  const finalRecurrence = validRecurrences.includes(recurrence) ? recurrence : 'none'
  const recurrenceId = finalRecurrence !== 'none' ? crypto.randomUUID() : null

  // DMs can assign to their own employees or peer DMs in the same org
  if (session.role === 'manager') {
    const allowed = await queryOne(
      `SELECT 1 FROM users
       WHERE id = $1
         AND (
           (role = 'employee' AND manager_id = $2)
           OR (role = 'manager' AND org_id = $3 AND is_active = TRUE)
         )`,
      [assigneeId, session.id, session.org_id]
    )
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // If creator has no org (e.g. developer), resolve org from the assignee
  let orgId = orgFilter.filterByOrg ? orgFilter.orgId : null
  if (!orgId) {
    const assigneeOrg = await queryOne<{ org_id: string | null }>(`SELECT org_id FROM users WHERE id = $1`, [assigneeId])
    orgId = assigneeOrg?.org_id ?? null
  }

  const sendLater = scheduledSendAt && new Date(scheduledSendAt) > new Date()

  const result = await queryOne<{ id: string }>(
    `INSERT INTO tasks (org_id, week_start, title, description, due_date, assignee_id, created_by,
      require_photo, group_task_id, scheduled_send_at, recurrence, recurrence_id, store_id, store_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [orgId, weekStart, title.trim(), description?.trim() || null, dueDate || null, assigneeId,
     session.id, !!requirePhoto, groupTaskId || null, scheduledSendAt || null, finalRecurrence,
     recurrenceId, storeId || null, storeAddress || null]
  )

  if (!sendLater) {
    const assignee = await queryOne<{ email: string; full_name: string }>(`SELECT email, full_name FROM users WHERE id = $1`, [assigneeId])
    if (assignee?.email && await isEmailEnabled(assigneeId)) {
      const weekOf = new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      sendEmail(assignee.email, `New task assigned: ${title.trim()}`,
        taskAssignedHtml(assignee.full_name, session.fullName, title.trim(), description?.trim() || null, weekOf, dueDate || null)
      ).catch(() => {})
    }
    sendPushToUser(assigneeId, 'New Task Assigned', title.trim(), 'task_assigned').catch(() => {})
    await query(`UPDATE tasks SET notification_sent_at = NOW() WHERE id = $1`, [result?.id])
  }

  return NextResponse.json({ ok: true, id: result?.id })
}

// PATCH /api/tasks — reassign a store task to a specific employee
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !canCreate(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId, reassignToId } = await req.json()
  if (!taskId || !reassignToId) {
    return NextResponse.json({ error: 'taskId and reassignToId required' }, { status: 400 })
  }

  const task = await queryOne<{ created_by: string | null; group_task_id: string | null }>(
    `SELECT created_by, group_task_id::text FROM tasks WHERE id = $1`, [taskId]
  )
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isCreator = task.created_by === session.id
  const isElevated = isOwner(session.role) || session.role === 'developer'
  if (!isCreator && !isElevated) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Delete all other siblings, then update this task
  if (task.group_task_id) {
    await query(`DELETE FROM tasks WHERE group_task_id = $1 AND id != $2`, [task.group_task_id, taskId])
  }
  await query(
    `UPDATE tasks SET assignee_id = $1, group_task_id = NULL, notification_sent_at = NULL WHERE id = $2`,
    [reassignToId, taskId]
  )

  // Notify new assignee
  const [assignee, taskDetails] = await Promise.all([
    queryOne<{ email: string; full_name: string }>(`SELECT email, full_name FROM users WHERE id = $1`, [reassignToId]),
    queryOne<{ title: string; due_date: string | null; week_start: string }>(`SELECT title, due_date::text, week_start::text FROM tasks WHERE id = $1`, [taskId]),
  ])
  if (assignee && taskDetails) {
    sendPushToUser(reassignToId, 'New Task Assigned', taskDetails.title, 'task_assigned').catch(() => {})
    if (await isEmailEnabled(reassignToId)) {
      const weekOf = new Date(taskDetails.week_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      sendEmail(assignee.email, `New task assigned: ${taskDetails.title}`,
        taskAssignedHtml(assignee.full_name, session.fullName, taskDetails.title, null, weekOf, taskDetails.due_date)
      ).catch(() => {})
    }
    await query(`UPDATE tasks SET notification_sent_at = NOW() WHERE id = $1`, [taskId])
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/tasks — delete a task
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !canCreate(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  await query(`DELETE FROM tasks WHERE id = $1`, [taskId])
  return NextResponse.json({ ok: true })
}
