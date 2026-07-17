import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

// Runs weekly — lightweight cleanup of old data
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // GPS breadcrumbs older than 90 days
    const gps = await query<{ cnt: number }>(
      `WITH deleted AS (DELETE FROM gps_breadcrumbs WHERE recorded_at < NOW() - INTERVAL '90 days' RETURNING 1)
       SELECT COUNT(*)::int as cnt FROM deleted`
    )

    // Notifications older than 30 days
    const notifs = await query<{ cnt: number }>(
      `WITH deleted AS (DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days' RETURNING 1)
       SELECT COUNT(*)::int as cnt FROM deleted`
    )

    // Run ANALYZE on cleaned tables if rows were deleted
    if (gps[0].cnt > 0) await query('ANALYZE gps_breadcrumbs').catch(() => {})
    if (notifs[0].cnt > 0) await query('ANALYZE notifications').catch(() => {})

    return NextResponse.json({
      ok: true,
      gps_deleted: gps[0].cnt,
      notifications_deleted: notifs[0].cnt,
    })
  } catch (err) {
    console.error('DB cleanup error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
