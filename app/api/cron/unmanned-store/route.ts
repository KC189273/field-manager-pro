import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'

// Runs every 30 min during business hours (9AM-9PM CST via vercel.json)
// Checks if any active store has no one clocked in during its open hours
// 15-min grace after open, 2-hour cooldown per store

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Ensure cooldown table exists
    await query(`
      CREATE TABLE IF NOT EXISTS unmanned_store_alerts (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id   UUID NOT NULL,
        alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {})
    await query(`CREATE INDEX IF NOT EXISTS idx_unmanned_alerts_store ON unmanned_store_alerts(store_id)`).catch(() => {})

    // Current time in CST
    const nowCST = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })
    const cstDate = new Date(nowCST)
    const dayOfWeek = cstDate.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
    const currentTime = cstDate.toTimeString().slice(0, 5) // HH:MM

    // Get all active stores with hours for today that are open
    const stores = await query<{
      id: string; address: string; org_id: string | null
      open_time: string; close_time: string
    }>(
      `SELECT s.id, s.address, s.org_id, h.open_time::text, h.close_time::text
       FROM dm_store_locations s
       JOIN store_hours h ON h.store_id = s.id
       WHERE s.active = TRUE
         AND h.day_of_week = $1
         AND h.is_closed = FALSE
         AND h.open_time IS NOT NULL
         AND h.close_time IS NOT NULL
         AND s.id NOT IN (SELECT store_id FROM store_closures WHERE closure_date = CURRENT_DATE)`,
      [dayOfWeek]
    )

    if (!stores.length) {
      return NextResponse.json({ ok: true, checked: 0, alerts: 0 })
    }

    // Filter to stores currently within open hours (with 15-min grace after open)
    function addMinutes(time: string, mins: number): string {
      const [h, m] = time.split(':').map(Number)
      const total = h * 60 + m + mins
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    }

    const openStores = stores.filter(s => {
      const graceTime = addMinutes(s.open_time, 15)
      return currentTime >= graceTime && currentTime <= s.close_time
    })

    if (!openStores.length) {
      return NextResponse.json({ ok: true, checked: 0, alerts: 0, note: 'No stores past grace period' })
    }

    // Check which of these stores have someone clocked in OR a DM scheduled for coverage
    const storeIds = openStores.map(s => s.id)
    const clockedIn = await query<{ store_location_id: string }>(
      `SELECT DISTINCT store_location_id FROM shifts
       WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL
         AND store_location_id = ANY($1)`,
      [storeIds]
    )
    // Also check if a DM is scheduled at these stores today (DM coverage counts)
    const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const dmScheduled = await query<{ store_location_id: string }>(
      `SELECT DISTINCT store_location_id FROM scheduled_shifts
       WHERE store_location_id = ANY($1)
         AND shift_date = $2
         AND is_dm_shift = TRUE`,
      [storeIds, todayCST]
    ).catch(() => [] as { store_location_id: string }[])
    const coveredIds = new Set([
      ...clockedIn.map(r => r.store_location_id),
      ...dmScheduled.map(r => r.store_location_id),
    ])
    const unmanned = openStores.filter(s => !coveredIds.has(s.id))

    if (!unmanned.length) {
      return NextResponse.json({ ok: true, checked: openStores.length, alerts: 0 })
    }

    // Check cooldown — skip stores alerted within last 2 hours
    const recentAlerts = await query<{ store_id: string }>(
      `SELECT DISTINCT store_id FROM unmanned_store_alerts
       WHERE store_id = ANY($1) AND alerted_at > NOW() - INTERVAL '2 hours'`,
      [unmanned.map(s => s.id)]
    )
    const coolingDown = new Set(recentAlerts.map(r => r.store_id))
    const toAlert = unmanned.filter(s => !coolingDown.has(s.id))

    if (!toAlert.length) {
      return NextResponse.json({ ok: true, checked: openStores.length, alerts: 0, note: `${unmanned.length} unmanned but in cooldown` })
    }

    // Find DMs assigned to each store + leadership
    let alertsSent = 0
    for (const store of toAlert) {
      // Record cooldown
      await query(
        `INSERT INTO unmanned_store_alerts (store_id) VALUES ($1)`,
        [store.id]
      )

      // Find assigned DMs
      const dms = await query<{ id: string; full_name: string; email: string }>(
        `SELECT u.id, u.full_name, u.email FROM users u
         JOIN dm_manager_stores ms ON ms.manager_id = u.id
         WHERE ms.store_location_id = $1 AND u.is_active = TRUE`,
        [store.id]
      )

      // Find leadership (ops managers, owners, developers in same org)
      const leaders = store.org_id ? await query<{ id: string; email: string }>(
        `SELECT id, email FROM users
         WHERE org_id = $1 AND is_active = TRUE AND role IN ('ops_field_leader','ops_manager','owner','developer')`,
        [store.org_id]
      ) : []

      const fmtCurrent = formatTimeAmPm(currentTime)
      const fmtOpen = formatTimeAmPm(store.open_time)
      const fmtClose = formatTimeAmPm(store.close_time)

      // Push to DMs
      const pushPromises: Promise<void>[] = []
      for (const dm of dms) {
        pushPromises.push(
          sendPushToUser(dm.id, 'Unmanned Store Alert',
            `${store.address} has no one clocked in. Store hours: ${fmtOpen}-${fmtClose}. Current time: ${fmtCurrent}.`,
            'flags'
          ).catch(() => {})
        )
      }

      // Push to leadership
      if (leaders.length) {
        pushPromises.push(
          sendPushToUsers(
            leaders.map(l => l.id),
            'Unmanned Store Alert',
            `${store.address} has no one clocked in (${fmtCurrent}). ${dms.length ? `DM: ${dms.map(d => d.full_name).join(', ')}` : 'No DM assigned.'}`,
            'flags'
          ).catch(() => {})
        )
      }

      // Email to DMs + leadership
      const emailRecipients = [...dms.map(d => d.email), ...leaders.map(l => l.email)]
      if (emailRecipients.length) {
        const html = buildAlertEmail(store.address, fmtOpen, fmtClose, fmtCurrent, dms.map(d => d.full_name))
        pushPromises.push(
          sendEmail(
            emailRecipients,
            `Unmanned Store Alert — ${store.address}`,
            html
          ).catch(err => { console.error('Unmanned email failed:', err) })
        )
      }

      // Wait for all pushes + emails before moving on
      await Promise.all(pushPromises)

      alertsSent++
    }

    // Cleanup old cooldown records (>24h)
    await query(`DELETE FROM unmanned_store_alerts WHERE alerted_at < NOW() - INTERVAL '24 hours'`).catch(() => {})

    return NextResponse.json({ ok: true, checked: openStores.length, alerts: alertsSent })
  } catch (err) {
    console.error('Unmanned store check error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

function formatTimeAmPm(time: string): string {
  const [h, m] = time.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function buildAlertEmail(address: string, openTime: string, closeTime: string, currentTime: string, dmNames: string[]): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e5e7eb;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d1d5db;border-radius:12px;overflow:hidden;">

  <tr><td style="background:#991b1b;padding:20px 28px;">
    <h1 style="color:#ffffff;margin:0;font-size:18px;font-family:'Arial',sans-serif;">Unmanned Store Alert</h1>
    <p style="color:#fecaca;margin:4px 0 0;font-size:13px;font-family:'Arial',sans-serif;">No one is clocked in during business hours</p>
  </td></tr>

  <tr><td style="padding:24px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e5e7eb;width:120px;font-family:'Arial',sans-serif;">Store</td>
        <td style="padding:10px 14px;font-size:14px;color:#111827;font-weight:600;font-family:'Arial',sans-serif;">${address}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e5e7eb;border-top:1px solid #e5e7eb;font-family:'Arial',sans-serif;">Store Hours</td>
        <td style="padding:10px 14px;font-size:14px;color:#111827;border-top:1px solid #e5e7eb;font-family:'Arial',sans-serif;">${openTime} – ${closeTime}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 14px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e5e7eb;border-top:1px solid #e5e7eb;font-family:'Arial',sans-serif;">Alert Time</td>
        <td style="padding:10px 14px;font-size:14px;color:#dc2626;font-weight:600;border-top:1px solid #e5e7eb;font-family:'Arial',sans-serif;">${currentTime} CST</td>
      </tr>
      ${dmNames.length ? `<tr>
        <td style="padding:10px 14px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e5e7eb;border-top:1px solid #e5e7eb;font-family:'Arial',sans-serif;">Assigned DM</td>
        <td style="padding:10px 14px;font-size:14px;color:#111827;border-top:1px solid #e5e7eb;font-family:'Arial',sans-serif;">${dmNames.join(', ')}</td>
      </tr>` : ''}
    </table>

    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;">
      <p style="font-size:13px;color:#991b1b;margin:0;line-height:1.6;font-family:'Arial',sans-serif;">
        <strong>Action Required:</strong> This store has no employees clocked in during scheduled business hours.
        Please ensure coverage is arranged immediately. This alert will not repeat for 2 hours.
      </p>
    </div>
  </td></tr>

  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 28px;">
    <p style="font-size:11px;color:#9ca3af;margin:0;font-family:'Arial',sans-serif;">
      Field Manager Pro — Automated Store Monitoring
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}
