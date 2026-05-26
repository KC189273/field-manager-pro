import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { isEmailEnabled } from '@/lib/apns'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

function digestEmailHtml(params: {
  dmName: string
  date: string
  clockedIn: number
  openSupply: number
  openFacility: number
  pendingAck: number
  pendingPayroll: number
}): string {
  const { dmName, date, clockedIn, openSupply, openFacility, pendingAck, pendingPayroll } = params
  const allClear = clockedIn === 0 && openSupply === 0 && openFacility === 0 && pendingAck === 0 && pendingPayroll === 0

  const row = (label: string, value: number, href: string, warn = false) =>
    value === 0 ? '' : `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #1f2937;font-size:14px;color:#9ca3af;">${label}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #1f2937;text-align:right;">
          <a href="${APP_URL}${href}" style="display:inline-block;background:${warn ? '#7f1d1d' : '#1e1b4b'};color:${warn ? '#fca5a5' : '#a5b4fc'};font-weight:700;font-size:14px;padding:4px 12px;border-radius:8px;text-decoration:none;">${value}</a>
        </td>
      </tr>`

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#030712;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Morning Digest — ${date}</p>
      </div>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#e5e7eb;margin:0 0 20px;">Good morning, <strong>${dmName}</strong>. Here's your daily summary.</p>

        ${allClear
          ? `<div style="background:#052e16;border:1px solid #166534;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px;">
               <p style="color:#86efac;font-weight:600;margin:0;font-size:14px;">✓ All clear — no open items today</p>
             </div>`
          : `<table style="width:100%;border-collapse:collapse;background:#1f2937;border-radius:10px;overflow:hidden;margin-bottom:20px;">
               ${row('Employees currently clocked in', clockedIn, '/map')}
               ${row('Open supply requests', openSupply, '/supply-requests', openSupply > 3)}
               ${row('Open facility tickets', openFacility, '/facilities', openFacility > 2)}
               ${row('Accountability docs pending acknowledgment', pendingAck, '/accountability', true)}
               ${row('Payroll periods awaiting approval', pendingPayroll, '/payroll', true)}
             </table>`
        }

        <a href="${APP_URL}/dashboard" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Open Field Manager Pro</a>
      </div>
      <p style="color:#374151;font-size:11px;text-align:center;margin-top:16px;">You're receiving this because you're a district manager in Field Manager Pro.</p>
    </div>
  `
}

function consolidatedDigestHtml(params: {
  date: string
  dms: Array<{
    name: string
    clockedIn: number
    openSupply: number
    openFacility: number
    pendingAck: number
  }>
}): string {
  const { date, dms } = params
  const dmRows = dms.map(dm => `
    <tr style="border-bottom:1px solid #1f2937;">
      <td style="padding:10px 16px;font-size:13px;color:#e5e7eb;font-weight:600;">${dm.name}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${dm.clockedIn > 0 ? '#86efac' : '#4b5563'};">${dm.clockedIn}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${dm.openSupply > 0 ? '#fbbf24' : '#4b5563'};">${dm.openSupply}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${dm.openFacility > 0 ? '#fbbf24' : '#4b5563'};">${dm.openFacility}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${dm.pendingAck > 0 ? '#f87171' : '#4b5563'};">${dm.pendingAck}</td>
    </tr>
  `).join('')

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#030712;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Org Morning Digest — ${date}</p>
      </div>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#e5e7eb;margin:0 0 20px;">Here's this morning's summary across all district managers.</p>
        <table style="width:100%;border-collapse:collapse;background:#1f2937;border-radius:10px;overflow:hidden;margin-bottom:20px;">
          <thead>
            <tr style="background:#374151;">
              <th style="padding:10px 16px;text-align:left;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">DM</th>
              <th style="padding:10px 16px;text-align:center;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Clocked In</th>
              <th style="padding:10px 16px;text-align:center;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Supply Req</th>
              <th style="padding:10px 16px;text-align:center;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Facility</th>
              <th style="padding:10px 16px;text-align:center;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Acct Pending</th>
            </tr>
          </thead>
          <tbody>${dmRows}</tbody>
        </table>
        <a href="${APP_URL}/dm-engagement" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View DM Engagement</a>
      </div>
    </div>
  `
}

