import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { overstaffingAlertHtml } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS overstaffing_alerts (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_location_id UUID NOT NULL,
      shift_ids        TEXT NOT NULL,
      alerted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (store_location_id, shift_ids)
    )
  `)
}

export async function GET() {
  // Only run after 2 PM CST / CDT
  const nowCentral = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })
  const centralHour = new Date(nowCentral).getHours()
  if (centralHour < 14) {
    return NextResponse.json({ ok: true, skipped: 'before 2 PM CST' })
  }

  try { await ensureTable() } catch { /* already exists */ }

  // Find 1-capacity stores with 2+ employees clocked in for >1 hour simultaneously
  const overstaffedStores = await query<{ store_location_id: string; store_address: string }>(
    `SELECT s.store_location_id, dsl.address AS store_address
     FROM shifts s
     JOIN dm_store_locations dsl ON dsl.id = s.store_location_id
     WHERE s.clock_out_at IS NULL
       AND s.clock_in_at IS NOT NULL
       AND s.clock_in_at <= NOW() - INTERVAL '1 hour'
       AND dsl.employee_capacity = 1
       AND dsl.active = true
     GROUP BY s.store_location_id, dsl.address
     HAVING COUNT(*) >= 2`
  )

  let alerted = 0
  for (const store of overstaffedStores) {
    // Get the specific shifts that are overstaffing this store
    const shifts = await query<{ id: string; user_id: string; full_name: string }>(
      `SELECT s.id, s.user_id, u.full_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.store_location_id = $1
         AND s.clock_out_at IS NULL
         AND s.clock_in_at IS NOT NULL
         AND s.clock_in_at <= NOW() - INTERVAL '1 hour'
       ORDER BY s.id ASC`,
      [store.store_location_id]
    )

    if (shifts.length < 2) continue

    // Dedup key: sorted shift IDs
    const shiftKey = shifts.map(s => s.id).sort().join(',')

    const existing = await queryOne(
      `SELECT id FROM overstaffing_alerts WHERE store_location_id = $1 AND shift_ids = $2`,
      [store.store_location_id, shiftKey]
    )
    if (existing) continue

    // Find the DM assigned to this store
    const dm = await queryOne<{ id: string; email: string; full_name: string }>(
      `SELECT u.id, u.email, u.full_name
       FROM users u
       JOIN dm_manager_stores dms ON dms.manager_id = u.id
       WHERE dms.store_location_id = $1 AND u.is_active = true
       LIMIT 1`,
      [store.store_location_id]
    )
    if (!dm) continue

    // Record alert before sending (prevent duplicate sends if one fails)
    try {
      await query(
        `INSERT INTO overstaffing_alerts (store_location_id, shift_ids) VALUES ($1, $2)`,
        [store.store_location_id, shiftKey]
      )
    } catch { continue } // unique constraint — already alerted

    const names = shifts.map(s => s.full_name).join(' and ')
    const shortAddress = store.store_address.split(',')[0]

    sendEmail(
      dm.email,
      `FMP: Overstaffing Alert — ${shortAddress}`,
      overstaffingAlertHtml(dm.full_name, store.store_address, names)
    ).catch(() => {})

    sendPushToUser(
      dm.id,
      'Overstaffing Alert',
      `${shortAddress} — ${names} both clocked in over 1 hr. One needs sent home.`,
      'flag_created'
    ).catch(() => {})

    alerted++
  }

  return NextResponse.json({ ok: true, alerted, checked: overstaffedStores.length })
}
