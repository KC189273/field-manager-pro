import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const CST = 'America/Chicago'

// Runs daily at 9 PM CST — sends photo compliance summary to DMs and leadership
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: CST })

  // Get all orgs
  const orgs = await query<{ id: string; name: string }>(`SELECT id, name FROM organizations WHERE industry = 'wireless_retail'`)

  let totalEmails = 0

  for (const org of orgs) {
    // Get today's shifts for this org
    const shifts = await query<{
      user_id: string; full_name: string; manager_id: string | null; manager_name: string | null
      store_address: string | null; has_photo: boolean
    }>(`
      SELECT s.user_id, u.full_name, u.manager_id,
             m.full_name as manager_name,
             sl.address as store_address,
             (s.clock_in_photo_key IS NOT NULL AND s.clock_in_photo_key != '') as has_photo
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN users m ON m.id = u.manager_id
      LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
      WHERE (s.clock_in_at AT TIME ZONE 'America/Chicago')::date = $1::date
        AND u.role = 'employee'
        AND u.org_id = $2
    `, [today, org.id])

    if (shifts.length === 0) continue

    const withPhoto = shifts.filter(s => s.has_photo).length
    const withoutPhoto = shifts.filter(s => !s.has_photo).length
    const rate = Math.round((withPhoto / shifts.length) * 100)

    // Group missing by DM
    const byDm: Record<string, { dmId: string; missing: string[] }> = {}
    for (const s of shifts.filter(s => !s.has_photo)) {
      const dm = s.manager_name || 'Unassigned'
      if (!byDm[dm]) byDm[dm] = { dmId: s.manager_id || '', missing: [] }
      byDm[dm].missing.push(s.full_name)
    }

    // Build email
    const dmRows = Object.entries(byDm)
      .sort((a, b) => b[1].missing.length - a[1].missing.length)
      .map(([dm, data]) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">${dm}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#dc2626;font-weight:600;">${data.missing.length}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${data.missing.join(', ')}</td>
        </tr>
      `).join('')

    const rateColor = rate >= 80 ? '#16a34a' : rate >= 50 ? '#d97706' : '#dc2626'

    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h1 style="color:white;margin:0;font-size:18px;">Clock-In Photo Compliance</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${new Date().toLocaleDateString('en-US', { timeZone: CST, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div style="background:white;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:24px;">
          <div style="text-align:center;margin-bottom:20px;">
            <p style="font-size:48px;font-weight:800;color:${rateColor};margin:0;">${rate}%</p>
            <p style="font-size:13px;color:#6b7280;margin:4px 0 0;">Compliance Rate</p>
            <p style="font-size:12px;color:#9ca3af;margin:2px 0 0;">${withPhoto} of ${shifts.length} clock-ins included a photo</p>
          </div>
          ${withoutPhoto > 0 ? `
            <h3 style="font-size:14px;color:#1f2937;margin:20px 0 12px;">Missing Photos by DM (${withoutPhoto} total)</h3>
            <table style="width:100%;border-collapse:collapse;">
              <tr style="background:#f9fafb;">
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">DM</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Missing</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Employees</th>
              </tr>
              ${dmRows}
            </table>
          ` : '<p style="text-align:center;color:#16a34a;font-size:14px;font-weight:600;">All employees submitted photos today!</p>'}
        </div>
      </div>
    `

    // Send to leadership (DMs, ops, owners, developers)
    const recipients = await query<{ email: string }>(`
      SELECT email FROM users
      WHERE org_id = $1 AND is_active = TRUE
        AND role IN ('manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer')
    `, [org.id])

    for (const r of recipients) {
      sendEmail(r.email, `Photo Compliance: ${rate}% — ${today}`, html).catch(() => {})
      totalEmails++
    }
  }

  return NextResponse.json({ ok: true, emails: totalEmails })
}
