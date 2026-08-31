import { query } from '@/lib/db'

/** Log an API error to the database. Fire-and-forget, never throws. */
export function logApiError(route: string, error: unknown, method = 'GET', userId?: string) {
  const msg = error instanceof Error ? error.message : String(error)
  query(
    `INSERT INTO api_errors (route, method, error, user_id) VALUES ($1, $2, $3, $4)`,
    [route, method, msg.slice(0, 2000), userId || null]
  ).catch(() => {})
}
