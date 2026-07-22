import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { getAccountSupportContext } from '@/lib/agents/tools/account-context'
import { scrubPII } from '@/lib/agents/runtime/guardrails'
import * as fs from 'fs'
import * as path from 'path'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MODEL = process.env.AGENTS_MODEL ?? 'claude-haiku-4-5-20251001'
const MAX_TURNS = 8

const FRUSTRATION_KEYWORDS = ['talk to a person', 'real person', 'human', 'escalate', 'this isn\'t helping', 'not helpful', 'speak to someone', 'let me talk to', 'give me a human']

const KNOWLEDGE_DIR = path.join(process.cwd(), 'lib/agents/knowledge')

function loadDocs(namespace: string): string {
  const dir = path.join(KNOWLEDGE_DIR, namespace)
  if (!fs.existsSync(dir)) return ''
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8')
      // Strip frontmatter
      if (content.startsWith('---\n')) {
        const end = content.indexOf('\n---\n', 4)
        return end !== -1 ? `[${namespace}/${f}]\n${content.substring(end + 5)}` : content
      }
      return `[${namespace}/${f}]\n${content}`
    })
    .join('\n\n---\n\n')
}

function buildSystemPrompt(industry: string): string {
  const verticalDocs = loadDocs(industry)
  const sharedDocs = loadDocs('shared')

  return `You are the Field Manager Pro Support Assistant. You help users troubleshoot issues in a live back-and-forth conversation. You are friendly, concise, and grounded.

RULES — follow these exactly:
1. You ONLY answer questions covered in the help docs below. If a question isn't covered, say "I don't have information on that — let me connect you with Shaun who can help" and set escalate=true.
2. You NEVER invent features, steps, or behaviors not in the docs. If unsure, escalate.
3. You ask ONE clarifying question at a time. Don't dump a wall of steps before understanding the problem.
4. When you use the lookup_account tool, explain what you found in plain language. Never show raw JSON, IDs, or database fields to the user.
5. You can TELL users how to fix things themselves (steps they perform in the app). You CANNOT make changes to their account. If the fix requires a database change, account edit, or anything the user can't do themselves, escalate with the specific action needed.
6. When escalating, be warm: "Let me connect you with Shaun — he'll have our full conversation and can take care of this."
7. Sign off concisely. Don't over-apologize. Be helpful, not corporate.
8. You are NOT the decision-maker. You help users help themselves.
9. Never discuss billing, pricing, or cancellation — always escalate those.
10. Never share other users' data, even within the same org.

RESPONSE FORMAT:
Always respond with a JSON object (no markdown wrapping):
{
  "message": "your response to the user",
  "escalate": false,
  "escalation_reason": null,
  "resolved": false,
  "lookup_account": false
}

Set lookup_account=true ONLY on your first response or when you need to check specific account data to diagnose. The system will call the tool and send results back — then respond again with lookup_account=false.

Set escalate=true when:
- The fix requires a write/config change you can't tell them to do themselves
- The question isn't covered in docs
- The user asks for a person
- You detect a bug (account data contradicts expected behavior)
- You've tried to help but the issue isn't resolving

Set resolved=true when the user confirms the issue is fixed, or says thanks/goodbye.

HELP DOCS (ground every answer in these):

${verticalDocs}

${sharedDocs}`
}

// GET: load conversation history
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find active conversation
  const conv = await queryOne<{ id: string; status: string; turn_count: number }>(`
    SELECT id, status, turn_count FROM support_conversations
    WHERE user_id = $1 AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `, [session.id])

  if (!conv) return NextResponse.json({ conversation: null, messages: [] })

  const messages = await query<{ id: string; role: string; body: string; created_at: string }>(`
    SELECT id, role, body, created_at::text FROM support_conversation_messages
    WHERE conversation_id = $1 ORDER BY created_at
  `, [conv.id])

  return NextResponse.json({ conversation: conv, messages })
}

