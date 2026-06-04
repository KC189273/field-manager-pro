import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getReceiptUploadUrl } from '@/lib/s3'
import { randomUUID } from 'crypto'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { contentType, fileName } = await req.json()

  const IMAGE_TYPES: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  }
  const FILE_TYPES: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/octet-stream': 'bin',
  }

  const isImage = !!IMAGE_TYPES[contentType]
  let ext = IMAGE_TYPES[contentType] ?? FILE_TYPES[contentType]

  // Fallback: derive extension from fileName if contentType is unknown/empty
  if (!ext && fileName) {
    const fileParts = String(fileName).split('.')
    const fileExt = fileParts.length > 1 ? fileParts.pop()!.toLowerCase() : ''
    const safeExts = ['pdf','doc','docx','xls','xlsx','txt','csv','png','jpg','jpeg','gif','webp','heic']
    if (safeExts.includes(fileExt)) ext = fileExt
  }

  if (!ext) return NextResponse.json({ error: 'File type not supported' }, { status: 400 })

  const key = `chat/${randomUUID()}.${ext}`

  // For images: sign with ContentType so S3 stores it correctly for browser rendering.
  // For files: omit ContentType from the presigned URL — avoids CORS preflight issues
  // with document MIME types that some S3 CORS configs may not allow.
  const url = isImage
    ? await getReceiptUploadUrl(key, contentType)
    : await getReceiptUploadUrl(key)

  return NextResponse.json({ url, key, isImage })
}
