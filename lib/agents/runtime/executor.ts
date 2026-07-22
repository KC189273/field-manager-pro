import { queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

// Execute an approved (or auto-approved) action
export async function executeAction(actionId: string): Promise<{ ok: boolean; error?: string }> {
  const action = await queryOne<{
    id: string; type: string; risk_level: string; status: string
    target_email: string | null; subject: string | null; body: string | null
    payload: unknown
  }>('SELECT * FROM agent_actions WHERE id = $1', [actionId])

  if (!action) return { ok: false, error: 'Action not found' }

  // Safety: never execute a high-risk action that hasn't been approved
  if (action.risk_level === 'high' && action.status !== 'approved') {
    return { ok: false, error: 'High-risk action requires approval before execution' }
  }

  try {
    switch (action.type) {
      case 'email': {
        if (!action.target_email || !action.subject || !action.body) {
          throw new Error('Email action missing target_email, subject, or body')
        }
        await sendEmail(action.target_email, action.subject, action.body)
        break
      }
      case 'escalation':
      case 'note':
      case 'health_snapshot':
        // These are informational — no side effect beyond being recorded
        break
      case 'save_offer':
        // Future: could trigger a specific workflow
        break
      default:
        throw new Error(`Unknown action type: ${action.type}`)
    }

    await queryOne(`
      UPDATE agent_actions SET status = 'executed', executed_at = NOW(), result = 'success'
      WHERE id = $1
    `, [actionId])

    return { ok: true }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await queryOne(`
      UPDATE agent_actions SET status = 'failed', result = $1
      WHERE id = $2
    `, [errorMsg, actionId])
    return { ok: false, error: errorMsg }
  }
}
