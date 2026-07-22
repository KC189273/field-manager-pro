export type Risk = 'low' | 'high'

export type AgentKey = 'health' | 'onboarding' | 'support' | 'growth' | 'docsync'

export type TriggerType = 'cron' | 'event' | 'handoff' | 'manual'

export type ActionType = 'email' | 'escalation' | 'save_offer' | 'note' | 'health_snapshot'

export interface Tool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  run: (input: Record<string, unknown>, ctx: RunContext) => Promise<unknown>
}

export interface Agent {
  key: AgentKey
  systemPrompt: string
  tools: Tool[]
  maxSteps: number
  defaultRisk: Risk
}

export interface ActionDraft {
  type: ActionType
  risk_level: Risk
  account_id?: string
  target_email?: string
  subject?: string
  body?: string
  payload?: Record<string, unknown>
  reason: string
}

export interface RunContext {
  runId: string
  agent: AgentKey
  draftAction: (a: ActionDraft) => Promise<void>
  remember: (entityType: string, entityId: string, key: string, value: unknown) => Promise<void>
  recall: (entityType: string, entityId: string) => Promise<Record<string, unknown>>
  spendGuard: (inputTokens: number, outputTokens: number) => void
}

export interface RunResult {
  runId: string
  status: 'ok' | 'error'
  summary?: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  error?: string
  actionsCreated: number
}
