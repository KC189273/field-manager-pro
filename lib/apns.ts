/**
 * Apple Push Notification service (APNs) — token-based auth via HTTP/2.
 *
 * Required env vars:
 *   APNS_KEY_ID      — 10-char key ID from Apple Developer portal
 *   APNS_TEAM_ID     — 10-char team ID from Apple Developer portal
 *   APNS_PRIVATE_KEY — contents of the .p8 file (newlines as \n in env)
 *   APNS_BUNDLE_ID   — app bundle ID (defaults to app.fieldmanagerpro)
 */

import http2 from 'http2'
import { SignJWT, importPKCS8 } from 'jose'
import { query } from '@/lib/db'

// Cache the JWT for up to 50 minutes (tokens expire after 60)
let cachedJwt: { value: string; expiresAt: number } | null = null

async function getApnsJwt(): Promise<string> {
  if (cachedJwt && cachedJwt.expiresAt > Date.now()) return cachedJwt.value

  const pem = (process.env.APNS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  const keyId = process.env.APNS_KEY_ID ?? ''
  const teamId = process.env.APNS_TEAM_ID ?? ''

  const privateKey = await importPKCS8(pem, 'ES256')
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(teamId)
    .sign(privateKey)

  cachedJwt = { value: token, expiresAt: Date.now() + 50 * 60 * 1000 }
  return token
}

/**
 * Send a push notification to a single device token.
 * Throws on APNs error; callers should catch or use sendPushToUser which uses allSettled.
 */
export async function sendPush(params: {
  deviceToken: string
  title: string
  body: string
  data?: Record<string, string>
}): Promise<void> {
  const { deviceToken, title, body, data } = params
  const bundleId = process.env.APNS_BUNDLE_ID ?? 'app.fieldmanagerpro'
  const apnsJwt = await getApnsJwt()

  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: 'default' },
    ...(data ?? {}),
  })

  await new Promise<void>((resolve, reject) => {
    const client = http2.connect('https://api.push.apple.com')
    client.on('error', reject)

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${apnsJwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload)),
    })

    let status = 0
    let responseBody = ''
    req.setEncoding('utf8')
    req.on('response', (headers) => { status = headers[':status'] as number })
    req.on('data', (chunk) => { responseBody += chunk })
    req.on('end', () => {
      client.close()
      if (status === 200) resolve()
      else reject(new Error(`APNs ${status}: ${responseBody}`))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/**
 * Send a push notification to all registered devices for a user.
 * Non-fatal — silently ignores individual device failures.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (!process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_PRIVATE_KEY) return

  try {
    const tokens = await query<{ token: string }>(
      `SELECT token FROM device_tokens WHERE user_id = $1`,
      [userId]
    )
    await Promise.allSettled(tokens.map(row => sendPush({ deviceToken: row.token, title, body, data })))
  } catch (e) {
    console.error('sendPushToUser error:', e)
  }
}
