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

    // Run VACUUM ANALYZE on cleaned tables to reclaim dead rows
    if (gps[0].cnt > 0) await query('VACUUM ANALYZE gps_breadcrumbs').catch(() => {})
    if (notifs[0].cnt > 0) await query('VACUUM ANALYZE notifications').catch(() => {})

    // Proactive VACUUM on GPS even if no deletes (handles dead rows from updates)
    if (gps[0].cnt === 0) await query('VACUUM ANALYZE gps_breadcrumbs').catch(() => {})

    // Clean up clock-in photos for approved payroll periods
    // Delete photo keys from S3 and null out the column for shifts in approved periods
    let photosDeleted = 0
    try {
      const { deleteS3Object } = await import('@/lib/s3')
      const photoShifts = await query<{ id: string; clock_in_photo_key: string }>(`
        SELECT s.id, s.clock_in_photo_key FROM shifts s
        WHERE s.clock_in_photo_key IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM payroll_periods pp
            WHERE pp.status = 'approved'
              AND s.clock_in_at >= pp.period_start
              AND s.clock_in_at <= pp.period_end
          )
      `)
      for (const ps of photoShifts) {
        await deleteS3Object(ps.clock_in_photo_key).catch(() => {})
      }
      if (photoShifts.length > 0) {
        await query(`
          UPDATE shifts SET clock_in_photo_key = NULL
          WHERE id = ANY($1::uuid[])
        `, [photoShifts.map(p => p.id)])
        photosDeleted = photoShifts.length
      }
    } catch (err) {
      console.error('Photo cleanup error:', err)
    }

    // Stale device tokens not refreshed in 90 days
    const staleTokens = await query<{ cnt: number }>(
      `WITH deleted AS (DELETE FROM device_tokens WHERE updated_at < NOW() - INTERVAL '90 days' RETURNING 1)
       SELECT COUNT(*)::int as cnt FROM deleted`
    ).catch(() => [{ cnt: 0 }])

    // Expired store closures (past dates)
    const expiredClosures = await query<{ cnt: number }>(
      `WITH deleted AS (DELETE FROM store_closures WHERE closure_date < CURRENT_DATE RETURNING 1)
       SELECT COUNT(*)::int as cnt FROM deleted`
    ).catch(() => [{ cnt: 0 }])

    return NextResponse.json({
      ok: true,
      gps_deleted: gps[0].cnt,
      notifications_deleted: notifs[0].cnt,
      photos_deleted: photosDeleted,
      stale_tokens_deleted: staleTokens[0].cnt,
      expired_closures_deleted: expiredClosures[0].cnt,
    })
  } catch (err) {
    console.error('DB cleanup error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
