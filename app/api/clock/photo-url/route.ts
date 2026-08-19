import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getReceiptUploadUrl } from '@/lib/s3'

// Returns a pre-signed S3 upload URL for clock-in photos
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { contentType } = await req.json()
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  const key = `clock-in-photos/${session.id}/${Date.now()}.${ext}`
  const url = await getReceiptUploadUrl(key, contentType || 'image/jpeg')

  return NextResponse.json({ url, key })
}