export async function GET() {
  const authHeader = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  void authHeader // Vercel cron calls without auth header by default

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  // Get all active DMs with email
  const dms = await query<{ id: string; full_name: string; email: string; org_id: string }>(
    `SELECT id, full_name, email, org_id FROM users
     WHERE role = 'manager' AND is_active = TRUE AND email IS NOT NULL AND email != ''`
  )

  if (dms.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  let sent = 0

  // Track per-org data for consolidated digest
  const orgDigests = new Map<string, Array<{ name: string; clockedIn: number; openSupply: number; openFacility: number; pendingAck: number }>>()

  for (const dm of dms) {
    const [clockedInRow, supplyRow, facilityRow, ackRow, payrollRow] = await Promise.all([
      // Employees currently clocked in under this DM
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM shifts s
         JOIN users u ON u.id = s.user_id
         WHERE u.manager_id = $1 AND s.clock_out_at IS NULL`,
        [dm.id]
      ).catch(() => [{ count: '0' }]),

      // Open supply requests
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM supply_requests
         WHERE manager_id = $1 AND status IN ('pending', 'ordered')`,
        [dm.id]
      ).catch(() => [{ count: '0' }]),

      // Open facility tickets at this DM's stores
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM facility_tickets ft
         JOIN dm_manager_stores ms ON ms.store_location_id = ft.store_id
         WHERE ms.manager_id = $1 AND ft.status IN ('open', 'in_progress')`,
        [dm.id]
      ).catch(() => [{ count: '0' }]),

      // Accountability docs pending acknowledgment authored by this DM
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM accountability_docs
         WHERE author_id = $1 AND status = 'approved' AND ack_status = 'pending'`,
        [dm.id]
      ).catch(() => [{ count: '0' }]),

      // Payroll periods awaiting this DM's approval
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM payroll_periods
         WHERE dm_id = $1 AND dm_approved = FALSE AND status != 'draft'`,
        [dm.id]
      ).catch(() => [{ count: '0' }]),
    ])

    const clockedIn = parseInt(clockedInRow[0]?.count ?? '0')
    const openSupply = parseInt(supplyRow[0]?.count ?? '0')
    const openFacility = parseInt(facilityRow[0]?.count ?? '0')
    const pendingAck = parseInt(ackRow[0]?.count ?? '0')
    const pendingPayroll = parseInt(payrollRow[0]?.count ?? '0')

    // Track for consolidated digest
    if (dm.org_id) {
      const list = orgDigests.get(dm.org_id) ?? []
      list.push({ name: dm.full_name, clockedIn, openSupply, openFacility, pendingAck })
      orgDigests.set(dm.org_id, list)
    }

    if (!(await isEmailEnabled(dm.id))) continue

    await sendEmail(
      dm.email,
      `FMP Morning Digest — ${today}`,
      digestEmailHtml({ dmName: dm.full_name, date: today, clockedIn, openSupply, openFacility, pendingAck, pendingPayroll })
    ).catch(() => {})
    sent++
  }

  // Send consolidated digest to SDs and ops managers (one per org)
  for (const [orgId, dmList] of orgDigests) {
    const leaders = await query<{ id: string; email: string; full_name: string }>(
      `SELECT id, email, full_name FROM users
       WHERE org_id = $1 AND role IN ('ops_manager', 'owner', 'sales_director')
         AND is_active = TRUE AND email IS NOT NULL AND email != ''`,
      [orgId]
    ).catch(() => [])

    for (const leader of leaders) {
      if (!(await isEmailEnabled(leader.id))) continue
      await sendEmail(
        leader.email,
        `FMP Org Morning Digest — ${today}`,
        consolidatedDigestHtml({ date: today, dms: dmList })
      ).catch(() => {})
      sent++
    }
  }

  return NextResponse.json({ ok: true, sent })
}
