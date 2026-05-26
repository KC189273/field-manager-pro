import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { sendPushToHost, getApnsJwtForDiag } from '@/lib/apns'
import { query } from '@/lib/db'

async function testFcm(token: string): Promise<string> {
  try {
    const raw = process.env.FCM_SERVICE_ACCOUNT ?? ''
    if (!raw) return 'FCM_SERVICE_ACCOUNT not set'
    const sa = JSON.parse(raw)
    const { SignJWT, importPKCS8 } = await import('jose')
    const now = Math.floor(Date.now() / 1000)
    const privateKey = await importPKCS8(sa.private_key, 'RS256')
    const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', kid: sa.private_key_id })
      .setIssuer(sa.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    })
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string }
    if (!tokenData.access_token) return `oauth-error: ${JSON.stringify(tokenData)}`
    const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: 'Test', body: 'FCM test from Field Manager Pro' } } }),
    })
    if (fcmRes.ok) return 'ok'
    return `fcm-error ${fcmRes.status}: ${await fcmRes.text()}`
  } catch (e) {
    return 'exception: ' + String(e)
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { userId } = await req.json() as { userId: string }
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  const result = await query<{ count: string }>(
    `WITH deleted AS (DELETE FROM device_tokens WHERE user_id = $1 RETURNING id) SELECT COUNT(*) as count FROM deleted`,
    [userId]
  )
  return NextResponse.json({ deleted: result[0]?.count ?? '0' })
}

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const users = await query<{ id: string; full_name: string; role: string }>(
    `SELECT u.id, u.full_name, u.role
     FROM users u
     INNER JOIN device_tokens dt ON dt.user_id = u.id
     WHERE u.is_active = TRUE
     GROUP BY u.id, u.full_name, u.role
     ORDER BY u.full_name ASC`
  )
  return NextResponse.json({ users })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { userId?: string }
  const targetUserId = body.userId ?? session.id

  const bundleId = process.env.APNS_BUNDLE_ID ?? '(not set, defaulting to app.fieldmanagerpro)'
  const keyId = process.env.APNS_KEY_ID ?? ''
  const teamId = process.env.APNS_TEAM_ID ?? ''
  const privateKeyFirstLine = (process.env.APNS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').split('\n')[1]?.slice(0, 20) + '…'

  let deviceTokenCount = 0
  const results: { token: string; platform: string; production: string; sandbox: string }[] = []

  try {
    const tokens = await query<{ token: string; platform: string }>(
      `SELECT token, platform FROM device_tokens WHERE user_id = $1`,
      [targetUserId]
    )
    deviceTokenCount = tokens.length
    for (const { token, platform } of tokens) {
      if (platform === 'android') {
        const fcmResult = await testFcm(token)
        results.push({ token: token.slice(0, 16) + '…', platform, production: fcmResult, sandbox: 'n/a' })
      } else {
        let prodResult = 'untried'
        let sandResult = 'untried'
        const testData = { path: '/tasks' }
        try {
          await sendPushToHost('https://api.push.apple.com', { deviceToken: token, title: 'Deep Link Test', body: 'Tap to open Tasks', data: testData })
          prodResult = 'ok'
        } catch (e) { prodResult = String(e) }
        try {
          await sendPushToHost('https://api.sandbox.push.apple.com', { deviceToken: token, title: 'Deep Link Test', body: 'Tap to open Tasks', data: testData })
          sandResult = 'ok'
        } catch (e) { sandResult = String(e) }
        results.push({ token: token.slice(0, 16) + '…', platform, production: prodResult, sandbox: sandResult })
      }
    }
  } catch (e) {
    results.push({ token: 'db-query', platform: 'unknown', production: String(e), sandbox: '' })
  }

  return NextResponse.json({
    env: { keyId, teamId, bundleId, privateKeyFirstLine },
    jwt: await getApnsJwtForDiag(),
    deviceTokenCount,
    results,
  })
}
