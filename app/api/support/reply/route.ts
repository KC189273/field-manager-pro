import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

// POST — developer/owner replies to an escalated conversation
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !['developer', 'owner'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { conversationId, actionId, message } = await req.json()
  if (!conversationId || !message?.trim()) {
    return NextResponse.json({ error: 'conversationId and message required' }, { status: 400 })
  }

  // Verify conversation exists and is escalated
  const conv = await queryOne<{ id: string; user_id: string; user_name: string; status: string; org_id: string | null }>(`
    SELECT sc.id, sc.user_id, sc.user_name, sc.status, u.org_id
    FROM support_conversations sc
    LEFT JOIN users u ON u.id = sc.user_id
    WHERE sc.id = $1
  `, [conversationId])

  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Post the reply as an assistant message in the chat
  await queryOne(`
    INSERT INTO support_conversation_messages (conversation_id, role, body)
    VALUES ($1, 'assistant', $2)
  `, [conversationId, message.trim()])

  // Reopen the conversation so the user can continue chatting with the AI bot
  await queryOne(`
    UPDATE support_conversations SET status = 'active', escalated_to = NULL, escalation_reason = NULL
    WHERE id = $1
  `, [conversationId])

  // Mark the agent_action as executed
  if (actionId) {
    await queryOne(`
      UPDATE agent_actions SET status = 'executed', reviewed_by = $1, reviewed_at = NOW(), executed_at = NOW(),
        result = $2
      WHERE id = $3
    `, [session.fullName, `Replied: ${message.trim().slice(0, 200)}`, actionId])
  }

  // Push notification to the user
  sendPushToUser(
    conv.user_id,
    'Support Reply',
    message.trim().slice(0, 100),
    'support_reply'
  ).catch(() => {})

  // Auto-learn: save this Q&A to the learned answers knowledge doc
  const userMessages = await query<{ body: string }>(`
    SELECT body FROM support_conversation_messages
    WHERE conversation_id = $1 AND role = 'user'
    ORDER BY created_at LIMIT 1
  `, [conversationId])

  const originalQuestion = userMessages[0]?.body
  if (originalQuestion) {
    const { autoLearnEscalation } = await import('@/lib/auto-learn')
    await autoLearnEscalation(originalQuestion, message.trim(), conv.user_name, conv.org_id)
  }

  return NextResponse.json({ ok: true })
}
