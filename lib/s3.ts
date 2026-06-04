import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

const BUCKET = process.env.S3_BUCKET!

export async function getReceiptUploadUrl(key: string, contentType?: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    ...(contentType ? { ContentType: contentType } : {}),
  })
  return getSignedUrl(s3, cmd, { expiresIn: 300 })
}

export async function getReceiptViewUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(s3, cmd, { expiresIn: 3600 })
}

/** Download an S3 object and return its contents as a Buffer. Returns null on failure. */
export async function getS3ObjectBuffer(key: string): Promise<Buffer | null> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!response.Body) return null
    const chunks: Uint8Array[] = []
    for await (const chunk of (response.Body as Readable)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  } catch {
    return null
  }
}
