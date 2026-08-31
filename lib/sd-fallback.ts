import { query } from '@/lib/db'

/**
 * Gets the active Sales Director(s) for an org.
 * If no active SD exists, falls back to all active owners + ops_managers.
 * Use this everywhere notifications/approvals would go to the SD role.
 */
export async function getSDOrFallback(orgId: string | null | undefined): Promise<Array<{ id: string; email: string; full_name: string; role: string }>> {
  if (!orgId) return []

  // Try active sales directors first
  const sds = await query<{ id: string; email: string; full_name: string; role: string }>(`
    SELECT id, email, full_name, role FROM users
    WHERE org_id = $1 AND role = 'sales_director' AND is_active = TRUE
  `, [orgId])

  if (sds.length > 0) return sds

  // Fallback: all active owners + ops_managers + field leaders
  return query<{ id: string; email: string; full_name: string; role: string }>(`
    SELECT id, email, full_name, role FROM users
    WHERE org_id = $1 AND role IN ('owner', 'ops_manager', 'ops_field_leader') AND is_active = TRUE
      AND (is_hidden = FALSE OR is_hidden IS NULL)
  `, [orgId])
}
