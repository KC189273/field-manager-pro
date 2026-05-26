import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      token TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'ios',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, token)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id)`)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch { /* already exists */ }

  const { token: rawToken, platform = 'ios' } = await req.json()
  if (!rawToken || typeof rawToken !== 'string') {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  // iOS/APNs: strip angle brackets, spaces, dashes and lowercase (hex token)
  // Android/FCM: keep token exactly as-is (case-sensitive base64url)
  const token = platform === 'android'
    ? rawToken.trim()
    : rawToken.replace(/[<>\s-]/g, '').toLowerCase()

  // Remove any stale tokens for this user+platform before inserting the fresh one.
  // This handles rotated FCM tokens and fixes previously-lowercased bad tokens.
  await query(
    `DELETE FROM device_tokens WHERE user_id = $1 AND platform = $2 AND token != $3`,
    [session.id, platform, token]
  )

  await query(
    `INSERT INTO device_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, token) DO UPDATE SET platform = $3, updated_at = NOW()`,
    [session.id, token, platform]
  )

  return NextResponse.json({ ok: true })
}
