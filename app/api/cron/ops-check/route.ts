import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

// Runs daily at 6 AM CST — lightweight check, only emails if there are warnings
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ── One-time reminders (date-based, auto-skip after the date) ──
    const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    if (todayCST === '2026-08-31') {
      const reminderHtml = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0">
          <h1 style="color:white;margin:0;font-size:18px">Reminder: DM Store Geography Changes</h1>
          <p style="color:#e9d5ff;margin:4px 0 0;font-size:13px">Tomorrow (Sept 1) — store swaps take effect</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;background:white">
          <p style="font-size:14px;color:#111827;line-height:1.7;margin:0 0 16px">
            This is your reminder that <strong>September 1st store geography changes</strong> go into effect tomorrow. You need to:
          </p>
          <ul style="font-size:14px;color:#374151;line-height:1.8;margin:0 0 16px;padding-left:20px">
            <li>Swap the two DMs' store assignments</li>
            <li>Move stores between DMs as planned</li>
            <li>Update DM-store assignments on the Team page</li>
            <li>Verify geofencing is set correctly on any new/moved stores</li>
          </ul>
          <p style="font-size:13px;color:#6b7280;margin:0">
            Manage stores at <a href="https://fieldmanagerpro.app/store-locations" style="color:#7c3aed">Store Locations</a> · Manage DM assignments on <a href="https://fieldmanagerpro.app/team" style="color:#7c3aed">Team</a>
          </p>
        </div>
      </div>`
      await sendEmail('sg2425231@gmail.com', 'Reminder: DM Store Geography Changes — Sept 1', reminderHtml).catch(() => {})
    }

    type ActionItem = { severity: 'critical' | 'warning' | 'info'; title: string; detail: string; action: string }
    const items: ActionItem[] = []

    // 1. Connection check
    const conns = await query<{ active: number; max: number }>(`
      SELECT count(*)::int as active,
             (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max
      FROM pg_stat_activity
    `)
    const connPct = Math.round((conns[0].active / conns[0].max) * 100)
    if (connPct > 70) items.push({ severity: 'critical', title: 'High connection usage', detail: `${conns[0].active}/${conns[0].max} (${connPct}%)`, action: 'Check for stuck queries or upgrade compute.' })

    // 2. Cache hit ratio
    const cache = await query<{ ratio: number }>(`
      SELECT COALESCE(round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2), 100)::float as ratio
      FROM pg_stat_database WHERE datname = current_database()
    `)
    if (cache[0].ratio < 95) items.push({ severity: 'critical', title: 'Low cache hit ratio', detail: `${cache[0].ratio}%`, action: 'Database needs more RAM — upgrade Supabase compute.' })

    // 3. Heavy concurrent queries
    const heavyQueries = await query<{ query: string; cnt: number }>(`
      SELECT LEFT(query, 80) as query, count(*)::int as cnt
      FROM pg_stat_activity WHERE state = 'active' AND pid != pg_backend_pid()
      GROUP BY LEFT(query, 80) HAVING count(*) > 5
    `)
    for (const q of heavyQueries) {
      items.push({ severity: 'warning', title: `${q.cnt} concurrent identical queries`, detail: q.query, action: 'This query may need caching or index optimization.' })
    }

    // 4. Orphaned employees
    const orphaned = await query<{ cnt: number }>(`
      SELECT COUNT(*)::int as cnt FROM users
      WHERE role = 'employee' AND is_active = TRUE AND manager_id IS NULL
    `)
    if (orphaned[0].cnt > 0) items.push({ severity: 'warning', title: `${orphaned[0].cnt} employees without manager`, detail: 'These employees are invisible to all DMs.', action: 'Assign managers on the Team page.' })

    // 5. Unassigned stores
    const stores = await query<{ cnt: number }>(`
      SELECT COUNT(*)::int as cnt FROM dm_store_locations sl
      WHERE sl.active = TRUE AND NOT EXISTS (SELECT 1 FROM dm_manager_stores ms WHERE ms.store_location_id = sl.id)
    `)
    if (stores[0].cnt > 0) items.push({ severity: 'info', title: `${stores[0].cnt} stores without DM`, detail: 'Employees can\'t clock into these stores.', action: 'Assign on DM Store Visit → Manage Stores.' })

    // 6. Table bloat — only flag if >5% dead and >100K rows
    const bloat = await query<{ relname: string; dead: number; live: number }>(`
      SELECT relname, n_dead_tup::int as dead, n_live_tup::int as live
      FROM pg_stat_user_tables WHERE n_dead_tup > 100000 ORDER BY n_dead_tup DESC LIMIT 3
    `)
    for (const t of bloat) {
      const pct = t.live > 0 ? (t.dead / t.live) * 100 : 0
      if (pct > 5) items.push({ severity: 'warning', title: `Table bloat: ${t.relname}`, detail: `${t.dead.toLocaleString()} dead rows (${pct.toFixed(1)}%)`, action: 'Weekly VACUUM runs Sundays. If persistent, run manually.' })
    }

    // 7. Stale time-off requests (pending >14 days)
    const staleTimeOff = await query<{ cnt: number }>(`
      SELECT COUNT(*)::int as cnt FROM time_off_requests WHERE status = 'pending' AND created_at < NOW() - INTERVAL '14 days'
    `)
    if (staleTimeOff[0].cnt > 0) items.push({ severity: 'warning', title: `${staleTimeOff[0].cnt} time-off requests pending >14 days`, detail: 'DMs need to approve or deny these.', action: 'Check Time Off page for stale requests.' })

    // 8. Stale supply requests (pending >7 days, already escalated)
    const staleSupply = await query<{ cnt: number }>(`
      SELECT COUNT(*)::int as cnt FROM supply_requests WHERE status = 'pending' AND created_at < NOW() - INTERVAL '7 days'
    `)
    if (staleSupply[0].cnt > 0) items.push({ severity: 'info', title: `${staleSupply[0].cnt} supply requests pending >7 days`, detail: 'These were already escalated. DMs may need a nudge.', action: 'Check Supply Requests for stale orders.' })

    // Only email if there are critical or warning items
    const urgent = items.filter(i => i.severity === 'critical' || i.severity === 'warning')
    if (urgent.length === 0) {
      return NextResponse.json({ ok: true, status: 'healthy', items: 0 })
    }

    // Build email
    const itemsHtml = items.filter(i => i.severity !== 'info').map(item => {
      const color = item.severity === 'critical' ? '#dc2626' : '#d97706'
      const label = item.severity === 'critical' ? 'CRITICAL' : 'WARNING'
      return `<div style="margin-bottom:12px;padding:12px 16px;border-left:4px solid ${color};background:${item.severity === 'critical' ? '#fef2f2' : '#fffbeb'}">
        <p style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:1px;margin:0 0 4px">${label}</p>
        <p style="font-size:14px;font-weight:600;color:#111827;margin:0 0 4px">${item.title}</p>
        <p style="font-size:13px;color:#374151;margin:0 0 6px">${item.detail}</p>
        <p style="font-size:12px;color:#6b7280;margin:0"><strong>Action:</strong> ${item.action}</p>
      </div>`
    }).join('')

    const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#0f172a;padding:20px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:18px">Daily Ops Check</h1>
        <p style="color:#94a3b8;margin:4px 0 0;font-size:13px">${urgent.length} item${urgent.length !== 1 ? 's' : ''} need attention</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;background:white">
        ${itemsHtml}
        <p style="font-size:12px;color:#9ca3af;margin:16px 0 0;text-align:center">
          View full dashboard at <a href="https://fieldmanagerpro.app/db-health" style="color:#7c3aed">fieldmanagerpro.app/db-health</a>
        </p>
      </div>
    </div>`

    const devs = await query<{ email: string }>(`
      SELECT u.email FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.role = 'developer' AND u.is_active = TRUE
        AND COALESCE(np.ops_alerts, TRUE) = TRUE
        AND COALESCE(np.email_enabled, TRUE) = TRUE
    `)
    if (devs.length > 0) {
      await sendEmail(devs.map(d => d.email), `Ops Alert — ${urgent.length} item${urgent.length !== 1 ? 's' : ''} need attention`, html)
    }

    return NextResponse.json({ ok: true, status: 'alerts_sent', items: urgent.length })
  } catch (err) {
    console.error('Ops check error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
