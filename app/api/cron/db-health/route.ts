import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

// Runs monthly — checks DB health, cleans up old data, reports issues
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const issues: string[] = []
  const actions: string[] = []
  const stats: Record<string, string | number> = {}

  try {
    // ── 1. Connection check ──────────────────────────────────────────────
    const conns = await query<{ active: number; max: string; running: number; idle: number }>(`
      SELECT count(*)::int as active,
             (SELECT setting FROM pg_settings WHERE name = 'max_connections') as max,
             count(*) FILTER (WHERE state = 'active')::int as running,
             count(*) FILTER (WHERE state = 'idle')::int as idle
      FROM pg_stat_activity
    `)
    const c = conns[0]
    stats['connections'] = `${c.active} active (${c.running} running, ${c.idle} idle) / ${c.max} max`
    if (c.active > Number(c.max) * 0.6) {
      issues.push(`High connection usage: ${c.active} of ${c.max} (${Math.round(c.active / Number(c.max) * 100)}%)`)
    }

    // ── 2. Database size ─────────────────────────────────────────────────
    const dbSize = await query<{ size: string }>(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`)
    stats['db_size'] = dbSize[0].size

    // ── 3. Table sizes ───────────────────────────────────────────────────
    const tables = await query<{ table_name: string; total_size: string; row_count: number }>(`
      SELECT relname as table_name,
             pg_size_pretty(pg_total_relation_size(relid)) as total_size,
             n_live_tup::int as row_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10
    `)
    stats['largest_table'] = `${tables[0]?.table_name} (${tables[0]?.total_size}, ${tables[0]?.row_count?.toLocaleString()} rows)`

    // ── 4. Cache hit ratio ───────────────────────────────────────────────
    const cache = await query<{ ratio: number }>(`
      SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2)::float as ratio
      FROM pg_stat_database WHERE datname = current_database()
    `)
    stats['cache_hit_ratio'] = `${cache[0].ratio}%`
    if (cache[0].ratio < 99) {
      issues.push(`Low cache hit ratio: ${cache[0].ratio}% (should be >99%)`)
    }

    // ── 5. Table bloat (dead rows) ───────────────────────────────────────
    const bloat = await query<{ table_name: string; dead_rows: number; live_rows: number }>(`
      SELECT relname as table_name, n_dead_tup::int as dead_rows, n_live_tup::int as live_rows
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 5000
      ORDER BY n_dead_tup DESC LIMIT 5
    `)
    if (bloat.length > 0) {
      for (const t of bloat) {
        issues.push(`Table ${t.table_name} has ${t.dead_rows.toLocaleString()} dead rows (${t.live_rows.toLocaleString()} live) — needs VACUUM`)
      }
    }

    // ── 6. Index health — verify key indexes are being used ──────────────
    const gpsIndexCheck = await query<{ query_plan: string }>(`
      EXPLAIN SELECT lat, lng, recorded_at FROM gps_breadcrumbs
      WHERE shift_id = '00000000-0000-0000-0000-000000000001'
      ORDER BY recorded_at DESC LIMIT 1
    `)
    const gpsUsesIndex = gpsIndexCheck.some(r => r.query_plan.includes('Index Scan'))
    if (!gpsUsesIndex) {
      issues.push('GPS breadcrumbs index NOT being used — queries will be slow. Run: CREATE INDEX idx_gps_bc_shift ON gps_breadcrumbs (shift_id, recorded_at DESC)')
    }

    // ── 7. Slow query patterns — check for seq scans on large tables ─────
    const seqScans = await query<{ table_name: string; seq_scans: number; idx_scans: number }>(`
      SELECT relname as table_name,
             seq_scan::int as seq_scans,
             COALESCE(idx_scan, 0)::int as idx_scans
      FROM pg_stat_user_tables
      WHERE seq_scan > 1000 AND n_live_tup > 10000
        AND (idx_scan IS NULL OR seq_scan > idx_scan * 2)
      ORDER BY seq_scan DESC LIMIT 5
    `)
    for (const t of seqScans) {
      issues.push(`Table ${t.table_name}: ${t.seq_scans.toLocaleString()} seq scans vs ${t.idx_scans.toLocaleString()} index scans — may need index`)
    }

    // ── 8. Cleanup old data ──────────────────────────────────────────────

    // GPS breadcrumbs older than 90 days
    const gpsDeleted = await query<{ id: string }>(
      `DELETE FROM gps_breadcrumbs WHERE recorded_at < NOW() - INTERVAL '90 days' RETURNING id`
    )
    if (gpsDeleted.length > 0) {
      actions.push(`Cleaned up ${gpsDeleted.length.toLocaleString()} GPS breadcrumbs older than 90 days`)
    }

    // Notifications older than 30 days
    const notifsDeleted = await query<{ id: string }>(
      `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days' RETURNING id`
    )
    if (notifsDeleted.length > 0) {
      actions.push(`Cleaned up ${notifsDeleted.length.toLocaleString()} notifications older than 30 days`)
    }

    // Run ANALYZE on cleaned tables
    if (gpsDeleted.length > 0) {
      await query('ANALYZE gps_breadcrumbs').catch(() => {})
      actions.push('Ran ANALYZE on gps_breadcrumbs')
    }
    if (notifsDeleted.length > 0) {
      await query('ANALYZE notifications').catch(() => {})
      actions.push('Ran ANALYZE on notifications')
    }

    // ── 9. Orphan check ──────────────────────────────────────────────────
    const orphanedEmps = await query<{ cnt: number }>(`
      SELECT COUNT(*)::int as cnt FROM users
      WHERE role = 'employee' AND is_active = TRUE AND manager_id IS NULL
    `)
    if (orphanedEmps[0].cnt > 0) {
      issues.push(`${orphanedEmps[0].cnt} active employees have no manager assigned`)
    }

    const unassignedStores = await query<{ cnt: number }>(`
      SELECT COUNT(*)::int as cnt FROM dm_store_locations sl
      WHERE sl.active = TRUE
        AND NOT EXISTS (SELECT 1 FROM dm_manager_stores ms WHERE ms.store_location_id = sl.id)
    `)
    if (unassignedStores[0].cnt > 0) {
      issues.push(`${unassignedStores[0].cnt} active stores have no DM assigned`)
    }

    // ── Build and send report ────────────────────────────────────────────
    const statusColor = issues.length === 0 ? '#16a34a' : issues.length <= 2 ? '#d97706' : '#dc2626'
    const statusLabel = issues.length === 0 ? 'HEALTHY' : issues.length <= 2 ? 'WARNINGS' : 'NEEDS ATTENTION'

    const tableRows = Object.entries(stats).map(([key, val]) =>
      `<tr><td style="padding:6px 10px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;font-size:13px">${key.replace(/_/g, ' ')}</td><td style="padding:6px 10px;color:#111827;border-bottom:1px solid #f3f4f6;font-size:13px">${val}</td></tr>`
    ).join('')

    const issuesList = issues.length > 0
      ? issues.map(i => `<li style="margin:4px 0;font-size:13px;color:#991b1b">${i}</li>`).join('')
      : '<li style="margin:4px 0;font-size:13px;color:#16a34a">No issues found</li>'

    const actionsList = actions.length > 0
      ? actions.map(a => `<li style="margin:4px 0;font-size:13px;color:#374151">${a}</li>`).join('')
      : '<li style="margin:4px 0;font-size:13px;color:#6b7280">No cleanup needed</li>'

    const topTables = tables.slice(0, 5).map(t =>
      `<tr><td style="padding:4px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6">${t.table_name}</td><td style="padding:4px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6">${t.total_size}</td><td style="padding:4px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6">${t.row_count?.toLocaleString()}</td></tr>`
    ).join('')

    const html = `<div style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#0f172a;padding:20px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:18px">Database Health Report</h1>
        <p style="color:#94a3b8;margin:4px 0 0;font-size:13px">Field Manager Pro — Monthly Check</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;background:white">
        <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;gap:8px">
          <span style="background:${statusColor};color:white;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:.5px">${statusLabel}</span>
          <span style="font-size:13px;color:#6b7280">${issues.length} issue${issues.length !== 1 ? 's' : ''} found</span>
        </div>
        <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6">
          <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">Overview</p>
          <table style="width:100%;border-collapse:collapse">${tableRows}</table>
        </div>
        <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6">
          <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">Largest Tables</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><th style="padding:4px 10px;font-size:11px;color:#9ca3af;text-align:left;border-bottom:1px solid #e5e7eb">Table</th><th style="padding:4px 10px;font-size:11px;color:#9ca3af;text-align:left;border-bottom:1px solid #e5e7eb">Size</th><th style="padding:4px 10px;font-size:11px;color:#9ca3af;text-align:left;border-bottom:1px solid #e5e7eb">Rows</th></tr>
            ${topTables}
          </table>
        </div>
        ${issues.length > 0 ? `<div style="padding:16px 20px;border-bottom:1px solid #f3f4f6;background:#fef2f2">
          <p style="font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">Issues</p>
          <ul style="margin:0;padding-left:20px">${issuesList}</ul>
        </div>` : ''}
        <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6">
          <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">Cleanup Actions</p>
          <ul style="margin:0;padding-left:20px">${actionsList}</ul>
        </div>
        <div style="padding:12px 20px;background:#f9fafb">
          <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center">Generated by Field Manager Pro</p>
        </div>
      </div>
    </div>`

    // Send to developer and owner (respecting notification preferences)
    const recipients = await query<{ email: string }>(`
      SELECT u.email FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.role IN ('developer', 'owner') AND u.is_active = TRUE
        AND COALESCE(np.db_health_report, TRUE) = TRUE
        AND COALESCE(np.email_enabled, TRUE) = TRUE
    `)
    if (recipients.length > 0) {
      await sendEmail(
        recipients.map(r => r.email),
        `DB Health Report — ${statusLabel} — ${issues.length} issue${issues.length !== 1 ? 's' : ''}`,
        html
      )
    }

    return NextResponse.json({
      ok: true,
      status: statusLabel,
      issues: issues.length,
      actions: actions.length,
      stats,
    })
  } catch (err) {
    console.error('DB health check error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
