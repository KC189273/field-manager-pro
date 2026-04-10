import { NextRequest, NextResponse } from 'next/server'
import { getSession, canSubmitExpense } from '@/lib/auth'
import { getReceiptUploadUrl } from '@/lib/s3'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canSubmitExpense(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { filename, contentType } = await req.json()
  if (!filename || !contentType) {
    return NextResponse.json({ error: 'Missing filename or contentType' }, { status: 400 })
  }

  const ext = filename.split('.').pop() ?? 'jpg'
  const key = `receipts/${session.id}/${Date.now()}.${ext}`
  const url = await getReceiptUploadUrl(key, contentType)

  return NextResponse.json({ url, key })
}
