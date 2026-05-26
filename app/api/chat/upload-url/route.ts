import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getReceiptUploadUrl } from '@/lib/s3'
import { randomUUID } from 'crypto'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { contentType } = await req.json()
  if (!contentType?.startsWith('image/')) {
    return NextResponse.json({ error: 'Only images allowed' }, { status: 400 })
  }

  const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const key = `chat/${randomUUID()}.${ext}`
  const url = await getReceiptUploadUrl(key, contentType)

  return NextResponse.json({ url, key })
}
