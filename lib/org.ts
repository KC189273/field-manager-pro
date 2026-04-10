import { cookies } from 'next/headers'
import type { SessionPayload } from './auth'

export interface OrgFilter {
  filterByOrg: boolean
  orgId: string | null
}

export async function getOrgFilter(session: SessionPayload): Promise<OrgFilter> {
  if (session.role === 'developer') {
    const jar = await cookies()
    const orgId = jar.get('fmp-dev-org')?.value ?? null
    return { filterByOrg: orgId !== null, orgId }
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
