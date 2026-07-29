import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import * as fs from 'fs'
import * as path from 'path'

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
  const conv = await queryOne<{ id: string; user_id: string; user_name: string; status: string }>(`
    SELECT id, user_id, user_name, status FROM support_conversations WHERE id = $1
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
    autoLearn(originalQuestion, message.trim(), conv.user_name)
  }

  return NextResponse.json({ ok: true })
}

// Auto-learn: append answered Q&A to a learned-answers knowledge doc
function autoLearn(question: string, answer: string, userName: string) {
  try {
    const learnedPath = path.join(process.cwd(), 'lib/agents/knowledge/shared/learned-answers.md')
    const date = new Date().toISOString().split('T')[0]

    const entry = `\n\n## Q: ${question}\n**A:** ${answer}\n*Answered ${date} for ${userName}*\n`

    if (!fs.existsSync(learnedPath)) {
      const header = `---
sources: []
features:
  - learned-answers
permissions:
  - "auto-generated from escalation replies"
verified: ${date}
---
# Learned Answers

These answers were provided by the dev team in response to escalated support questions. The AI Assistant uses these to answer similar questions without escalating again.
`
      fs.writeFileSync(learnedPath, header + entry)
    } else {
      fs.appendFileSync(learnedPath, entry)
      // Update verified date
      const content = fs.readFileSync(learnedPath, 'utf-8')
      const updated = content.replace(/verified: \d{4}-\d{2}-\d{2}/, `verified: ${date}`)
      fs.writeFileSync(learnedPath, updated)
    }
  } catch (err) {
    console.error('Auto-learn write failed:', err)
  }
}
