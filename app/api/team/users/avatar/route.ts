import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { getReceiptUploadUrl, getReceiptViewUrl } from '@/lib/s3'
import { query, queryOne } from '@/lib/db'

const canUploadForOthers = (role: string) =>
  role === 'developer' || isOwner(role as never) || role === 'ops_manager'

// GET /api/team/users/avatar?view=true  → current user's avatar view URL
// GET /api/team/users/avatar?userId=xxx&ext=jpg  → signed S3 PUT URL + avatar key
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)

  if (searchParams.get('view') === 'true') {
    const row = await queryOne<{ avatar_key: string | null }>(`SELECT avatar_key FROM users WHERE id = $1`, [session.id])
    if (!row?.avatar_key) return NextResponse.json({ avatarUrl: null })
    const avatarUrl = await getReceiptViewUrl(row.avatar_key)
    return NextResponse.json({ avatarUrl })
  }

  const userId = searchParams.get('userId') ?? session.id
  const ext = (searchParams.get('ext') ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')

  if (userId !== session.id && !canUploadForOthers(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const avatarKey = `avatars/${userId}.${ext}`
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
  const uploadUrl = await getReceiptUploadUrl(avatarKey, contentType)

  return NextResponse.json({ uploadUrl, avatarKey })
}

// PATCH /api/team/users/avatar  → save avatar key after upload
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { avatarKey, userId } = await req.json()
  const targetId = userId ?? session.id

  if (targetId !== session.id && !canUploadForOthers(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await query(`UPDATE users SET avatar_key = $1 WHERE id = $2`, [avatarKey || null, targetId])
  return NextResponse.json({ ok: true })
}
