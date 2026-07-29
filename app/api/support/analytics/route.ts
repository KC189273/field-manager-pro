import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session || !['developer', 'owner'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Summary stats
  const [stats] = await query<{
    total: number; active: number; resolved: number; escalated: number
    total_messages: number; unique_users: number
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM support_conversations) as total,
      (SELECT COUNT(*)::int FROM support_conversations WHERE status = 'active') as active,
      (SELECT COUNT(*)::int FROM support_conversations WHERE status = 'resolved') as resolved,
      (SELECT COUNT(*)::int FROM support_conversations WHERE status = 'escalated') as escalated,
      (SELECT COUNT(*)::int FROM support_conversation_messages WHERE role = 'user') as total_messages,
      (SELECT COUNT(DISTINCT user_id)::int FROM support_conversations) as unique_users
  `)

  // Conversations with first question
  const conversations = await query<{
    id: string; user_name: string; user_role: string; status: string
    turn_count: number; created_at: string; resolved_at: string | null
    escalation_reason: string | null; first_question: string | null
    resolution: string | null
  }>(`
    SELECT sc.id, sc.user_name, sc.user_role, sc.status, sc.turn_count,
      sc.created_at::text, sc.resolved_at::text, sc.escalation_reason,
      (SELECT scm.body FROM support_conversation_messages scm WHERE scm.conversation_id = sc.id AND scm.role = 'user' ORDER BY scm.created_at LIMIT 1) as first_question,
      (SELECT scm.body FROM support_conversation_messages scm WHERE scm.conversation_id = sc.id AND scm.role = 'assistant' ORDER BY scm.created_at DESC LIMIT 1) as resolution
    FROM support_conversations sc
    ORDER BY sc.created_at DESC
    LIMIT 100
  `)

  // Top users
  const topUsers = await query<{ user_name: string; user_role: string; count: number }>(`
    SELECT user_name, user_role, COUNT(*)::int as count
    FROM support_conversations
    GROUP BY user_name, user_role
    ORDER BY count DESC
    LIMIT 20
  `)

  // Escalation reasons
  const escalationReasons = await query<{ reason: string; count: number }>(`
    SELECT escalation_reason as reason, COUNT(*)::int as count
    FROM support_conversations
    WHERE status = 'escalated' AND escalation_reason IS NOT NULL
    GROUP BY escalation_reason
    ORDER BY count DESC
  `)

  // Daily activity (last 30 days)
  const dailyActivity = await query<{ date: string; conversations: number; messages: number }>(`
    SELECT d::date::text as date,
      (SELECT COUNT(*)::int FROM support_conversations WHERE created_at::date = d) as conversations,
      (SELECT COUNT(*)::int FROM support_conversation_messages WHERE created_at::date = d AND role = 'user') as messages
    FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, '1 day') d
    ORDER BY d
  `)

  return NextResponse.json({
    stats,
    conversations,
    topUsers,
    escalationReasons,
    dailyActivity,
  })
}
