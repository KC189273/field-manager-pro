import { NextRequest, NextResponse } from 'next/server'

// Weekly demo reset — runs Sunday night 11 PM CST
// Calls the seed endpoint to regenerate all demo data
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

    // Notify active prospects that demo is resetting
    const { query } = await import('@/lib/db')
    const { sendPushToUsers } = await import('@/lib/apns')

    const prospects = await query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'prospect' AND is_active = TRUE`
    ).catch(() => [])

    if (prospects.length) {
      sendPushToUsers(
        prospects.map(p => p.id),
        'Demo Reset',
        'The demo environment is being refreshed with fresh sample data. Your session will continue with the new data.',
        'system'
      ).catch(() => {})
    }

    // Clean up old prospect accounts (older than 7 days)
    await query(
      `UPDATE users SET is_active = FALSE WHERE role = 'prospect' AND created_at < NOW() - INTERVAL '7 days'`
    ).catch(() => {})

    // Call the seed endpoint
    const res = await fetch(`${APP_URL}/api/demo/seed`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
    })
    const data = await res.json()

    if (!res.ok) {
      console.error('Demo reset seed failed:', data)
      return NextResponse.json({ error: 'Seed failed', detail: data }, { status: 500 })
    }

    // Notify developer
    const devs = await query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'developer' AND is_active = TRUE`
    ).catch(() => [])

    if (devs.length) {
      sendPushToUsers(
        devs.map(d => d.id),
        'Demo Reset Complete',
        `Demo data refreshed: ${data.counts?.users ?? 0} users, ${data.counts?.shifts ?? 0} shifts, ${data.counts?.breadcrumbs ?? 0} GPS points`,
        'system'
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, seed: data })
  } catch (err) {
    console.error('Demo reset error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
