import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS feature_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submitted_by UUID NOT NULL,
      submitted_by_name TEXT NOT NULL,
      submitted_by_role TEXT NOT NULL,
      org_id UUID,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      dev_notes TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {})
}

// GET — list feature requests
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  let whereClause = ''
  const params: unknown[] = []

  // DMs see only their own, ops+ see all
  if (session.role === 'manager') {
    params.push(session.id)
    whereClause = `WHERE fr.submitted_by = $${params.length}`
  }

  const requests = await query<{
    id: string; submitted_by_name: string; submitted_by_role: string
    title: string; description: string; category: string | null
    status: string; dev_notes: string | null; reviewed_by: string | null
    created_at: string; updated_at: string
  }>(`
    SELECT fr.id, fr.submitted_by_name, fr.submitted_by_role,
           fr.title, fr.description, fr.category,
           fr.status, fr.dev_notes, fr.reviewed_by,
           fr.created_at::text, fr.updated_at::text
    FROM feature_requests fr
    ${whereClause}
    ORDER BY fr.created_at DESC
    LIMIT 100
  `, params)

  return NextResponse.json({ requests })
}

// POST — submit a feature request
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const { title, description, category } = await req.json()
  if (!title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'Title and description are required' }, { status: 400 })
  }

  await query(`
    INSERT INTO feature_requests (submitted_by, submitted_by_name, submitted_by_role, org_id, title, description, category)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [session.id, session.fullName, session.role, session.org_id ?? null, title.trim(), description.trim(), category?.trim() || null])

  // Notify developer
  const devs = await query<{ id: string; email: string }>(`
    SELECT id, email FROM users WHERE role = 'developer' AND is_active = TRUE
  `)
  for (const dev of devs) {
    sendPushToUser(dev.id, 'New Feature Request',
      `${session.fullName} (${session.role.replace(/_/g, ' ')}): ${title.trim().slice(0, 80)}`,
      'task_assigned'
    ).catch(() => {})

    sendEmail(dev.email,
      `Feature Request: ${title.trim()} — from ${session.fullName}`,
      `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h1 style="color:white;margin:0;font-size:18px;">Feature Request</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${session.fullName} · ${session.role.replace(/_/g, ' ')}</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;background:white;">
          <p style="font-size:16px;font-weight:700;color:#111;margin:0 0 8px;">${title.trim()}</p>
          ${category ? `<p style="font-size:12px;color:#7c3aed;font-weight:600;margin:0 0 12px;">${category}</p>` : ''}
          <p style="font-size:14px;color:#374151;margin:0;line-height:1.6;white-space:pre-wrap;">${description.trim()}</p>
        </div>
      </div>`
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

// PATCH — developer updates status
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, status, devNotes } = await req.json()
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })

  const validStatuses = ['submitted', 'under_review', 'planned', 'in_progress', 'completed', 'declined']
  if (!validStatuses.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  await query(`
    UPDATE feature_requests SET status = $1, dev_notes = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
    WHERE id = $4
  `, [status, devNotes?.trim() || null, session.fullName, id])

  // Notify the submitter
  const fr = await queryOne<{ submitted_by: string; title: string }>(`SELECT submitted_by, title FROM feature_requests WHERE id = $1`, [id])
  if (fr) {
    const statusLabel = status.replace(/_/g, ' ')
    sendPushToUser(fr.submitted_by, 'Feature Request Updated',
      `"${fr.title.slice(0, 60)}" is now ${statusLabel}.${devNotes ? ' Note: ' + devNotes.slice(0, 80) : ''}`,
      'task_assigned'
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
