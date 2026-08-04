import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'

// Full system health check — runs every 3 days via cron OR on-demand from App Health
// Checks: data integrity, stale records, performance, cron health, agent health, schedule issues

export async function GET(req: NextRequest) {
  // Allow both cron (Bearer token) and developer session
  const auth = req.headers.get('authorization')
  const session = await getSession().catch(() => null)
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`
  const isDev = session?.role === 'developer' || session?.role === 'owner'

  if (!isCron && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  type Finding = { category: string; severity: 'critical' | 'warning' | 'info' | 'ok'; title: string; detail: string }
  const findings: Finding[] = []

  // ── DATABASE ──
  const [dbSize] = await query<{ bytes: string; pretty: string }>(`SELECT pg_database_size(current_database())::text as bytes, pg_size_pretty(pg_database_size(current_database())) as pretty`)
  findings.push({ category: 'Database', severity: 'info', title: `Database size: ${dbSize.pretty}`, detail: '' })

  const [conns] = await query<{ active: number; max: number }>(`SELECT count(*)::int as active, (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max FROM pg_stat_activity`)
  const connPct = Math.round((conns.active / conns.max) * 100)
  findings.push({ category: 'Database', severity: connPct > 70 ? 'critical' : connPct > 50 ? 'warning' : 'ok', title: `Connections: ${conns.active}/${conns.max} (${connPct}%)`, detail: '' })

  const bloat = await query<{ relname: string; dead: number; live: number }>(`SELECT relname, n_dead_tup::int as dead, n_live_tup::int as live FROM pg_stat_user_tables WHERE n_dead_tup > 1000 ORDER BY n_dead_tup DESC LIMIT 5`)
  for (const t of bloat) {
    const pct = t.live > 0 ? ((t.dead / t.live) * 100).toFixed(1) : '0'
    findings.push({ category: 'Database', severity: t.dead > 100000 && parseFloat(pct) > 5 ? 'warning' : 'ok', title: `${t.relname}: ${t.dead.toLocaleString()} dead rows (${pct}%)`, detail: '' })
  }

  // ── DATA INTEGRITY ──
  const [terminated] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM users WHERE is_active = TRUE AND is_terminated = TRUE`)
  if (terminated.cnt > 0) findings.push({ category: 'Data Integrity', severity: 'warning', title: `${terminated.cnt} terminated user(s) still marked active`, detail: 'Should have is_active=FALSE' })

  const [noManager] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM users WHERE role = 'employee' AND is_active = TRUE AND manager_id IS NULL`)
  if (noManager.cnt > 0) findings.push({ category: 'Data Integrity', severity: 'warning', title: `${noManager.cnt} employee(s) without a manager`, detail: 'Invisible to all DMs' })

  const [badManager] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM users u WHERE u.role = 'employee' AND u.is_active = TRUE AND u.manager_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users m WHERE m.id = u.manager_id AND m.is_active = TRUE)`)
  if (badManager.cnt > 0) findings.push({ category: 'Data Integrity', severity: 'warning', title: `${badManager.cnt} employee(s) assigned to inactive manager`, detail: 'Reassign to active DM' })

  const [orphanShifts] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM scheduled_shifts ss WHERE ss.employee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ss.employee_id)`)
  if (orphanShifts.cnt > 0) findings.push({ category: 'Data Integrity', severity: 'warning', title: `${orphanShifts.cnt} scheduled shift(s) for deleted users`, detail: 'Clean up orphaned data' })

  if (terminated.cnt === 0 && noManager.cnt === 0 && badManager.cnt === 0 && orphanShifts.cnt === 0) {
    findings.push({ category: 'Data Integrity', severity: 'ok', title: 'All user records consistent', detail: '' })
  }

  // ── STALE DATA ──
  const [staleGps] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM gps_breadcrumbs WHERE recorded_at < NOW() - INTERVAL '90 days'`)
  if (staleGps.cnt > 100) findings.push({ category: 'Stale Data', severity: 'info', title: `${staleGps.cnt.toLocaleString()} GPS records >90 days`, detail: 'Weekly cleanup should handle' })

  const [staleNotifs] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM notifications WHERE created_at < NOW() - INTERVAL '30 days'`)
  if (staleNotifs.cnt > 100) findings.push({ category: 'Stale Data', severity: 'info', title: `${staleNotifs.cnt.toLocaleString()} notifications >30 days`, detail: 'Weekly cleanup should handle' })

  const [staleConvos] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM support_conversations WHERE status = 'active' AND created_at < NOW() - INTERVAL '48 hours'`)
  if (staleConvos.cnt > 0) findings.push({ category: 'Stale Data', severity: 'warning', title: `${staleConvos.cnt} stale support conversation(s) >48h`, detail: 'Should auto-close' })

  const [staleTimeOff] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM time_off_requests WHERE status = 'pending' AND created_at < NOW() - INTERVAL '14 days'`)
  if (staleTimeOff.cnt > 0) findings.push({ category: 'Stale Data', severity: 'warning', title: `${staleTimeOff.cnt} time-off request(s) pending >14 days`, detail: 'DMs need to approve/deny' })

  const [staleSupply] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM supply_requests WHERE status = 'pending' AND created_at < NOW() - INTERVAL '7 days'`)
  if (staleSupply.cnt > 0) findings.push({ category: 'Stale Data', severity: 'info', title: `${staleSupply.cnt} supply request(s) pending >7 days`, detail: 'Already escalated' })

  // ── SCHEDULE HEALTH ──
  const [unpubStores] = await query<{ cnt: number }>(`
    SELECT COUNT(DISTINCT dms.store_location_id)::int as cnt
    FROM dm_manager_stores dms
    JOIN dm_store_locations dsl ON dsl.id = dms.store_location_id AND dsl.active = TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM scheduled_shifts_publish ssp
      WHERE ssp.store_location_id = dms.store_location_id
        AND ssp.week_start >= (CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::int + 6) % 7))
    )
  `)
  if (unpubStores.cnt > 0) findings.push({ category: 'Schedules', severity: 'warning', title: `${unpubStores.cnt} active store(s) without published schedule this week`, detail: 'Employees at these stores see empty My Schedule' })

  // ── AGENT HEALTH ──
  const [agentErrors] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM agent_runs WHERE status = 'error' AND created_at >= NOW() - INTERVAL '3 days'`)
  if (agentErrors.cnt > 0) findings.push({ category: 'AI Agents', severity: 'warning', title: `${agentErrors.cnt} agent error(s) in last 3 days`, detail: 'Check Agent Inbox → Runs' })
  else findings.push({ category: 'AI Agents', severity: 'ok', title: 'All agent runs successful (last 3 days)', detail: '' })

  const [pendingActions] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM agent_actions WHERE status = 'pending'`)
  if (pendingActions.cnt > 0) findings.push({ category: 'AI Agents', severity: 'info', title: `${pendingActions.cnt} pending agent action(s)`, detail: 'Review in Agent Inbox' })

  const [escalated] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM support_conversations WHERE status = 'escalated'`)
  if (escalated.cnt > 0) findings.push({ category: 'AI Agents', severity: 'warning', title: `${escalated.cnt} escalated support conversation(s) awaiting reply`, detail: 'Reply in Agent Inbox → Pending' })

  // ── OVERDUE TASKS ──
  const [overdueTasks] = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM tasks t WHERE t.due_date < NOW() AND NOT EXISTS (SELECT 1 FROM task_completions tc WHERE tc.task_id = t.id)`)
  if (overdueTasks.cnt > 0) findings.push({ category: 'Operations', severity: 'info', title: `${overdueTasks.cnt} overdue task(s)`, detail: 'Check Tasks → Overdue filter' })

  // ── SUMMARY ──
  const criticals = findings.filter(f => f.severity === 'critical').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  const oks = findings.filter(f => f.severity === 'ok').length

  // Email if this is a cron run and there are warnings
  if (isCron && (criticals > 0 || warnings > 0)) {
    const devs = await query<{ id: string; email: string }>(`SELECT id, email FROM users WHERE role IN ('developer', 'owner') AND is_active = TRUE`)
    const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

    const findingsHtml = findings.filter(f => f.severity !== 'ok' && f.severity !== 'info').map(f => {
      const color = f.severity === 'critical' ? '#dc2626' : '#d97706'
      return `<div style="padding:8px 12px;border-left:3px solid ${color};background:${f.severity === 'critical' ? '#fef2f2' : '#fffbeb'};margin-bottom:6px;border-radius:0 6px 6px 0">
        <p style="margin:0;font-size:13px;color:#111"><strong>[${f.category}]</strong> ${f.title}</p>
        ${f.detail ? `<p style="margin:2px 0 0;font-size:12px;color:#666">${f.detail}</p>` : ''}
      </div>`
    }).join('')

    const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">System Health Check</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">${criticals} critical · ${warnings} warning · ${oks} ok</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        ${findingsHtml}
        <a href="${appUrl}/db-health" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-top:16px;">Open App Health</a>
      </div>
    </div>`

    for (const dev of devs) {
      sendEmail(dev.email, `System Health: ${criticals > 0 ? 'CRITICAL' : 'WARNING'} — ${criticals + warnings} issue${criticals + warnings !== 1 ? 's' : ''}`, html).catch(() => {})
      sendPushToUser(dev.id, 'System Health Check', `${criticals} critical, ${warnings} warnings found.`, 'system_health').catch(() => {})
    }
  }

  return NextResponse.json({
    ok: true,
    summary: { critical: criticals, warning: warnings, info: findings.filter(f => f.severity === 'info').length, ok: oks },
    findings,
    ranAt: new Date().toISOString(),
  })
}
