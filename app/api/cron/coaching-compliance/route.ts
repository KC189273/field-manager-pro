import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const CST = 'America/Chicago'

// Runs daily at 8 PM CST — sends coaching compliance summary to leadership
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: CST })

  const orgs = await query<{ id: string; name: string }>(`SELECT id, name FROM organizations WHERE industry = 'wireless_retail'`)

  let totalEmails = 0

  for (const org of orgs) {
    // Today's visits by DM
    const dmStats = await query<{
      dm_name: string; total: number; with_coaching: number; without_coaching: number
      stores_without: string
    }>(`
      SELECT u.full_name as dm_name,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE v.visit_type IN ('quick_coaching', 'remote_coaching'))::int as with_coaching,
        COUNT(*) FILTER (WHERE v.visit_type NOT IN ('quick_coaching', 'remote_coaching'))::int as without_coaching,
        STRING_AGG(CASE WHEN v.visit_type NOT IN ('quick_coaching', 'remote_coaching') THEN v.store_address END, ', ') as stores_without
      FROM dm_store_visits v
      JOIN users u ON u.id = v.submitted_by_id
      WHERE (v.submitted_at AT TIME ZONE 'America/Chicago')::date = $1::date
        AND u.org_id = $2 AND u.role = 'manager'
      GROUP BY u.id, u.full_name
      ORDER BY without_coaching DESC, u.full_name
    `, [today, org.id])

    if (dmStats.length === 0) continue

    const totalVisits = dmStats.reduce((s, d) => s + d.total, 0)
    const withCoaching = dmStats.reduce((s, d) => s + d.with_coaching, 0)
    const withoutCoaching = dmStats.reduce((s, d) => s + d.without_coaching, 0)
    const rate = totalVisits > 0 ? Math.round((withCoaching / totalVisits) * 100) : 0
    const rateColor = rate >= 90 ? '#16a34a' : rate >= 70 ? '#d97706' : '#dc2626'

    const dmRows = dmStats.map(d => {
      const dmRate = d.total > 0 ? Math.round((d.with_coaching / d.total) * 100) : 0
      const color = dmRate >= 90 ? '#16a34a' : dmRate >= 70 ? '#d97706' : '#dc2626'
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">${d.dm_name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">${d.total}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#16a34a;">${d.with_coaching}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:${d.without_coaching > 0 ? '#dc2626' : '#6b7280'};font-weight:${d.without_coaching > 0 ? '600' : '400'};">${d.without_coaching}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:${color};font-weight:600;">${dmRate}%</td>
        </tr>
        ${d.without_coaching > 0 && d.stores_without ? `
        <tr>
          <td colspan="5" style="padding:4px 12px 8px 24px;font-size:11px;color:#9ca3af;border-bottom:1px solid #f3f4f6;">No coaching at: ${d.stores_without}</td>
        </tr>` : ''}`
    }).join('')

    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h1 style="color:white;margin:0;font-size:18px;">Coaching Compliance Report</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${new Date().toLocaleDateString('en-US', { timeZone: CST, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div style="background:white;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:24px;">
          <div style="text-align:center;margin-bottom:20px;">
            <p style="font-size:48px;font-weight:800;color:${rateColor};margin:0;">${rate}%</p>
            <p style="font-size:13px;color:#6b7280;margin:4px 0 0;">Coaching Compliance</p>
            <p style="font-size:12px;color:#9ca3af;margin:2px 0 0;">${withCoaching} of ${totalVisits} visits included coaching</p>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">DM</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;">Visits</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;">Coached</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;">Missed</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;">Rate</th>
            </tr>
            ${dmRows}
          </table>
        </div>
      </div>
    `

    const recipients = await query<{ email: string }>(`
      SELECT email FROM users
      WHERE org_id = $1 AND is_active = TRUE
        AND role IN ('ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer')
    `, [org.id])

    for (const r of recipients) {
      sendEmail(r.email, `Coaching Compliance: ${rate}% — ${today}`, html).catch(() => {})
      totalEmails++
    }
  }

  return NextResponse.json({ ok: true, emails: totalEmails })
}
