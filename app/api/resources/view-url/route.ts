import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getReceiptViewUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

// GET /api/resources/view-url?key=<s3_key>
// Returns a presigned view URL for a resource document
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  // Validate key is a resource key to prevent arbitrary S3 access
  if (!key.startsWith('resources/')) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  const url = await getReceiptViewUrl(key)
  return NextResponse.json({ url })
}
