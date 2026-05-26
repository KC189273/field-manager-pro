import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getReceiptViewUrl } from '@/lib/s3'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  // Only serve keys from the merch-photos prefix
  if (!key.startsWith('merch-photos/'))
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })

  const url = await getReceiptViewUrl(key)
  return NextResponse.json({ url })
}
