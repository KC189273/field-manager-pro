import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { getAccountSupportContext } from '@/lib/agents/tools/account-context'
import { scrubPII } from '@/lib/agents/runtime/guardrails'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'
import * as fs from 'fs'
import * as path from 'path'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MODEL = process.env.AGENTS_MODEL ?? 'claude-haiku-4-5-20251001'
const MAX_TURNS = 20

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

  return `You are the FMP AI Assistant — Field Manager Pro's built-in support helper. You have a conversational, step-by-step troubleshooting style. You're friendly, direct, and never corporate.

LANGUAGE: If the user writes in Spanish, respond entirely in Spanish. Match the user's language throughout the conversation. If they switch languages mid-conversation, switch with them.

HOW YOU WORK:
1. The user describes a problem OR asks for strategic advice.
2. You ask ONE clarifying question if needed to understand the issue.
3. You give ONE specific fix or step to try.
4. You ALWAYS end with: "Did that solve it?" or "Let me know if that worked!"
5. If they say no or it didn't work, you try the NEXT solution from the docs.
6. You should use lookup_account EARLY to check the user's data and diagnose issues before guessing. Always look up their account when troubleshooting clock-in, schedule, timecard, or permission issues.
7. NEVER give up easily. You must exhaust ALL troubleshooting steps before escalating. Do NOT offer to escalate until you have tried every possible solution. Keep going — try different angles, ask more questions, suggest alternative workarounds.
8. If they say yes to escalation, set escalate=true.
9. If they say the fix worked, set resolved=true.

DM STRATEGIC ASSISTANT — if the user is a DM (manager role) and asks strategic questions, you are also their personal coaching assistant. Use lookup_account to get their data, then:

STORE VISIT RECOMMENDATIONS — if they ask "where should I visit?" or "which store needs me?":
- Look at their account data for stores not visited recently
- Consider their team's coaching grades and which reps need development
- Suggest specific stores and WHY (e.g., "Store X hasn't been visited in 8 days and Rep Y there had a D on their last coaching")

NEXT BEST ACTIONS — if they ask "what should I focus on?" or "what do I do today?":
- Check their pending approvals (time-off, supplies)
- Check overdue tasks
- Look at their coaching weakest category and suggest focusing on it
- Suggest stores to visit based on visit frequency
- Recommend specific coaching focus areas

REMINDERS — if they ask you to "remind me to..." or "don't let me forget...":
- Tell them you'll create a task for it. Set lookup_account=true to get their ID, then in your response, say: "I've noted that — create a task for yourself in the Tasks tab with the due date so you don't forget!" (You cannot create tasks directly, but you can coach them to use the task system as their reminder tool.)

COACHING TIPS — if they ask about their coaching grade or how to improve:
- Look up their coaching_grades data (monthly avg, weakest category, trend)
- Give personalized advice based on their weakest category
- Be specific: "Your follow-up scores are averaging 62%. Next time you coach, set a specific date, time, and measurable goal for the follow-up."

Be encouraging but honest. You're their partner in becoming a better leader.

RULES:
1. You ONLY answer questions covered in the help docs below. If a question isn't covered, offer to escalate immediately.
2. You NEVER invent features, steps, or behaviors not in the docs.
3. ONE step at a time. Never dump a wall of instructions. Give one thing to try, then ask if it worked.
4. When you use the lookup_account tool, explain what you found in plain language. Never show raw data, IDs, or technical fields. If the user is a DM and asks about coaching grades, the account data includes their monthly average, weakest category, trend, and days since last coaching. Give them personalized tips based on their weakest category.
5. You can TELL users how to fix things themselves. You CANNOT make changes to their account. If the fix requires someone else to make a change (like a DM or SD), tell them exactly who to ask and what to ask for.
6. Never discuss billing, pricing, or cancellation — offer to escalate those.
7. Never share other users' data, even within the same org.
8. Be warm and casual. Use their first name. No "I apologize for the inconvenience" — just help them.

DEVICE & NETWORK TRIAGE — for technical issues (clock-in problems, GPS issues, app freezing, loading errors, features not working), ask these questions early:
- What device are you using? (iPhone/Android, model if they know)
- Are you using the app or a browser?
- Is your app updated to the latest version?
- Is your phone's software up to date?
- Are you on WiFi or cellular data?
- Is Low Power Mode / Battery Saver turned on?
This helps determine if it's a device issue, a network issue, an outdated app/OS issue, or a bug we need to fix.

GPS / CLOCK-IN TROUBLESHOOTING — if the user can't clock in due to GPS/location issues, work through ALL of these steps in order before even considering escalation:
1. Force close the app and reopen
2. Check location permission is set to "Always" (not "While Using")
3. iPhone: check that "Precise Location" is ON (separate toggle under Location)
4. Toggle location permission off then back on (While Using → Always)
5. Check if Low Power Mode is on — turn it OFF
6. Step outside for a better GPS signal
7. Full phone restart (power off, wait 10 sec, power on)
8. iPhone: check Settings → Privacy → Location Services → System Services — make sure location-related toggles are on
9. Ask if they recently updated their phone software (iOS/Android update can reset permissions)
10. Delete the app/bookmark from Home Screen and re-add it: open Safari → go to fieldmanagerpro.app → Share button → Add to Home Screen → grant location permission fresh
11. Try clocking in through the BROWSER directly (Safari/Chrome → fieldmanagerpro.app) instead of the app — this tests whether the issue is app-specific or phone-wide
12. Check if other apps can use GPS (open Maps and see if it finds their location)
13. iPhone: Reset Location & Privacy settings (Settings → General → Transfer or Reset → Reset → Reset Location & Privacy) — this is a last resort that resets ALL app permissions

ONLY escalate clock-in/GPS issues after you have tried ALL of the above steps AND confirmed the user's device info. The dev team should never receive an escalation that just says "GPS doesn't work" — they need to know exactly what was tried and what the results were.

ESCALATION — when you offer to escalate, explain:
"I'll send the dev team our full conversation plus everything we've tried, so they can pick up right where we left off. They'll reach out to you directly."

RESPONSE FORMAT:
Always respond with a JSON object (no markdown wrapping):
{
  "message": "your response to the user",
  "escalate": false,
  "escalation_reason": null,
  "resolved": false,
  "lookup_account": false
}

Set lookup_account=true when you need to check the user's specific account data to diagnose their issue. The system will return the data and you respond again.

GEOFENCE OVERRIDE — if an employee can't clock in due to GPS inaccuracy:
1. Walk them through the GPS troubleshooting steps first (all 13 steps)
2. If GPS is confirmed inaccurate (Maps app also shows wrong location), tell them: "Your DM can clock you in using the Geofence Override. On the Clock page, your DM taps 'Geofence Override — Clock in an employee', selects your name, the store, and the reason."
3. If they're on an iOS beta, tell them to leave the beta: Settings → General → Software Update → Beta Updates → Off
4. If the issue is recurring, let them know the system will automatically flag it for the dev team after 3 overrides

CLOCK-IN PHOTO — employees and DMs are now prompted to take a uniform photo when clocking in:
- Currently optional (testing phase through August)
- Starting September 1, photos will be required at every clock-in
- Camera only — no gallery uploads. Must be taken at the time of clock-in.
- Photos show on timecards for DM review
- If someone can't take a photo (camera broken), they can still clock in but it will be flagged

Set escalate=true when:
- You've exhausted all solutions from the docs and the user confirms the issue persists
- The fix requires a write/config change only the dev team can do
- The question isn't covered in any doc
- The user asks to talk to a person or escalate
- You detect a bug (account data contradicts expected behavior)

IMPORTANT — APP CHANGES: If the auto-triage determines that an app update, code change, or configuration change is needed to fix the issue, this MUST be escalated to the developer for approval. The escalation must include a detailed explanation of what change is recommended and why. No changes should be made to the app without developer approval.

Set resolved=true when the user confirms the fix worked, says thanks, or says goodbye.

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

  // Handle resolution — auto-learn from successful conversations
  if (parsed.resolved) {
    await queryOne(`UPDATE support_conversations SET status = 'resolved', resolved_at = NOW() WHERE id = $1`, [convId])

    // Auto-learn: save the Q&A from successfully resolved conversations (3+ turns)
    if (turnCount >= 3) {
      try {
        const convMessages = await query<{ role: string; body: string }>(`
          SELECT role, body FROM support_conversation_messages
          WHERE conversation_id = $1 AND role IN ('user', 'assistant')
          ORDER BY created_at LIMIT 2
        `, [convId])
        const firstQ = convMessages.find(m => m.role === 'user')?.body
        const firstA = convMessages.find(m => m.role === 'assistant')?.body
        if (firstQ && firstA && firstQ.length > 10) {
          const { autoLearnResolved } = await import('@/lib/auto-learn')
          autoLearnResolved(firstQ, reply, session.fullName)
        }
      } catch { /* never block resolution */ }
    }

    return NextResponse.json({ reply, escalated: false, resolved: true, showRating: true, conversationId: convId })
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
  const messages = await query<{ role: string; body: string; created_at: string }>(`
    SELECT role, body, created_at::text FROM support_conversation_messages
    WHERE conversation_id = $1 ORDER BY created_at
  `, [convId])

  const transcript = messages.map(m => `[${m.role}] ${m.body}`).join('\n\n')
  const firstUserMsg = messages.find(m => m.role === 'user')?.body ?? 'No message'

  const conv = await queryOne<{ user_name: string; user_role: string; industry: string; org_id: string | null; user_id: string }>(`
    SELECT user_name, user_role, industry, org_id, user_id FROM support_conversations WHERE id = $1
  `, [convId])

  await queryOne(`
    UPDATE support_conversations SET status = 'escalated', escalated_to = 'Shaun', escalation_reason = $1
    WHERE id = $2
  `, [reason, convId])

  // Create escalation action with conversation_id for reply routing
  await queryOne(`
    INSERT INTO agent_actions (agent, type, risk_level, status, account_id, subject, body, reason, payload)
    VALUES ('support', 'escalation', 'high', 'pending', $1, $2, $3, $4, $5)
  `, [
    conv?.org_id ?? null,
    `[SUPPORT] ${conv?.user_name ?? userName} (${conv?.user_role ?? 'unknown'})`,
    `Conversation transcript:\n\n${transcript}`,
    reason,
    JSON.stringify({ conversation_id: convId, user_id: conv?.user_id, user_name: conv?.user_name, first_question: firstUserMsg }),
  ])

  // Push notification to all developers
  const devs = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'developer' AND is_active = TRUE`)
  for (const dev of devs) {
    sendPushToUser(
      dev.id,
      `Support Escalation — ${conv?.user_name ?? userName}`,
      firstUserMsg.slice(0, 100),
      'support_escalation'
    ).catch(() => {})
  }

  // ── Auto-triage: comprehensive diagnostics ──
  const diagnosis: string[] = []
  const userId = conv?.user_id
  if (userId) {
    const question = (firstUserMsg + ' ' + (reason || '') + ' ' + transcript).toLowerCase()

    // Account checks (always run)
    const userInfo = await queryOne<{ is_active: boolean; is_terminated: boolean; manager_id: string | null; manager_name: string | null; pay_type: string }>(`
      SELECT u.is_active, u.is_terminated, u.manager_id, m.full_name as manager_name, u.pay_type
      FROM users u LEFT JOIN users m ON m.id = u.manager_id WHERE u.id = $1
    `, [userId]).catch(() => null)
    if (userInfo) {
      if (!userInfo.is_active) diagnosis.push('CRITICAL: ACCOUNT INACTIVE — cannot log in or clock in')
      if (userInfo.is_terminated) diagnosis.push('CRITICAL: ACCOUNT TERMINATED')
      if (!userInfo.manager_id) diagnosis.push('CRITICAL: NO MANAGER ASSIGNED — invisible to all DMs')
      else diagnosis.push(`Manager: ${userInfo.manager_name}`)
    }

    // Clock-in / GPS diagnostics
    if (question.includes('clock') || question.includes('location') || question.includes('gps') || question.includes('freeze')) {
      // Active shift check
      const activeShift = await queryOne<{ id: string; clock_in_at: string }>(`
        SELECT id, clock_in_at::text FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
      `, [userId]).catch(() => null)
      if (activeShift) {
        const hoursActive = (Date.now() - new Date(activeShift.clock_in_at).getTime()) / 3600000
        diagnosis.push(`Active shift found (${hoursActive.toFixed(1)}h)${hoursActive > 14 ? ' — LIKELY STUCK, needs manual clock-out' : ''}`)
      } else {
        diagnosis.push('No active shift — not currently clocked in')
      }

      // Geofence settings
      if (conv?.org_id) {
        const geo = await queryOne<{ geofence_enabled: boolean; geofence_radius_ft: number; geofence_exit_minutes: number }>(`
          SELECT COALESCE(geofence_enabled, TRUE) as geofence_enabled, COALESCE(geofence_radius_ft, 300) as geofence_radius_ft, COALESCE(geofence_exit_minutes, 10) as geofence_exit_minutes
          FROM organizations WHERE id = $1
        `, [conv.org_id]).catch(() => null)
        if (geo?.geofence_enabled) diagnosis.push(`Geofencing ON (${geo.geofence_radius_ft}ft radius, ${geo.geofence_exit_minutes}min exit) — GPS REQUIRED for employees`)
        else diagnosis.push('Geofencing OFF — GPS not required')
      }

      // Shift history analysis — when did GPS last work?
      const recentShifts = await query<{ clock_in_at: string; clock_in_lat: string | null; store_address: string | null }>(`
        SELECT s.clock_in_at::text, s.clock_in_lat::text, sl.address as store_address
        FROM shifts s LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
        WHERE s.user_id = $1 ORDER BY s.clock_in_at DESC LIMIT 10
      `, [userId]).catch(() => [])

      const withGps = recentShifts.filter(s => s.clock_in_lat)
      const withoutGps = recentShifts.filter(s => !s.clock_in_lat)
      const lastGpsShift = withGps.length > 0 ? withGps[0] : null
      const daysSinceLastShift = recentShifts.length > 0 ? Math.round((Date.now() - new Date(recentShifts[0].clock_in_at).getTime()) / 86400000) : -1

      diagnosis.push(`Last 10 shifts: ${withGps.length} with GPS, ${withoutGps.length} without GPS`)
      if (lastGpsShift) {
        const daysSinceGps = Math.round((Date.now() - new Date(lastGpsShift.clock_in_at).getTime()) / 86400000)
        diagnosis.push(`Last GPS clock-in: ${lastGpsShift.clock_in_at.slice(0, 10)} (${daysSinceGps} days ago) at ${lastGpsShift.store_address || 'unknown'}`)
        if (daysSinceGps <= 7 && daysSinceLastShift > daysSinceGps) {
          diagnosis.push(`GPS worked ${daysSinceGps} days ago but employee hasn't clocked in for ${daysSinceLastShift} days — DEVICE ISSUE: GPS broke recently`)
        }
      }
      if (withGps.length === 0 && recentShifts.length > 0) {
        diagnosis.push('DEVICE ISSUE: Employee has NEVER had GPS on any shift — device location is completely off or denied')
      }

      // GPS breadcrumbs
      const recentGps = await queryOne<{ cnt: number; latest: string | null }>(`
        SELECT COUNT(*)::int as cnt, MAX(recorded_at)::text as latest
        FROM gps_breadcrumbs WHERE user_id = $1 AND recorded_at > NOW() - INTERVAL '14 days'
      `, [userId]).catch(() => null)
      diagnosis.push(`GPS breadcrumbs (14d): ${recentGps?.cnt ?? 0}${recentGps?.latest ? ` (latest: ${recentGps.latest.slice(0, 10)})` : ''}`)

      // Store assignment check
      if (userInfo?.manager_id) {
        const storeCount = await queryOne<{ cnt: number }>(`
          SELECT COUNT(*)::int as cnt FROM dm_manager_stores dms
          JOIN dm_store_locations dsl ON dsl.id = dms.store_location_id AND dsl.active = TRUE
          WHERE dms.manager_id = $1
        `, [userInfo.manager_id]).catch(() => null)
        diagnosis.push(`Stores via manager: ${storeCount?.cnt ?? 0}${(storeCount?.cnt ?? 0) === 0 ? ' — NO STORES, cannot clock in' : ''}`)
      }

      // Test clock-in from server side (geofence check)
      if (lastGpsShift?.clock_in_lat && lastGpsShift?.store_address) {
        diagnosis.push(`Server-side geofence test would use last known GPS — if clock-in works from backend, issue is DEVICE not APP`)
      }

      // Extract device info from transcript
      if (question.includes('iphone')) diagnosis.push('Device: iPhone')
      else if (question.includes('android')) diagnosis.push('Device: Android')
      if (question.includes('safari')) diagnosis.push('Using: Safari browser')
      if (question.includes('app')) diagnosis.push('Using: Native app / PWA')

      // Check geofence override history
      const overrideCount = await queryOne<{ cnt: number }>(`
        SELECT COUNT(*)::int as cnt FROM geofence_overrides WHERE employee_id = $1 AND created_at > NOW() - INTERVAL '7 days'
      `, [userId]).catch(() => null)
      if (overrideCount && overrideCount.cnt > 0) {
        diagnosis.push(`Geofence overrides (7d): ${overrideCount.cnt}${overrideCount.cnt >= 3 ? ' — RECURRING ISSUE, needs device investigation' : ''}`)
      }

      // Assessment
      diagnosis.push('---')
      if (question.includes('beta') || question.includes('ios 27') || question.includes('ios 26')) {
        diagnosis.push('ASSESSMENT: Likely iOS beta GPS bug. Employee should leave beta: Settings → General → Software Update → Beta Updates → Off. DM can use Geofence Override in the meantime.')
        diagnosis.push('ACTION: No app changes needed. Device issue — employee needs to update software.')
      } else if (withGps.length > 0 && daysSinceLastShift > (lastGpsShift ? Math.round((Date.now() - new Date(lastGpsShift.clock_in_at).getTime()) / 86400000) : 999)) {
        diagnosis.push('ASSESSMENT: Device GPS issue — GPS worked previously but stopped. Likely cause: iOS update, Low Power Mode, PWA permission reset, or Precise Location toggled off.')
        diagnosis.push('ACTION: No app changes needed. DM can use Geofence Override while employee fixes device. If issue persists after all troubleshooting, escalate to developer for review.')
      } else if (withGps.length === 0) {
        diagnosis.push('ASSESSMENT: Device GPS never worked — location services likely denied or phone GPS is off entirely. Employee needs to enable location services.')
        diagnosis.push('ACTION: No app changes needed. Employee must fix device settings. DM can use Geofence Override.')
      } else {
        diagnosis.push('ASSESSMENT: Need more info to determine root cause.')
        diagnosis.push('ACTION: If this appears to be an app bug rather than a device issue, escalate to developer with full details. Developer approval required before any app changes.')
      }
    }

    // Schedule checks
    if (question.includes('schedule') || question.includes('shift') || question.includes('work')) {
      const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
      const scheduled = await queryOne<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM scheduled_shifts WHERE employee_id = $1 AND shift_date = $2`, [userId, todayCST]).catch(() => null)
      diagnosis.push(`Scheduled today: ${scheduled?.cnt || 0} shift(s)`)
      const published = await queryOne<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM scheduled_shifts_publish WHERE week_start BETWEEN ($1::date - 6) AND $1::date`, [todayCST]).catch(() => null)
      if (!published || published.cnt === 0) diagnosis.push('No published schedule this week — employee sees empty My Schedule')
    }

    // Last shift
    const lastShift = await queryOne<{ clock_in_at: string; store_address: string | null }>(`
      SELECT s.clock_in_at::text, sl.address as store_address FROM shifts s
      LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
      WHERE s.user_id = $1 AND s.clock_out_at IS NOT NULL ORDER BY s.clock_in_at DESC LIMIT 1
    `, [userId]).catch(() => null)
    if (lastShift) diagnosis.push(`Last completed shift: ${lastShift.clock_in_at.slice(0, 10)} at ${lastShift.store_address || 'unknown'}`)
  }

  const triageHtml = diagnosis.length > 0
    ? `<div style="margin:16px 0 0;">
        <p style="font-size:13px;font-weight:700;color:#7c3aed;margin:0 0 8px;">Auto-Triage Findings</p>
        ${diagnosis.map(d => {
          const isCritical = d.includes('INACTIVE') || d.includes('TERMINATED') || d.includes('NO MANAGER') || d.includes('stuck')
          return `<div style="padding:6px 10px;margin-bottom:4px;border-left:3px solid ${isCritical ? '#dc2626' : '#7c3aed'};background:${isCritical ? '#fef2f2' : '#f5f3ff'};border-radius:0 6px 6px 0;">
            <p style="margin:0;font-size:13px;color:#111;">${d}</p>
          </div>`
        }).join('')}
      </div>`
    : ''

  // Email to developer + owner with triage included
  const admins = await query<{ email: string; full_name: string }>(`
    SELECT email, full_name FROM users WHERE role IN ('developer', 'owner') AND is_active = TRUE
  `)
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  for (const admin of admins) {
    sendEmail(
      admin.email,
      `[Support Escalation] ${conv?.user_name ?? userName}: ${firstUserMsg.slice(0, 60)}`,
      `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h1 style="color:white;margin:0;font-size:20px;">Support Escalation</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">${conv?.user_name ?? userName} (${conv?.user_role ?? 'unknown'})</p>
        </div>
        <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
          <p style="font-size:14px;color:#555;margin:0 0 8px;"><strong>Question:</strong> ${firstUserMsg}</p>
          <p style="font-size:14px;color:#555;margin:0 0 8px;"><strong>Reason:</strong> ${reason}</p>
          ${triageHtml}
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
          <p style="font-size:12px;color:#888;margin:0 0 4px;"><strong>Full Transcript:</strong></p>
          <pre style="font-size:12px;color:#555;background:#f9f9f9;padding:12px;border-radius:8px;white-space:pre-wrap;">${transcript.slice(0, 2000)}</pre>
          <a href="${appUrl}/admin/agents" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-top:16px;">Reply in App</a>
        </div>
      </div>`
    ).catch(() => {})
  }
}
