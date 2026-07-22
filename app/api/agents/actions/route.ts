import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // 'pending' | 'auto_executed' | 'executed' | 'all'
  const limit = parseInt(searchParams.get('limit') ?? '50')

  let where = ''
  const params: unknown[] = []

  if (status && status !== 'all') {
    params.push(status)
    where = `WHERE aa.status = $${params.length}`
  }

  const actions = await query<{
    id: string; run_id: string; agent: string; type: string
    risk_level: string; status: string; account_id: string | null
    target_email: string | null; subject: string | null; body: string | null
    payload: unknown; reason: string | null; reviewed_by: string | null
    created_at: string; reviewed_at: string | null; executed_at: string | null
    result: string | null; account_name: string | null; industry: string | null
  }>(`
    SELECT aa.*,
      o.name AS account_name,
      o.industry
    FROM agent_actions aa
    LEFT JOIN organizations o ON o.id = aa.account_id
    ${where}
    ORDER BY aa.created_at DESC
    LIMIT ${limit}
  `, params)

  return NextResponse.json({ actions })
}

// PATCH: edit a pending action's draft before approving
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { actionId, subject, body } = await req.json()
  if (!actionId) return NextResponse.json({ error: 'actionId required' }, { status: 400 })

  const action = await queryOne<{ status: string }>('SELECT status FROM agent_actions WHERE id = $1', [actionId])
  if (!action) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (action.status !== 'pending') return NextResponse.json({ error: 'Can only edit pending actions' }, { status: 400 })

  const updates: string[] = []
  const params: unknown[] = []

  if (subject !== undefined) {
    params.push(subject)
    updates.push(`subject = $${params.length}`)
  }
  if (body !== undefined) {
    params.push(body)
    updates.push(`body = $${params.length}`)
  }

  if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  params.push(actionId)
  await queryOne(`UPDATE agent_actions SET ${updates.join(', ')} WHERE id = $${params.length}`, params)

  return NextResponse.json({ ok: true })
}
