import { cookies } from 'next/headers'
import type { SessionPayload } from './auth'

export interface OrgFilter {
  filterByOrg: boolean
  orgId: string | null
}

export const DEMO_ORG_ID = 'd8d9b6e9-c706-42ea-87fe-b4f2e08727b7'
const DEFAULT_DEV_ORG = '4395bc4f-0571-4c6d-8c93-f7d4edfb6997' // WGG

export async function getOrgFilter(session: SessionPayload): Promise<OrgFilter> {
  if (session.role === 'prospect') {
    return { filterByOrg: true, orgId: DEMO_ORG_ID }
  }
  if (session.role === 'developer') {
    const jar = await cookies()
    const orgId = jar.get('fmp-dev-org')?.value ?? DEFAULT_DEV_ORG
    return { filterByOrg: true, orgId }
  }
  return { filterByOrg: true, orgId: session.org_id ?? null }
}

// Appends an org WHERE clause using the user table alias provided.
// Returns the clause string and pushes the orgId param if needed.
export function appendOrgFilter(
  { filterByOrg, orgId }: OrgFilter,
  params: unknown[],
  alias = 'u'
): string {
  if (!filterByOrg) return ''
  if (orgId) {
    params.push(orgId)
    return ` AND ${alias}.org_id = $${params.length}`
  }
  return ` AND ${alias}.org_id IS NULL`
}
