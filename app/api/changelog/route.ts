import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only show changelog entries relevant to the user's role
  // affected_roles is NULL = visible to everyone, otherwise must include the user's role
  const entries = await query<{
    change_date: string; change_type: string; title: string; description: string | null
  }>(`
    SELECT change_date::text, change_type, title, description
    FROM app_changelog
    WHERE affected_roles IS NULL OR $1 = ANY(affected_roles)
    ORDER BY change_date DESC, created_at DESC
    LIMIT 20
  `, [session.role])

  return NextResponse.json({ entries })
}
