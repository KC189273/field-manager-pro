import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

// Returns agent actions that were edited before approval.
// These are training data for prompt tightening — compare the original draft
// (from the agent) with what you changed before sending.
export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Find executed actions that have a reviewed_at (meaning they went through the inbox)
  // We can't diff original vs edited since we overwrite, but we can show all
  // approved+executed emails per agent so you can review your voice/tone patterns
  const edits = await query<{
    id: string; agent: string; type: string; account_name: string | null
    industry: string | null; subject: string | null; body: string | null
    reason: string | null; reviewed_by: string | null
    created_at: string; reviewed_at: string | null
  }>(`
    SELECT aa.id, aa.agent, aa.type,
      o.name AS account_name, o.industry,
      aa.subject, aa.body, aa.reason, aa.reviewed_by,
      aa.created_at::text, aa.reviewed_at::text
    FROM agent_actions aa
    LEFT JOIN organizations o ON o.id = aa.account_id
    WHERE aa.status = 'executed' AND aa.type = 'email'
    ORDER BY aa.reviewed_at DESC
    LIMIT 50
  `)

  // Group by agent for easy review
  const byAgent: Record<string, typeof edits> = {}
  for (const e of edits) {
    if (!byAgent[e.agent]) byAgent[e.agent] = []
    byAgent[e.agent].push(e)
  }

  return NextResponse.json({
    total: edits.length,
    byAgent,
    hint: 'Review these sent emails to tighten each agent\'s system prompt and vertical voiceNotes. Look for patterns in how you edited drafts before approving.',
  })
}
