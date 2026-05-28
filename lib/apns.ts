/**
 * Push notification dispatch — APNs (iOS) and FCM (Android).
 *
 * Required env vars:
 *   APNS_KEY_ID         — 10-char key ID from Apple Developer portal
 *   APNS_TEAM_ID        — 10-char team ID from Apple Developer portal
 *   APNS_PRIVATE_KEY    — contents of the .p8 file (newlines as \n in env)
 *   APNS_BUNDLE_ID      — app bundle ID (defaults to app.fieldmanagerpro)
 *   FCM_SERVICE_ACCOUNT — Firebase service account JSON (for Android)
 */

import http2 from 'http2'
import { SignJWT, importPKCS8 } from 'jose'
import { query, queryOne } from '@/lib/db'

// ── FCM ──────────────────────────────────────────────────────────────────────

let fcmAccessToken: { value: string; expiresAt: number } | null = null

async function getFcmAccessToken(): Promise<string> {
  if (fcmAccessToken && fcmAccessToken.expiresAt > Date.now()) return fcmAccessToken.value

  const raw = process.env.FCM_SERVICE_ACCOUNT ?? ''
  if (!raw) throw new Error('FCM_SERVICE_ACCOUNT not set')
  const sa = JSON.parse(raw)

  // Build a JWT for Google OAuth2
  const now = Math.floor(Date.now() / 1000)
  const privateKey = await importPKCS8(sa.private_key, 'RS256')
  const jwt = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256', kid: sa.private_key_id })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = await res.json() as { access_token: string; expires_in: number }
  fcmAccessToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return fcmAccessToken.value
}

async function sendFcm(params: { deviceToken: string; title: string; body: string; data?: Record<string, string> }): Promise<void> {
  const { deviceToken, title, body, data } = params
  const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT ?? '{}')
  const projectId = sa.project_id
  if (!projectId) throw new Error('FCM project_id missing')

  const accessToken = await getFcmAccessToken()
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title, body },
        ...(data ? { data } : {}),
      },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`FCM ${res.status}: ${err}`)
  }
}

// Cache the JWT for up to 50 minutes (tokens expire after 60)
let cachedJwt: { value: string; expiresAt: number } | null = null

// Maps notification types to their deep-link paths in the app
const NOTIFICATION_PATHS: Record<string, string> = {
  chat_message: '/chat',
  task_assigned: '/tasks',
  task_completed: '/tasks',
  checklist_submitted: '/checklist',
  flag_created: '/flags',
  expense_submitted: '/expenses',
  schedule_published: '/my-schedule',
  time_off_request: '/time-off',
  facility_request: '/facilities',
  facility_update: '/facilities',
  accountability: '/accountability',
  shift_swap: '/shift-swaps',
  supply_request: '/supply-requests',
  merch_order: '/merch-orders',
  payroll: '/payroll',
  clock: '/clock',
  calendar_event: '/calendar',
  calendar_invite: '/calendar',
  calendar_rsvp: '/calendar',
}

// Valid notification preference column names — guards against dynamic SQL injection
const VALID_PREF_TYPES = new Set([
  'task_assigned',
  'task_completed',
  'checklist_submitted',
  'flag_created',
  'expense_submitted',
  'schedule_published',
  'time_off_request',
])

export async function getApnsJwtForDiag(): Promise<{ jwt: string; header: object; payload: object } | { error: string }> {
  try {
    const jwt = await getApnsJwt()
    const [headerB64, payloadB64] = jwt.split('.')
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    return { jwt: jwt.slice(0, 20) + '…', header, payload }
  } catch (e) {
    return { error: String(e) }
  }
}

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
export async function sendPushToHost(host: string, params: {
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
    const client = http2.connect(host)
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
 * Send a push notification to a single device token.
 * Auto-retries with sandbox endpoint if token is a development token.
 * Throws on APNs error; callers should catch or use sendPushToUser which uses allSettled.
 */
export async function sendPush(params: {
  deviceToken: string
  title: string
  body: string
  data?: Record<string, string>
}): Promise<void> {
  try {
    await sendPushToHost('https://api.push.apple.com', params)
  } catch (e) {
    if (String(e).includes('BadEnvironmentKeyInToken')) {
      await sendPushToHost('https://api.sandbox.push.apple.com', params)
    } else {
      throw e
    }
  }
}

/**
 * Check if a user has email notifications globally enabled.
 * Defaults to true if they have no preference row.
 */
export async function isEmailEnabled(userId: string): Promise<boolean> {
  try {
    const row = await queryOne<{ email_enabled: boolean }>(
      `SELECT email_enabled FROM notification_preferences WHERE user_id = $1`,
      [userId]
    )
    return row?.email_enabled !== false
  } catch {
    return true // default to enabled if prefs table/column not yet migrated
  }
}

/**
 * Check if a user has a notification type enabled in their preferences.
 * Also checks the global push_enabled toggle.
 * Defaults to true if they have no preference row (opted in by default).
 */
async function isPrefEnabled(userId: string, notificationType: string): Promise<boolean> {
  try {
    const cols = ['push_enabled', ...(VALID_PREF_TYPES.has(notificationType) ? [notificationType] : [])]
    const rows = await query<Record<string, boolean>>(
      `SELECT ${cols.join(', ')} FROM notification_preferences WHERE user_id = $1`,
      [userId]
    )
    if (!rows.length) return true // no row = defaults on
    if (rows[0].push_enabled === false) return false // global push disabled
    if (!VALID_PREF_TYPES.has(notificationType)) return true
    return rows[0][notificationType] !== false
  } catch {
    return true // default to enabled if prefs table/column not yet migrated
  }
}

/**
 * Send a push notification to all registered devices for a user.
 * Respects notification preferences. Non-fatal — silently ignores failures.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  notificationType?: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    if (notificationType && !(await isPrefEnabled(userId, notificationType))) return

    const path = notificationType ? NOTIFICATION_PATHS[notificationType] : undefined
    const mergedData = path ? { path, ...(data ?? {}) } : (data ?? undefined)

    const tokens = await query<{ token: string; platform: string }>(
      `SELECT token, platform FROM device_tokens WHERE user_id = $1`,
      [userId]
    )
    await Promise.allSettled(tokens.map(row => {
      if (row.platform === 'android') {
        if (!process.env.FCM_SERVICE_ACCOUNT) return Promise.resolve()
        return sendFcm({ deviceToken: row.token, title, body, data: mergedData })
      } else {
        if (!process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_PRIVATE_KEY) return Promise.resolve()
        return sendPush({ deviceToken: row.token, title, body, data: mergedData })
      }
    }))

    // Log to in-app notification inbox — fire-and-forget, non-fatal
    query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, $4)`,
      [userId, title, body, notificationType ?? null]
    ).catch(() => {})
  } catch (e) {
    console.error('sendPushToUser error:', e)
  }
}

/**
 * Send a push notification to multiple users. Non-fatal.
 */
export async function sendPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  notificationType?: string,
  data?: Record<string, string>
): Promise<void> {
  await Promise.allSettled(
    userIds.map(id => sendPushToUser(id, title, body, notificationType, data))
  )
}
