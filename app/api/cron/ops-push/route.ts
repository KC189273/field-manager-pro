import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUsers } from '@/lib/apns'

// Runs 3x daily (noon, 3pm, 8pm CST) — sends developer a push notification with health status
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Quick health checks
    const conns = await query<{ active: number; max: number; running: number }>(`
      SELECT count(*)::int as active,
             (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max,
             count(*) FILTER (WHERE state = 'active')::int as running
      FROM pg_stat_activity
    `)

    const cache = await query<{ ratio: number }>(`
      SELECT COALESCE(round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2), 100)::float as ratio
      FROM pg_stat_database WHERE datname = current_database()
    `)

    const heavyQueries = await query<{ cnt: number }>(`
      SELECT count(*)::int as cnt FROM pg_stat_activity
      WHERE state = 'active' AND pid != pg_backend_pid()
    `)

    // Check for problems
    const orphaned = await query<{ cnt: number }>(`
      SELECT COUNT(*)::int as cnt FROM users
      WHERE role = 'employee' AND is_active = TRUE AND manager_id IS NULL
    `)

    const bloat = await query<{ cnt: number }>(`
      SELECT COUNT(*)::int as cnt FROM pg_stat_user_tables WHERE n_dead_tup > 10000
    `)

    // Build status
    const warnings: string[] = []
    const connPct = Math.round((conns[0].active / conns[0].max) * 100)
    if (connPct > 70) warnings.push(`Connections ${connPct}%`)
    if (cache[0].ratio < 99) warnings.push(`Cache ${cache[0].ratio}%`)
    if (orphaned[0].cnt > 0) warnings.push(`${orphaned[0].cnt} orphaned employees`)
    if (bloat[0].cnt > 0) warnings.push(`${bloat[0].cnt} bloated tables`)
    if (heavyQueries[0].cnt > 10) warnings.push(`${heavyQueries[0].cnt} active queries`)

    const healthy = warnings.length === 0
    const emoji = healthy ? '✅' : warnings.length <= 2 ? '⚠️' : '🔴'
    const title = `${emoji} FMP Health Check`
    const body = healthy
      ? `All clear — ${conns[0].active} conn, ${heavyQueries[0].cnt} active queries, ${cache[0].ratio}% cache`
      : `${warnings.length} issue${warnings.length !== 1 ? 's' : ''}: ${warnings.join(', ')}`

    // Send push to all developers
    const devs = await query<{ id: string }>(`
      SELECT u.id FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.role = 'developer' AND u.is_active = TRUE
        AND COALESCE(np.ops_alerts, TRUE) = TRUE
        AND COALESCE(np.push_enabled, TRUE) = TRUE
    `)
    if (devs.length > 0) {
      await sendPushToUsers(
        devs.map(d => d.id),
        title,
        body,
        'gps_alert', // reuse this type so it deep-links to a relevant page
        { path: '/db-health' }
      )
    }

    return NextResponse.json({ ok: true, healthy, warnings, body })
  } catch (err) {
    console.error('Ops push error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
