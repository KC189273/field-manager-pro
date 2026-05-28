import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getReceiptUploadUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

const CAN_ACCESS = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

// POST /api/calendar/upload-url
// Returns presigned S3 upload URL for calendar event attachments
// Body: { filename, contentType }
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { filename, contentType } = await req.json()
  if (!filename || !contentType) {
    return NextResponse.json({ error: 'filename and contentType required' }, { status: 400 })
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin'
  const key = `calendar-attachments/${session.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const url = await getReceiptUploadUrl(key, contentType)

  return NextResponse.json({ url, key, filename })
}
