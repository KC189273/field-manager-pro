import type { Agent, AgentKey } from './types'
import { healthAgent } from './definitions/health.agent'
import { onboardingAgent } from './definitions/onboarding.agent'
import { supportAgent } from './definitions/support.agent'
import { growthAgent } from './definitions/growth.agent'
import { docsyncAgent } from './definitions/docsync.agent'

// Agent registry
const agents: Record<string, Agent> = {
  health: healthAgent,
  onboarding: onboardingAgent,
  support: supportAgent,
  growth: growthAgent,
  docsync: docsyncAgent,
}

export function getAgent(key: AgentKey): Agent | undefined {
  return agents[key]
}

export function getAllAgents(): Agent[] {
  return Object.values(agents)
}
