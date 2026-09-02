import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Include stretch DM flag for employees
  let isStretchDm = false
  if (session.role === 'employee') {
    const user = await queryOne<{ is_stretch_dm: boolean }>(`SELECT COALESCE(is_stretch_dm, FALSE) as is_stretch_dm FROM users WHERE id = $1`, [session.id]).catch(() => null)
    isStretchDm = user?.is_stretch_dm ?? false
  }

  return NextResponse.json({ ...session, isStretchDm })
}
