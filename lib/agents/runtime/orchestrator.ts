import { query, queryOne } from '@/lib/db'
import type { AgentKey, TriggerType, ActionDraft, RunContext, RunResult } from '../types'
import { getAgent } from '../index'
import { runClaudeLoop } from './claude'
import { remember, recall } from './memory'
import {
  agentsEnabled,
  checkDailyCostCap,
  checkRunCostCap,
  estimateCost,
  resolveRisk,
  isDuplicate,
} from './guardrails'

export async function runAgent(
  agentKey: AgentKey,
  trigger: TriggerType,
  input?: string
): Promise<RunResult> {
  // Kill switch
  if (!agentsEnabled()) {
    return {
      runId: '',
      status: 'error',
      error: 'Agents are disabled (AGENTS_ENABLED=false)',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      actionsCreated: 0,
    }
  }

  // Daily cost cap
  await checkDailyCostCap()

  // Look up agent definition
  const agent = getAgent(agentKey)
  if (!agent) {
    return {
      runId: '',
      status: 'error',
      error: `Unknown agent: ${agentKey}`,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      actionsCreated: 0,
    }
  }

  // Create the run record
  const run = await queryOne<{ id: string }>(`
    INSERT INTO agent_runs (agent, trigger, status)
    VALUES ($1, $2, 'running')
    RETURNING id
  `, [agentKey, trigger])

  if (!run) {
    return {
      runId: '',
      status: 'error',
      error: 'Failed to create agent_runs row',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      actionsCreated: 0,
    }
  }

  const runId = run.id
  let actionsCreated = 0

  // Build the run context
  const ctx: RunContext = {
    runId,
    agent: agentKey,

    async draftAction(draft: ActionDraft) {
      // Idempotency: skip if same (agent, account, type) already exists today
      if (await isDuplicate(agentKey, draft.account_id, draft.type)) {
        return // silently skip duplicate
      }

      const risk = resolveRisk(draft.type, agent.defaultRisk)
      const status = risk === 'low' ? 'auto_executed' : 'pending'

      await queryOne(`
        INSERT INTO agent_actions (run_id, agent, type, risk_level, status, account_id, target_email, subject, body, payload, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        runId, agentKey, draft.type, risk, status,
        draft.account_id ?? null,
        draft.target_email ?? null,
        draft.subject ?? null,
        draft.body ?? null,
        draft.payload ? JSON.stringify(draft.payload) : null,
        draft.reason,
      ])
      actionsCreated++
    },

    async remember(entityType: string, entityId: string, key: string, value: unknown) {
      await remember(agentKey, entityType, entityId, key, value)
    },

    async recall(entityType: string, entityId: string) {
      return recall(agentKey, entityType, entityId)
    },

    spendGuard(inputTokens: number, outputTokens: number) {
      checkRunCostCap(inputTokens, outputTokens)
    },
  }

  try {
    const userMessage = input || `Run the ${agentKey} agent. Trigger: ${trigger}.`

    const result = await runClaudeLoop(
      agent.systemPrompt,
      userMessage,
      agent.tools,
      ctx,
      agent.maxSteps
    )

    const costUsd = estimateCost(result.inputTokens, result.outputTokens)

    // Update the run record
    await queryOne(`
      UPDATE agent_runs
      SET status = 'ok', summary = $1, input_tokens = $2, output_tokens = $3,
          cost_usd = $4, finished_at = NOW()
      WHERE id = $5
    `, [result.summary, result.inputTokens, result.outputTokens, costUsd, runId])

    // Health→Growth handoff: if Health just ran successfully, check for pending handoffs
    if (agentKey === 'health') {
      const pendingHandoffs = await query<{ entity_id: string }>(`
        SELECT entity_id FROM agent_memory
        WHERE agent = 'health' AND key = 'pending_growth_handoff'
      `)
      if (pendingHandoffs.length > 0) {
        // Spawn a Growth Agent run asynchronously (fire-and-forget)
        const growthAgent = getAgent('growth')
        if (growthAgent) {
          runAgent('growth', 'handoff').catch(err => {
            console.error('Growth handoff failed:', err)
          })
        }
      }
    }

    return {
      runId,
      status: 'ok',
      summary: result.summary,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd,
      actionsCreated,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    await queryOne(`
      UPDATE agent_runs
      SET status = 'error', error = $1, finished_at = NOW()
      WHERE id = $2
    `, [errorMsg, runId])

    return {
      runId,
      status: 'error',
      error: errorMsg,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      actionsCreated,
    }
  }
}
