import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { getReceiptUploadUrl } from '@/lib/s3'

// GET /api/team/users/avatar?userId=xxx&ext=jpg  → signed S3 PUT URL + avatar key
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId') ?? session.id
  const ext = (searchParams.get('ext') ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')

  // Only allow self-upload or elevated roles
  const canUploadForOthers =
    session.role === 'developer' ||
    isOwner(session.role) ||
    session.role === 'ops_manager'

  if (userId !== session.id && !canUploadForOthers) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const avatarKey = `avatars/${userId}.${ext}`
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
  const uploadUrl = await getReceiptUploadUrl(avatarKey, contentType)

  return NextResponse.json({ uploadUrl, avatarKey })
}
