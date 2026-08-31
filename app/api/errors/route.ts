import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const errors = await query<{
    id: string; route: string; method: string; error: string
    user_id: string | null; created_at: string
  }>(`
    SELECT id, route, method, error, user_id, created_at::text
    FROM api_errors
    ORDER BY created_at DESC
    LIMIT 50
  `)

  const stats = await query<{ route: string; count: number; latest: string }>(`
    SELECT route, COUNT(*)::int as count, MAX(created_at)::text as latest
    FROM api_errors
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY route
    ORDER BY count DESC
    LIMIT 20
  `)

  return NextResponse.json({ errors, stats })
}
