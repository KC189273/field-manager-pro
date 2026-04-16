import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { getReceiptViewUrl } from '@/lib/s3'
import { sendEmail, taskAssignedHtml } from '@/lib/notifications'

interface TaskRow {
  id: string
  week_start: string
  title: string
  description: string | null
  assignee_id: string
  assignee_name: string
  created_by: string | null
  created_by_name: string | null
  created_at: string
  completed_at: string | null
  note: string | null
  photo_key: string | null
  completed_by_name: string | null
}

const canCreate = (role: string) => isOwner(role as never) || role === 'developer'

// GET /api/tasks?weekStart=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('weekStart')
  if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  const orgFilter = await getOrgFilter(session)
  const isManager = session.role === 'manager' || session.role === 'ops_manager'

  const params: unknown[] = [weekStart]
  const orgClause = appendOrgFilter(orgFilter, params, 't')

  // Managers only see tasks assigned to them
  let assigneeClause = ''
  if (isManager) {
    params.push(session.id)
    assigneeClause = ` AND t.assignee_id = $${params.length}`
  }

  const tasks = await query<TaskRow>(`
    SELECT
      t.id, t.week_start::text, t.title, t.description,
      t.assignee_id, a.full_name AS assignee_name,
      t.created_by, cb.full_name AS created_by_name,
      t.created_at::text,
      tc.completed_at::text, tc.note, tc.photo_key,
      cu.full_name AS completed_by_name
    FROM tasks t
    JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users cb ON cb.id = t.created_by
    LEFT JOIN task_completions tc ON tc.task_id = t.id
    LEFT JOIN users cu ON cu.id = tc.completed_by
    WHERE t.week_start = $1${orgClause}${assigneeClause}
    ORDER BY t.created_at
  `, params)

  // Generate signed photo URLs server-side
  const tasksWithUrls = await Promise.all(
    tasks.map(async t => ({
      ...t,
      photo_url: t.photo_key ? await getReceiptViewUrl(t.photo_key) : null,
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

  const { weekStart, title, description, assigneeId } = await req.json()
  if (!weekStart || !title || !assigneeId) {
    return NextResponse.json({ error: 'weekStart, title, and assigneeId are required' }, { status: 400 })
  }

  const orgFilter = await getOrgFilter(session)
  const orgId = orgFilter.filterByOrg ? orgFilter.orgId : null

  const result = await queryOne<{ id: string }>(
    `INSERT INTO tasks (org_id, week_start, title, description, assignee_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [orgId, weekStart, title.trim(), description?.trim() || null, assigneeId, session.id]
  )

  // Email the assignee
  const assignee = await queryOne<{ email: string; full_name: string }>(
    `SELECT email, full_name FROM users WHERE id = $1`,
    [assigneeId]
  )
  if (assignee?.email) {
    const weekOf = new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    sendEmail(
      assignee.email,
      `New task assigned: ${title.trim()}`,
      taskAssignedHtml(assignee.full_name, session.fullName, title.trim(), description?.trim() || null, weekOf)
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, id: result?.id })
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
