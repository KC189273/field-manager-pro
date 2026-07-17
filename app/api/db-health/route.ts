import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS db_health_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active_connections INT,
      max_connections INT,
      db_size_bytes BIGINT,
      cache_hit_ratio NUMERIC(5,2),
      gps_rows INT,
      gps_size_bytes BIGINT,
      notifications_rows INT,
      shifts_rows INT,
      checklist_rows INT,
      flags_rows INT,
      tasks_rows INT,
      total_users INT,
      active_users INT,
      issues_count INT,
      issues JSONB,
      cleanup_gps INT DEFAULT 0,
      cleanup_notifications INT DEFAULT 0
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_health_snapshots_time ON db_health_snapshots(snapshot_at DESC)`)
}

// GET — returns current health + historical snapshots
export async function GET() {
  const session = await getSession()
  if (!session || !['developer', 'owner', 'ops_manager', 'sales_director'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  // ── Live data ──────────────────────────────────────────────────────────
  const conns = await query<{ active: number; max: number; running: number; idle: number }>(`
    SELECT count(*)::int as active,
           (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max,
           count(*) FILTER (WHERE state = 'active')::int as running,
           count(*) FILTER (WHERE state = 'idle')::int as idle
    FROM pg_stat_activity
  `)

  const dbSize = await query<{ bytes: string; pretty: string }>(`
    SELECT pg_database_size(current_database())::text as bytes,
           pg_size_pretty(pg_database_size(current_database())) as pretty
  `)

  const cache = await query<{ ratio: number }>(`
    SELECT COALESCE(round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2), 100)::float as ratio
    FROM pg_stat_database WHERE datname = current_database()
  `)

  const tables = await query<{ table_name: string; total_size: string; size_bytes: string; row_count: number; dead_rows: number; seq_scans: number; idx_scans: number }>(`
    SELECT relname as table_name,
           pg_size_pretty(pg_total_relation_size(relid)) as total_size,
           pg_total_relation_size(relid)::text as size_bytes,
           n_live_tup::int as row_count,
           n_dead_tup::int as dead_rows,
           seq_scan::int as seq_scans,
           COALESCE(idx_scan, 0)::int as idx_scans
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 15
  `)

  const indexes = await query<{ table_name: string; index_name: string; size: string; scans: number }>(`
    SELECT t.relname as table_name, i.relname as index_name,
           pg_size_pretty(pg_relation_size(i.oid)) as size,
           COALESCE(s.idx_scan, 0)::int as scans
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
    WHERE t.relkind = 'r' AND t.relname NOT LIKE 'pg_%'
    ORDER BY pg_relation_size(i.oid) DESC
    LIMIT 15
  `)

  const activeQueries = await query<{ query: string; count: number }>(`
    SELECT LEFT(query, 100) as query, count(*)::int as count
    FROM pg_stat_activity
    WHERE state = 'active' AND pid != pg_backend_pid()
    GROUP BY LEFT(query, 100)
    ORDER BY count DESC LIMIT 10
  `)

  const userStats = await query<{ total: number; active: number; managers: number; employees: number }>(`
    SELECT COUNT(*)::int as total,
           COUNT(*) FILTER (WHERE is_active = TRUE)::int as active,
           COUNT(*) FILTER (WHERE role = 'manager' AND is_active = TRUE)::int as managers,
           COUNT(*) FILTER (WHERE role = 'employee' AND is_active = TRUE)::int as employees
    FROM users
  `)

  // ── Issues detection ───────────────────────────────────────────────────
  const issues: string[] = []
  if (conns[0].active > conns[0].max * 0.6) issues.push(`High connections: ${conns[0].active}/${conns[0].max}`)
  if (cache[0].ratio < 99) issues.push(`Low cache hit: ${cache[0].ratio}%`)
  for (const t of tables) {
    if (t.dead_rows > 5000) issues.push(`${t.table_name}: ${t.dead_rows.toLocaleString()} dead rows`)
  }

  // ── Action items (smart suggestions) ──────────────────────────────────
  type ActionItem = { severity: 'critical' | 'warning' | 'info'; title: string; detail: string; action: string }
  const actionItems: ActionItem[] = []

  // Connection health
  const connPct = Math.round((conns[0].active / conns[0].max) * 100)
  if (connPct > 80) {
    actionItems.push({ severity: 'critical', title: 'Connection pool near capacity', detail: `${conns[0].active} of ${conns[0].max} connections in use (${connPct}%). App may start failing requests.`, action: 'Upgrade Supabase compute or reduce connection pool size in lib/db.ts.' })
  } else if (connPct > 60) {
    actionItems.push({ severity: 'warning', title: 'Connection usage elevated', detail: `${conns[0].active} of ${conns[0].max} connections (${connPct}%).`, action: 'Monitor — if this stays above 60% during business hours, consider upgrading compute.' })
  }

  // Cache hit ratio
  if (cache[0].ratio < 95) {
    actionItems.push({ severity: 'critical', title: 'Low cache hit ratio', detail: `${cache[0].ratio}% — database is reading from disk too often.`, action: 'Upgrade Supabase to get more RAM, or reduce table sizes by cleaning old data.' })
  } else if (cache[0].ratio < 99) {
    actionItems.push({ severity: 'warning', title: 'Cache hit ratio below optimal', detail: `${cache[0].ratio}% (target: >99%).`, action: 'Monitor — may need more RAM if this drops further.' })
  }

  // Table bloat
  for (const t of tables) {
    if (t.dead_rows > 10000) {
      actionItems.push({ severity: 'warning', title: `Table bloat: ${t.table_name}`, detail: `${t.dead_rows.toLocaleString()} dead rows taking up space.`, action: 'Run VACUUM on this table in the Supabase SQL editor.' })
    }
  }

  // Seq scan heavy tables — check active queries for seq scans instead of cumulative counters
  // (cumulative counters can't be reset on Supabase and include historical data from before index fixes)
  const currentSeqScans = await query<{ table_name: string; cnt: number }>(`
    SELECT LEFT(query, 60) as q, count(*)::int as cnt
    FROM pg_stat_activity
    WHERE state = 'active' AND query ILIKE '%Seq Scan%'
    GROUP BY LEFT(query, 60)
    HAVING count(*) > 3
  `).catch(() => [] as Array<{ table_name: string; cnt: number }>)
  if (currentSeqScans.length > 0) {
    actionItems.push({ severity: 'warning', title: 'Active sequential scans detected', detail: `${currentSeqScans.length} query patterns doing full table scans right now.`, action: 'Check the Active Queries section above for details. May need index optimization.' })
  }

  // Also check if key indexes exist
  const gpsIdx = await query<{ cnt: number }>(`
    SELECT COUNT(*)::int as cnt FROM pg_indexes
    WHERE tablename = 'gps_breadcrumbs' AND indexname != 'gps_breadcrumbs_pkey'
  `)
  if (gpsIdx[0].cnt === 0) {
    actionItems.push({ severity: 'critical', title: 'Missing index: gps_breadcrumbs', detail: 'No custom indexes on the GPS table. Every GPS ping does a full table scan.', action: 'Run: CREATE INDEX idx_gps_bc_shift ON gps_breadcrumbs (shift_id, recorded_at DESC)' })
  }

  const shiftsIdx = await query<{ cnt: number }>(`
    SELECT COUNT(*)::int as cnt FROM pg_indexes
    WHERE tablename = 'shifts' AND indexname != 'shifts_pkey'
  `)
  if (shiftsIdx[0].cnt === 0) {
    actionItems.push({ severity: 'warning', title: 'Missing index: shifts', detail: 'No custom indexes on shifts table. Timecard and payroll queries may be slow.', action: 'Run: CREATE INDEX idx_shifts_user_clockin ON shifts (user_id, clock_in_at DESC)' })
  }

  // GPS table growth
  const gpsTableData = tables.find(t => t.table_name === 'gps_breadcrumbs')
  if (gpsTableData && gpsTableData.row_count > 1500000) {
    actionItems.push({ severity: 'warning', title: 'GPS table growing large', detail: `${gpsTableData.row_count.toLocaleString()} rows (${gpsTableData.total_size}). Weekly cleanup runs Sundays.`, action: 'No action needed — cleanup cron handles this. If growth accelerates, consider reducing GPS ping frequency.' })
  } else if (gpsTableData) {
    actionItems.push({ severity: 'info', title: 'GPS table healthy', detail: `${gpsTableData.row_count.toLocaleString()} rows (${gpsTableData.total_size}). Auto-cleanup removes data older than 90 days.`, action: 'No action needed.' })
  }

  // Orphaned employees
  const orphanedEmps = await query<{ cnt: number }>(`
    SELECT COUNT(*)::int as cnt FROM users
    WHERE role = 'employee' AND is_active = TRUE AND manager_id IS NULL
  `)
  if (orphanedEmps[0].cnt > 0) {
    actionItems.push({ severity: 'warning', title: `${orphanedEmps[0].cnt} employees without a manager`, detail: 'These employees won\'t appear in any DM\'s team, schedules, or timecards.', action: 'Go to Team → edit each employee and assign a manager.' })
  }

  // Unassigned stores
  const unassignedStores = await query<{ cnt: number; addresses: string }>(`
    SELECT COUNT(*)::int as cnt,
           STRING_AGG(sl.address, ', ' ORDER BY sl.address) as addresses
    FROM dm_store_locations sl
    WHERE sl.active = TRUE
      AND NOT EXISTS (SELECT 1 FROM dm_manager_stores ms WHERE ms.store_location_id = sl.id)
  `)
  if (unassignedStores[0].cnt > 0) {
    actionItems.push({ severity: 'warning', title: `${unassignedStores[0].cnt} stores without a DM`, detail: `${unassignedStores[0].addresses}`, action: 'Go to DM Store Visit → Manage Stores → Assign Stores to DM.' })
  }

  // DMs with 0 employees (might need deactivation)
  const emptyDms = await query<{ full_name: string }>(`
    SELECT u.full_name FROM users u
    WHERE u.role = 'manager' AND u.is_active = TRUE
      AND NOT EXISTS (SELECT 1 FROM users e WHERE e.manager_id = u.id AND e.is_active = TRUE)
      AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)
  `)
  for (const dm of emptyDms) {
    actionItems.push({ severity: 'info', title: `DM ${dm.full_name} has no active employees`, detail: 'This DM has no team assigned. They may need employees transferred or their account deactivated.', action: 'Check if this DM needs employees assigned or should be deactivated on the Team page.' })
  }

  // Active queries right now
  if (activeQueries.some(q => q.count > 5)) {
    const heavy = activeQueries.filter(q => q.count > 5)
    actionItems.push({ severity: 'warning', title: 'Heavy concurrent queries detected', detail: `${heavy.map(q => `${q.count}x: ${q.query.substring(0, 60)}`).join('; ')}`, action: 'If this persists, the query may need optimization or caching.' })
  }

  // DB size check
  const dbSizeBytes = Number(dbSize[0].bytes)
  if (dbSizeBytes > 450_000_000) {
    actionItems.push({ severity: 'warning', title: 'Database approaching 500MB', detail: `Current size: ${dbSize[0].pretty}. Supabase free tier limit is 500MB.`, action: 'Ensure cleanup crons are running. Consider upgrading if growth continues.' })
  }

  // All good!
  if (actionItems.filter(a => a.severity !== 'info').length === 0) {
    actionItems.push({ severity: 'info', title: 'Everything looks good', detail: 'No critical or warning items. Database is healthy and performing well.', action: 'No action needed. Check back next week.' })
  }

  // ── Save snapshot ──────────────────────────────────────────────────────
  const gpsTable = tables.find(t => t.table_name === 'gps_breadcrumbs')
  const notifsTable = tables.find(t => t.table_name === 'notifications')
  const shiftsTable = tables.find(t => t.table_name === 'shifts')
  const checklistTable = tables.find(t => t.table_name === 'checklist_submissions')
  const flagsTable = tables.find(t => t.table_name === 'flags')
  const tasksTable = tables.find(t => t.table_name === 'tasks')

  await query(`
    INSERT INTO db_health_snapshots (
      active_connections, max_connections, db_size_bytes, cache_hit_ratio,
      gps_rows, gps_size_bytes, notifications_rows, shifts_rows, checklist_rows, flags_rows, tasks_rows,
      total_users, active_users, issues_count, issues
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [
    conns[0].active, conns[0].max, BigInt(dbSize[0].bytes), cache[0].ratio,
    gpsTable?.row_count ?? 0, BigInt(gpsTable?.size_bytes ?? '0'),
    notifsTable?.row_count ?? 0, shiftsTable?.row_count ?? 0,
    checklistTable?.row_count ?? 0, flagsTable?.row_count ?? 0, tasksTable?.row_count ?? 0,
    userStats[0].total, userStats[0].active, issues.length, JSON.stringify(issues),
  ]).catch(e => console.error('Snapshot save error:', e))

  // ── Historical snapshots (last 90 days) ────────────────────────────────
  const history = await query<{
    snapshot_at: string; active_connections: number; db_size_bytes: string
    gps_rows: number; notifications_rows: number; cache_hit_ratio: number
    issues_count: number; cleanup_gps: number; cleanup_notifications: number
  }>(`
    SELECT snapshot_at::text, active_connections, db_size_bytes::text,
           gps_rows, notifications_rows, cache_hit_ratio,
           issues_count, cleanup_gps, cleanup_notifications
    FROM db_health_snapshots
    ORDER BY snapshot_at DESC
    LIMIT 90
  `)

  return NextResponse.json({
    live: {
      connections: conns[0],
      dbSize: dbSize[0],
      cacheHitRatio: cache[0].ratio,
      tables,
      indexes,
      activeQueries,
      userStats: userStats[0],
      issues,
      actionItems,
    },
    history: history.reverse(),
  })
}