// POST: send a message and get AI response
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Kill switch
  if (process.env.AGENTS_ENABLED === 'false') {
    return NextResponse.json({ error: 'Support chat is temporarily unavailable. Please try again later.' }, { status: 503 })
  }

  const { message, conversationId } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 })

  const userMessage = scrubPII(message.trim())

  // Get or create conversation
  let convId = conversationId
  let turnCount = 0

  if (convId) {
    const conv = await queryOne<{ id: string; status: string; turn_count: number; user_id: string }>(`
      SELECT id, status, turn_count, user_id FROM support_conversations WHERE id = $1
    `, [convId])
    if (!conv || conv.user_id !== session.id) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    if (conv.status !== 'active') return NextResponse.json({ error: 'This conversation has been resolved or escalated. Start a new one.' }, { status: 400 })
    turnCount = conv.turn_count
  } else {
    // Check rate limit: max 3 conversations per org per day
    if (session.org_id) {
      const todayCount = await queryOne<{ count: number }>(`
        SELECT COUNT(*)::int as count FROM support_conversations
        WHERE org_id = $1 AND created_at >= CURRENT_DATE
      `, [session.org_id])
      if ((todayCount?.count ?? 0) >= 10) {
        return NextResponse.json({ error: 'Daily support limit reached. Please try again tomorrow or email shaun@gephartenterprises.com.' }, { status: 429 })
      }
    }

    // Check for existing active conversation
    const existing = await queryOne<{ id: string }>(`
      SELECT id FROM support_conversations WHERE user_id = $1 AND status = 'active'
    `, [session.id])
    if (existing) {
      convId = existing.id
      const conv = await queryOne<{ turn_count: number }>('SELECT turn_count FROM support_conversations WHERE id = $1', [convId])
      turnCount = conv?.turn_count ?? 0
    } else {
      const org = session.org_id
        ? await queryOne<{ industry: string }>('SELECT COALESCE(industry, \'unknown\') as industry FROM organizations WHERE id = $1', [session.org_id])
        : null

      const newConv = await queryOne<{ id: string }>(`
        INSERT INTO support_conversations (org_id, user_id, user_name, user_role, industry)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [session.org_id ?? null, session.id, session.fullName, session.role, org?.industry ?? 'unknown'])
      convId = newConv!.id
    }
  }

  // Check turn limit
  turnCount++
  if (turnCount > MAX_TURNS) {
    // Auto-escalate
    await escalateConversation(convId, 'Maximum conversation length reached (8 turns). Escalating to Shaun for further assistance.', session.fullName)
    return NextResponse.json({
      reply: "I've been working on this for a while and want to make sure you get the right help. Let me connect you with Shaun — he'll have our full conversation and can take it from here.",
      escalated: true,
      resolved: false,
    })
  }

  // Check frustration keywords
  const lowerMsg = userMessage.toLowerCase()
  if (FRUSTRATION_KEYWORDS.some(k => lowerMsg.includes(k))) {
    await queryOne(`INSERT INTO support_conversation_messages (conversation_id, role, body) VALUES ($1, 'user', $2)`, [convId, userMessage])
    const reply = "Absolutely — let me connect you with Shaun right now. He'll have our full conversation and your account details."
    await queryOne(`INSERT INTO support_conversation_messages (conversation_id, role, body) VALUES ($1, 'assistant', $2)`, [convId, reply])
    await escalateConversation(convId, 'User requested a human agent.', session.fullName)
    return NextResponse.json({ reply, escalated: true, resolved: false })
  }

  // Save user message
  await queryOne(`INSERT INTO support_conversation_messages (conversation_id, role, body) VALUES ($1, 'user', $2)`, [convId, userMessage])
  await queryOne(`UPDATE support_conversations SET turn_count = $1 WHERE id = $2`, [turnCount, convId])

  // Load conversation history
  const history = await query<{ role: string; body: string }>(`
    SELECT role, body FROM support_conversation_messages
    WHERE conversation_id = $1 ORDER BY created_at
  `, [convId])

  // Determine industry for docs
  const conv = await queryOne<{ industry: string }>('SELECT industry FROM support_conversations WHERE id = $1', [convId])
  const industry = conv?.industry ?? 'wireless_retail'

  // Build messages for Claude
  const systemPrompt = buildSystemPrompt(industry)
  const claudeMessages: Anthropic.MessageParam[] = []

  for (const msg of history) {
    if (msg.role === 'user') {
      claudeMessages.push({ role: 'user', content: msg.body })
    } else if (msg.role === 'assistant') {
      claudeMessages.push({ role: 'assistant', content: msg.body })
    } else if (msg.role === 'system') {
      claudeMessages.push({ role: 'user', content: `[System: ${msg.body}]` })
    }
  }

  // First Claude call
  let response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: claudeMessages,
  })

  let responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
  let parsed = parseResponse(responseText)

  // If agent wants account lookup, do it and send results back
  if (parsed.lookup_account) {
    const accountContext = await getAccountSupportContext(session.id, session.org_id ?? null)
    const contextStr = scrubPII(JSON.stringify(accountContext, null, 2))

    // Log the tool call
    await queryOne(`INSERT INTO support_conversation_messages (conversation_id, role, body, tool_calls) VALUES ($1, 'system', $2, $3)`,
      [convId, '[Account lookup performed]', JSON.stringify({ type: 'account_lookup', data: accountContext })])

    // Send context back to Claude
    claudeMessages.push({ role: 'assistant', content: responseText })
    claudeMessages.push({ role: 'user', content: `[System: Account data for diagnosis (read-only). The user cannot see this data. Use it to diagnose their issue.]\n\n${contextStr}` })

    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    })

    responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
    parsed = parseResponse(responseText)
  }

  const reply = parsed.message || "I'm having trouble processing that. Could you rephrase your question?"

  // Save assistant response
  await queryOne(`INSERT INTO support_conversation_messages (conversation_id, role, body) VALUES ($1, 'assistant', $2)`, [convId, reply])

  // Handle escalation
  if (parsed.escalate) {
    await escalateConversation(convId, parsed.escalation_reason || 'Agent determined escalation was needed.', session.fullName)
    return NextResponse.json({ reply, escalated: true, resolved: false })
  }

  // Handle resolution
  if (parsed.resolved) {
    await queryOne(`UPDATE support_conversations SET status = 'resolved', resolved_at = NOW() WHERE id = $1`, [convId])
    return NextResponse.json({ reply, escalated: false, resolved: true })
  }

  return NextResponse.json({ reply, escalated: false, resolved: false, conversationId: convId })
}

function parseResponse(text: string): { message: string; escalate: boolean; escalation_reason: string | null; resolved: boolean; lookup_account: boolean } {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        message: parsed.message || text,
        escalate: !!parsed.escalate,
        escalation_reason: parsed.escalation_reason || null,
        resolved: !!parsed.resolved,
        lookup_account: !!parsed.lookup_account,
      }
    }
  } catch {}
  // Fallback: treat entire text as the message
  return { message: text, escalate: false, escalation_reason: null, resolved: false, lookup_account: false }
}

async function escalateConversation(convId: string, reason: string, userName: string) {
  // Get full transcript
  const messages = await query<{ role: string; body: string; created_at: string }>(`
    SELECT role, body, created_at::text FROM support_conversation_messages
    WHERE conversation_id = $1 ORDER BY created_at
  `, [convId])

  const transcript = messages.map(m => `[${m.role}] ${m.body}`).join('\n\n')

  // Get conversation details
  const conv = await queryOne<{ user_name: string; user_role: string; industry: string; org_id: string | null }>(`
    SELECT user_name, user_role, industry, org_id FROM support_conversations WHERE id = $1
  `, [convId])

  // Update conversation status
  await queryOne(`
    UPDATE support_conversations SET status = 'escalated', escalated_to = 'Shaun', escalation_reason = $1
    WHERE id = $2
  `, [reason, convId])

  // Create escalation action in agent_actions for the admin inbox
  await queryOne(`
    INSERT INTO agent_actions (agent, type, risk_level, status, account_id, subject, body, reason)
    VALUES ('support', 'escalation', 'high', 'pending', $1,
      $2, $3, $4)
  `, [
    conv?.org_id ?? null,
    `[SUPPORT ESCALATION] ${conv?.user_name ?? userName} (${conv?.user_role ?? 'unknown'})`,
    `Conversation transcript:\n\n${transcript}`,
    reason,
  ])
}
