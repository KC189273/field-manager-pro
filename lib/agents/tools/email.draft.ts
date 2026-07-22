import type { Tool, RunContext } from '../types'

export const draftEmailTool: Tool = {
  name: 'draft_email',
  description: 'Draft a customer-facing email. This does NOT send — it creates a pending action in the review queue for admin approval. Always provide a clear reason explaining why this email should be sent.',
  input_schema: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'The organization UUID this email is about' },
      target_email: { type: 'string', description: 'The recipient email address' },
      subject: { type: 'string', description: 'Email subject line' },
      body: { type: 'string', description: 'Email body in plain text (will be wrapped in HTML template)' },
      reason: { type: 'string', description: 'Why this email should be sent — for the admin reviewer' },
    },
    required: ['account_id', 'target_email', 'subject', 'body', 'reason'],
  },
  async run(input: Record<string, unknown>, ctx: RunContext) {
    const { account_id, target_email, subject, body, reason } = input as {
      account_id: string; target_email: string; subject: string; body: string; reason: string
    }

    await ctx.draftAction({
      type: 'email',
      risk_level: 'high',
      account_id,
      target_email,
      subject,
      body,
      reason,
    })

    return { ok: true, message: 'Email draft created in review queue.' }
  },
}
