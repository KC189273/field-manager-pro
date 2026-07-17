import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'

/**
 * Verifies the current user is the super admin.
 * Returns the session if authorized, null otherwise.
 * Uses email match against SUPER_ADMIN_EMAIL env var.
 */
export async function verifySuperAdmin(): Promise<{ id: string; email: string } | null> {
  const superEmail = process.env.SUPER_ADMIN_EMAIL
  if (!superEmail) return null

  const session = await getSession()
  if (!session) return null

  // Get fresh email from DB (session email can be stale)
  const user = await queryOne<{ email: string }>(
    `SELECT email FROM users WHERE id = $1 AND is_active = TRUE`,
    [session.id]
  )
  if (!user) return null

  if (user.email.toLowerCase() !== superEmail.toLowerCase()) return null

  return { id: session.id, email: user.email }
}
