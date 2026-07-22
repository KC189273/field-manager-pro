import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { executeAction } from '@/lib/agents/runtime/executor'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { actionId, action } = await req.json()

  if (!actionId || !action) {
    return NextResponse.json({ error: 'actionId and action required' }, { status: 400 })
  }

  if (action === 'approve') {
    await queryOne(`
      UPDATE agent_actions SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
      WHERE id = $2 AND status = 'pending'
    `, [session.fullName, actionId])

    const result = await executeAction(actionId)
    return NextResponse.json(result)
  }

  if (action === 'reject') {
    await queryOne(`
      UPDATE agent_actions SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
      WHERE id = $2 AND status = 'pending'
    `, [session.fullName, actionId])

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action. Use approve or reject.' }, { status: 400 })
}
