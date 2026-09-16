import { query } from './db'

export function logApiError(route: string, error: unknown, userId?: string | null, method = 'GET') {
  query(`INSERT INTO api_errors (route, method, error, user_id) VALUES ($1, $2, $3, $4)`,
    [route, method, String(error).slice(0, 1000), userId ?? null]
  ).catch(() => {})
}
