import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getReceiptUploadUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

const CAN_MANAGE = ['owner', 'ops_manager', 'developer', 'sales_director']

// POST /api/resources/upload-url
// Returns presigned S3 upload URL for resource documents
// Body: { filename, contentType }
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_MANAGE.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { filename, contentType } = await req.json()
  if (!filename || !contentType) {
    return NextResponse.json({ error: 'filename and contentType required' }, { status: 400 })
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin'
  const key = `resources/${session.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const url = await getReceiptUploadUrl(key, contentType)

  return NextResponse.json({ url, key, filename })
}
