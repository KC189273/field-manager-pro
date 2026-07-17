import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

interface DmDigestData {
  dmName: string
  date: string
  // Existing
  clockedIn: number
  openSupply: number
  openFacility: number
  pendingAck: number
  pendingPayroll: number
  // New
  scheduledToday: Array<{ name: string; store: string; start: string; end: string }>
  overdueTasks: number
  pendingTasks: number
  otWatch: Array<{ name: string; hours: number }>
  pendingTimeOff: Array<{ name: string; start: string; end: string }>
}

function digestEmailHtml(params: DmDigestData): string {
  const { dmName, date, clockedIn, openSupply, openFacility, pendingAck, pendingPayroll,
    scheduledToday, overdueTasks, pendingTasks, otWatch, pendingTimeOff } = params

  const actionItems: string[] = []
  if (pendingAck > 0) actionItems.push(`${pendingAck} accountability doc${pendingAck > 1 ? 's' : ''} pending acknowledgment`)
  if (pendingPayroll > 0) actionItems.push(`${pendingPayroll} payroll period${pendingPayroll > 1 ? 's' : ''} awaiting approval`)
  if (pendingTimeOff.length > 0) actionItems.push(`${pendingTimeOff.length} time-off request${pendingTimeOff.length > 1 ? 's' : ''} need your decision`)
  if (overdueTasks > 0) actionItems.push(`${overdueTasks} overdue task${overdueTasks > 1 ? 's' : ''}`)
  if (openSupply > 0) actionItems.push(`${openSupply} open supply request${openSupply > 1 ? 's' : ''}`)
  if (openFacility > 0) actionItems.push(`${openFacility} open facility ticket${openFacility > 1 ? 's' : ''}`)

  const actionSection = actionItems.length > 0 ? `
    <div style="background:#7f1d1d;border:1px solid #991b1b;border-radius:10px;padding:16px;margin-bottom:20px">
      <p style="color:#fca5a5;font-weight:700;font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px">Action Items</p>
      ${actionItems.map(a => `<p style="color:#fecaca;font-size:13px;margin:0 0 4px">• ${a}</p>`).join('')}
    </div>` : `
    <div style="background:#052e16;border:1px solid #166534;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px">
      <p style="color:#86efac;font-weight:600;margin:0;font-size:14px">✓ No urgent action items</p>
    </div>`

  const staffingSection = scheduledToday.length > 0 ? `
    <div style="margin-bottom:20px">
      <p style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;margin:0 0 10px">Today's Staffing (${scheduledToday.length} scheduled)</p>
      <table style="width:100%;border-collapse:collapse;background:#1f2937;border-radius:8px;overflow:hidden">
        ${scheduledToday.map(s => `
          <tr style="border-bottom:1px solid #374151">
            <td style="padding:8px 12px;font-size:13px;color:#e5e7eb;font-weight:600">${s.name}</td>
            <td style="padding:8px 12px;font-size:12px;color:#9ca3af">${s.store}</td>
            <td style="padding:8px 12px;font-size:12px;color:#9ca3af;text-align:right">${s.start} – ${s.end}</td>
          </tr>`).join('')}
      </table>
    </div>` : ''

  const otSection = otWatch.length > 0 ? `
    <div style="margin-bottom:20px">
      <p style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:.5px;margin:0 0 10px">OT Watch</p>
      <div style="background:#78350f;border:1px solid #92400e;border-radius:8px;padding:12px">
        ${otWatch.map(e => `<p style="color:#fde68a;font-size:13px;margin:0 0 4px"><strong>${e.name}</strong> — ${e.hours.toFixed(1)}h this week</p>`).join('')}
      </div>
    </div>` : ''

  const timeOffSection = pendingTimeOff.length > 0 ? `
    <div style="margin-bottom:20px">
      <p style="font-size:11px;font-weight:700;color:#f87171;text-transform:uppercase;letter-spacing:.5px;margin:0 0 10px">Pending Time-Off Requests</p>
      <div style="background:#1f2937;border-radius:8px;overflow:hidden">
        ${pendingTimeOff.map(r => `
          <div style="padding:8px 12px;border-bottom:1px solid #374151">
            <span style="font-size:13px;color:#e5e7eb;font-weight:600">${r.name}</span>
            <span style="font-size:12px;color:#9ca3af;margin-left:8px">${r.start}${r.start !== r.end ? ` – ${r.end}` : ''}</span>
          </div>`).join('')}
      </div>
    </div>` : ''

  const statsRow = `
    <div style="display:flex;padding:16px;gap:8px;flex-wrap:wrap;border-bottom:1px solid #1f2937">
      ${stat('Clocked In', clockedIn, '#86efac')}
      ${stat('Scheduled', scheduledToday.length, '#a5b4fc')}
      ${stat('Tasks', `${pendingTasks}`, '#fbbf24')}
      ${stat('OT Risk', otWatch.length, otWatch.length > 0 ? '#f87171' : '#4b5563')}
    </div>`

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:20px;font-weight:700">Morning Digest</h1>
        <p style="color:#ddd6fe;margin:6px 0 0;font-size:14px">Good morning, ${dmName}</p>
        <p style="color:#c4b5fd;margin:4px 0 0;font-size:13px">${date}</p>
      </div>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:0 0 12px 12px;overflow:hidden">
        ${statsRow}
        <div style="padding:20px">
          ${actionSection}
          ${staffingSection}
          ${otSection}
          ${timeOffSection}
          <a href="${APP_URL}/dashboard" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px">Open Field Manager Pro</a>
        </div>
        <div style="padding:12px 20px;background:#0a0a0a;border-top:1px solid #1f2937">
          <p style="font-size:11px;color:#4b5563;margin:0;text-align:center">Field Manager Pro &middot; <a href="${APP_URL}" style="color:#7c3aed">fieldmanagerpro.app</a></p>
        </div>
      </div>
    </div>`
}

function stat(label: string, value: string | number, color: string) {
  return `<div style="text-align:center;flex:1;min-width:70px">
    <div style="font-size:22px;font-weight:700;color:${color}">${value}</div>
    <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">${label}</div>
  </div>`
}

function consolidatedDigestHtml(params: {
  date: string
  dms: Array<{ name: string; clockedIn: number; scheduled: number; openSupply: number; openFacility: number; pendingAck: number; otRisk: number; pendingTimeOff: number }>
}): string {
  const { date, dms } = params
  const th = (label: string) => `<th style="padding:8px 10px;text-align:center;font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.03em">${label}</th>`
  const td = (val: number, warn = false) => `<td style="padding:8px 10px;text-align:center;font-size:13px;color:${val > 0 ? (warn ? '#f87171' : '#e5e7eb') : '#4b5563'};font-weight:${val > 0 ? '600' : '400'}">${val}</td>`

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:750px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:20px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:20px">Morning Digest</h1>
        <p style="color:#ddd6fe;margin:4px 0 0;font-size:14px">${date}</p>
      </div>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:0 0 12px 12px;padding:20px">
        <table style="width:100%;border-collapse:collapse;background:#1f2937;border-radius:10px;overflow:hidden;margin-bottom:20px">
          <thead><tr style="background:#374151">
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.03em">DM</th>
            ${th('In')}${th('Sched')}${th('Supply')}${th('Facility')}${th('Acct')}${th('OT')}${th('PTO')}
          </tr></thead>
          <tbody>${dms.map(dm => `
            <tr style="border-bottom:1px solid #374151">
              <td style="padding:8px 10px;font-size:13px;color:#e5e7eb;font-weight:600">${dm.name}</td>
              ${td(dm.clockedIn)}${td(dm.scheduled)}${td(dm.openSupply)}${td(dm.openFacility)}${td(dm.pendingAck, true)}${td(dm.otRisk, true)}${td(dm.pendingTimeOff, true)}
            </tr>`).join('')}
          </tbody>
        </table>
        <a href="${APP_URL}/dm-engagement" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px">View DM Engagement</a>
      </div>
    </div>`
}

