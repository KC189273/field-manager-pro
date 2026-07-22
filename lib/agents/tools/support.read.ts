import { query } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'
import type { Tool, RunContext } from '../types'

const KNOWLEDGE_DIR = path.join(process.cwd(), 'lib/agents/knowledge')

// ── Load knowledge docs by vertical namespace ───────────────────────────────
function loadDocs(namespace: string): { filename: string; content: string }[] {
  const dir = path.join(KNOWLEDGE_DIR, namespace)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      filename: `${namespace}/${f}`,
      content: fs.readFileSync(path.join(dir, f), 'utf-8'),
    }))
}

// ── Get pending support messages ─────────────────────────────────────────────
export const getSupportMessagesTool: Tool = {
  name: 'get_support_messages',
  description: 'Fetch all unprocessed support messages (status = "new"). Each message includes the sender, their account, their vertical (industry), and the question.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async run(_input: Record<string, unknown>, _ctx: RunContext) {
    const messages = await query<{
      id: string; org_id: string | null; user_id: string | null
      user_name: string | null; user_email: string | null
      industry: string | null; subject: string; body: string; created_at: string
    }>(`
      SELECT sm.id, sm.org_id, sm.user_id, sm.user_name, sm.user_email,
        COALESCE(sm.industry, o.industry, 'unknown') AS industry,
        sm.subject, sm.body, sm.created_at::text
      FROM support_messages sm
      LEFT JOIN organizations o ON o.id = sm.org_id
      WHERE sm.status = 'new'
      ORDER BY sm.created_at
    `)
    return messages
  },
}

// ── Retrieve knowledge docs for a vertical ───────────────────────────────────
export const retrieveKnowledgeTool: Tool = {
  name: 'retrieve_knowledge',
  description: 'Load help documentation for a specific vertical. Returns all docs from that vertical\'s namespace plus shared docs. Use this to ground your answers — never answer from memory alone. Pass the account\'s industry (e.g. "wireless_retail" or "barbershop").',
  input_schema: {
    type: 'object',
    properties: {
      industry: { type: 'string', description: 'The vertical to retrieve docs for (e.g. "wireless_retail", "barbershop")' },
    },
    required: ['industry'],
  },
  async run(input: Record<string, unknown>, _ctx: RunContext) {
    const industry = input.industry as string
    const verticalDocs = loadDocs(industry)
    const sharedDocs = loadDocs('shared')
    const allDocs = [...verticalDocs, ...sharedDocs]

    if (allDocs.length === 0) {
      return { found: false, message: `No knowledge docs found for vertical "${industry}". Escalate this question.` }
    }

    return {
      found: true,
      doc_count: allDocs.length,
      docs: allDocs.map(d => ({ file: d.filename, content: d.content })),
    }
  },
}

// ── Mark support message as processed ────────────────────────────────────────
export const markMessageProcessedTool: Tool = {
  name: 'mark_message_processed',
  description: 'Mark a support message as processed after drafting a reply or escalation.',
  input_schema: {
    type: 'object',
    properties: {
      message_id: { type: 'string', description: 'The support message UUID to mark as processed' },
      agent_run_id: { type: 'string', description: 'The current run ID for audit trail' },
    },
    required: ['message_id'],
  },
  async run(input: Record<string, unknown>, ctx: RunContext) {
    const { message_id } = input as { message_id: string }
    await query(
      `UPDATE support_messages SET status = 'processed', agent_run_id = $1 WHERE id = $2`,
      [ctx.runId, message_id]
    )
    return { ok: true }
  },
}

// ── Escalate to admin ────────────────────────────────────────────────────────
export const escalateTool: Tool = {
  name: 'escalate_to_admin',
  description: 'Escalate a support issue to the admin. Use this for bugs, account-specific issues you can\'t answer, or when no relevant knowledge docs exist. This does NOT draft a customer reply — it just flags the issue for the admin.',
  input_schema: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'The org UUID (if known)' },
      user_email: { type: 'string', description: 'The user\'s email for context' },
      subject: { type: 'string', description: 'Brief summary of the issue' },
      body: { type: 'string', description: 'Full details of the issue and why it needs admin attention' },
      reason: { type: 'string', description: 'Why this is being escalated (bug, no docs, account-specific, etc.)' },
    },
    required: ['subject', 'body', 'reason'],
  },
  async run(input: Record<string, unknown>, ctx: RunContext) {
    const { account_id, user_email, subject, body, reason } = input as {
      account_id?: string; user_email?: string; subject: string; body: string; reason: string
    }

    await ctx.draftAction({
      type: 'escalation',
      risk_level: 'high',
      account_id,
      target_email: user_email,
      subject: `[ESCALATION] ${subject}`,
      body,
      reason,
    })

    return { ok: true, message: 'Escalation created in review queue.' }
  },
}