export async function GET() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) // YYYY-MM-DD

  // Get current day of week for schedule lookup
  const nowCentral = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const dow = nowCentral.getDay() // 0=Sun

  // Week start (Monday) for OT calculation
  const weekMon = new Date(nowCentral)
  const daysSinceMon = dow === 0 ? 6 : dow - 1
  weekMon.setDate(weekMon.getDate() - daysSinceMon)
  const weekStartDate = `${weekMon.getFullYear()}-${String(weekMon.getMonth() + 1).padStart(2, '0')}-${String(weekMon.getDate()).padStart(2, '0')}`

  const dms = await query<{ id: string; full_name: string; email: string; org_id: string }>(
    `SELECT id, full_name, email, org_id FROM users
     WHERE role = 'manager' AND is_active = TRUE AND is_hidden = FALSE AND email IS NOT NULL AND email != ''`
  )

  if (dms.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  let sent = 0
  const orgDigests = new Map<string, Array<{ name: string; clockedIn: number; scheduled: number; openSupply: number; openFacility: number; pendingAck: number; otRisk: number; pendingTimeOff: number }>>()

  for (const dm of dms) {
    const [clockedInRow, supplyRow, facilityRow, ackRow, payrollRow, scheduledRows, overdueRow, pendingTaskRow, otRows, timeOffRows] = await Promise.all([
      // Employees currently clocked in
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM shifts s JOIN users u ON u.id = s.user_id WHERE u.manager_id = $1 AND s.clock_out_at IS NULL`, [dm.id])
        .catch(() => [{ count: '0' }]),

      // Open supply requests
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM supply_requests WHERE manager_id = $1 AND status IN ('pending', 'ordered')`, [dm.id])
        .catch(() => [{ count: '0' }]),

      // Open facility tickets
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM facility_tickets ft JOIN dm_manager_stores ms ON ms.store_location_id = ft.store_id WHERE ms.manager_id = $1 AND ft.status IN ('open', 'in_progress')`, [dm.id])
        .catch(() => [{ count: '0' }]),

      // Accountability docs pending acknowledgment
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM accountability_docs WHERE author_id = $1 AND status = 'approved' AND ack_status = 'pending'`, [dm.id])
        .catch(() => [{ count: '0' }]),

      // Payroll periods awaiting approval
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM payroll_periods WHERE dm_id = $1 AND dm_approved = FALSE AND status != 'draft'`, [dm.id])
        .catch(() => [{ count: '0' }]),

      // Today's scheduled employees
      query<{ name: string; store: string; start: string; end: string }>(`
        SELECT u.full_name as name,
               COALESCE(sl.address, 'Unassigned') as store,
               TO_CHAR(ss.start_time, 'HH12:MI AM') as start,
               TO_CHAR(ss.end_time, 'HH12:MI AM') as end
        FROM scheduled_shifts ss
        JOIN users u ON u.id = ss.user_id
        LEFT JOIN store_locations sl ON sl.id = ss.store_location_id
        WHERE ss.manager_id = $1 AND ss.shift_date = $2
          AND EXISTS (SELECT 1 FROM scheduled_shifts_publish ssp WHERE ssp.manager_id = ss.manager_id AND ssp.week_start = ss.week_start)
        ORDER BY ss.start_time
      `, [dm.id, todayDate]).catch(() => []),

      // Overdue tasks
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM tasks WHERE assignee_id IN (SELECT id FROM users WHERE manager_id = $1) AND completed = FALSE AND due_date < $2`, [dm.id, todayDate])
        .catch(() => [{ count: '0' }]),

      // Pending (incomplete) tasks
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM tasks WHERE assignee_id IN (SELECT id FROM users WHERE manager_id = $1) AND completed = FALSE`, [dm.id])
        .catch(() => [{ count: '0' }]),

      // OT watch — employees approaching 40h this week
      query<{ name: string; hours: number }>(`
        SELECT u.full_name as name,
               ROUND(EXTRACT(EPOCH FROM SUM(COALESCE(s.clock_out_at, NOW()) - s.clock_in_at - (s.break_minutes || 0) * INTERVAL '1 minute')) / 3600.0, 1) as hours
        FROM shifts s
        JOIN users u ON u.id = s.user_id
        WHERE u.manager_id = $1 AND s.clock_in_at >= $2::date
        GROUP BY u.id, u.full_name
        HAVING EXTRACT(EPOCH FROM SUM(COALESCE(s.clock_out_at, NOW()) - s.clock_in_at - (s.break_minutes || 0) * INTERVAL '1 minute')) / 3600.0 >= 32
        ORDER BY hours DESC
      `, [dm.id, weekStartDate]).catch(() => []),

      // Pending time-off requests needing this DM's approval
      query<{ name: string; start: string; end: string }>(`
        SELECT u.full_name as name, tor.start_date::text as start, tor.end_date::text as end
        FROM time_off_requests tor
        JOIN users u ON u.id = tor.user_id
        WHERE tor.approver_id = $1 AND tor.status = 'pending'
        ORDER BY tor.start_date
      `, [dm.id]).catch(() => []),
    ])

    const clockedIn = parseInt(clockedInRow[0]?.count ?? '0')
    const openSupply = parseInt(supplyRow[0]?.count ?? '0')
    const openFacility = parseInt(facilityRow[0]?.count ?? '0')
    const pendingAck = parseInt(ackRow[0]?.count ?? '0')
    const pendingPayroll = parseInt(payrollRow[0]?.count ?? '0')
    const scheduledToday = scheduledRows as Array<{ name: string; store: string; start: string; end: string }>
    const overdueTasks = parseInt(overdueRow[0]?.count ?? '0')
    const pendingTasks = parseInt(pendingTaskRow[0]?.count ?? '0')
    const otWatch = otRows as Array<{ name: string; hours: number }>
    const pendingTimeOff = timeOffRows as Array<{ name: string; start: string; end: string }>

    // Track for consolidated digest
    if (dm.org_id) {
      const list = orgDigests.get(dm.org_id) ?? []
      list.push({ name: dm.full_name, clockedIn, scheduled: scheduledToday.length, openSupply, openFacility, pendingAck, otRisk: otWatch.length, pendingTimeOff: pendingTimeOff.length })
      orgDigests.set(dm.org_id, list)
    }

    // Check email preferences
    const pref = await queryOne<{ email_enabled: boolean; morning_digest: boolean }>(`
      SELECT COALESCE(email_enabled, true) as email_enabled, COALESCE(morning_digest, true) as morning_digest
      FROM notification_preferences WHERE user_id = $1
    `, [dm.id])
    if (pref && (!pref.email_enabled || !pref.morning_digest)) continue

    await sendEmail(
      dm.email,
      `Morning Digest — ${today}`,
      digestEmailHtml({ dmName: dm.full_name, date: today, clockedIn, openSupply, openFacility, pendingAck, pendingPayroll, scheduledToday, overdueTasks, pendingTasks, otWatch, pendingTimeOff })
    ).catch(() => {})
    sent++
  }

  // Consolidated digest to leadership
  for (const [orgId, dmList] of orgDigests) {
    const leaders = await query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.org_id = $1 AND u.role IN ('ops_manager', 'owner', 'sales_director', 'developer')
         AND u.is_active = TRUE AND u.email IS NOT NULL AND u.email != ''
         AND COALESCE(np.email_enabled, true) = true
         AND COALESCE(np.morning_digest, true) = true`,
      [orgId]
    ).catch(() => [])

    for (const leader of leaders) {
      await sendEmail(
        leader.email,
        `Org Morning Digest — ${today}`,
        consolidatedDigestHtml({ date: today, dms: dmList })
      ).catch(() => {})
      sent++
    }
  }

  return NextResponse.json({ ok: true, sent })
}
