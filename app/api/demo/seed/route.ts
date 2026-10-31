import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import crypto from 'crypto'

// Use unprepared queries to avoid PgBouncer prepared statement conflicts
import { Pool as DirectPool } from 'pg'

// Use a direct connection (port 5432) for seeding to avoid PgBouncer prepared statement issues
const directUrl = (process.env.DATABASE_URL ?? '').replace(':6543/', ':5432/')
const directPool = new DirectPool({
  connectionString: directUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
})

async function q<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  if (!params?.length) {
    const res = await directPool.query(text)
    return res.rows as T[]
  }
  // Inline params to avoid prepared statement type conflicts
  let sql = text
  for (let i = params.length; i >= 1; i--) {
    const v = params[i - 1]
    const escaped = v === null ? 'NULL'
      : typeof v === 'number' ? String(v)
      : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE')
      : `'${String(v).replace(/'/g, "''")}'`
    sql = sql.replace(new RegExp(`\\$${i}`, 'g'), escaped)
  }
  const res = await directPool.query(sql)
  return res.rows as T[]
}

const DEMO_ORG_ID = 'd8d9b6e9-c706-42ea-87fe-b4f2e08727b7'
const CST = 'America/Chicago'

// Milwaukee store locations (real addresses)
const STORES = [
  { address: '100 E Wisconsin Ave Milwaukee WI', lat: 43.0389, lng: -87.9065, name: 'Downtown' },
  { address: '2500 N Mayfair Rd Wauwatosa WI', lat: 43.0546, lng: -88.0608, name: 'Mayfair' },
  { address: '5700 S 27th St Greenfield WI', lat: 42.9335, lng: -87.9651, name: 'Greenfield' },
  { address: '8501 W Brown Deer Rd Milwaukee WI', lat: 43.1680, lng: -88.0118, name: 'Brown Deer' },
  { address: '3401 S 76th St Milwaukee WI', lat: 42.9801, lng: -87.9987, name: 'West Allis' },
]

// Demo employees
const EMPLOYEES = [
  // DM 1 team
  { username: 'demo_dm1', name: 'Sarah Chen', role: 'manager', email: 'demo.dm1@acmefield.demo' },
  { username: 'demo_emp1', name: 'Marcus Johnson', role: 'employee', email: 'demo.emp1@acmefield.demo', mgr: 0 },
  { username: 'demo_emp2', name: 'Emily Rodriguez', role: 'employee', email: 'demo.emp2@acmefield.demo', mgr: 0 },
  { username: 'demo_emp3', name: 'Tyler Washington', role: 'employee', email: 'demo.emp3@acmefield.demo', mgr: 0 },
  { username: 'demo_emp4', name: 'Aisha Patel', role: 'employee', email: 'demo.emp4@acmefield.demo', mgr: 0 },
  { username: 'demo_emp5', name: 'Jordan Rivera', role: 'employee', email: 'demo.emp5@acmefield.demo', mgr: 0 },
  // DM 2 team
  { username: 'demo_dm2', name: 'Michael Brooks', role: 'manager', email: 'demo.dm2@acmefield.demo' },
  { username: 'demo_emp6', name: 'Lisa Nguyen', role: 'employee', email: 'demo.emp6@acmefield.demo', mgr: 1 },
  { username: 'demo_emp7', name: 'David Morales', role: 'employee', email: 'demo.emp7@acmefield.demo', mgr: 1 },
  { username: 'demo_emp8', name: 'Brittany Foster', role: 'employee', email: 'demo.emp8@acmefield.demo', mgr: 1 },
  { username: 'demo_emp9', name: 'Kevin Lee', role: 'employee', email: 'demo.emp9@acmefield.demo', mgr: 1 },
  // Field tech (installer) — bounces between locations
  { username: 'demo_tech1', name: 'Carlos Ramirez', role: 'employee', email: 'demo.tech1@acmefield.demo', mgr: 0 },
  // Owner
  { username: 'demo_owner', name: 'Alex Thompson', role: 'owner', email: 'demo.owner@acmefield.demo' },
  // Ops Manager
  { username: 'demo_ops', name: 'Rachel Kim', role: 'ops_manager', email: 'demo.ops@acmefield.demo' },
]

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(pw).digest('hex')
}

// Generate GPS breadcrumbs along a route between stores
function generateBreadcrumbs(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  startTime: Date, durationMin: number,
  count: number
): Array<{ lat: number; lng: number; time: Date }> {
  const points: Array<{ lat: number; lng: number; time: Date }> = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    // Add slight randomness to simulate real GPS
    const jitterLat = (Math.random() - 0.5) * 0.0003
    const jitterLng = (Math.random() - 0.5) * 0.0003
    points.push({
      lat: fromLat + (toLat - fromLat) * t + jitterLat,
      lng: fromLng + (toLng - fromLng) * t + jitterLng,
      time: new Date(startTime.getTime() + (durationMin * 60000 * t)),
    })
  }
  return points
}

function cstDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toLocaleDateString('en-CA', { timeZone: CST })
}

function cstDateTime(daysAgo: number, hours: number, minutes: number): Date {
  const dateStr = cstDate(daysAgo)
  // Create a date in CST by adding UTC offset
  const d = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`)
  // Approximate CST offset (CDT = UTC-5, CST = UTC-6)
  const offset = d.getMonth() >= 2 && d.getMonth() <= 10 ? 5 : 6
  return new Date(d.getTime() + offset * 3600000)
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ── Clean existing demo data ──
    await q(`DELETE FROM gps_breadcrumbs WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM shift_breaks WHERE shift_id IN (SELECT id FROM shifts WHERE user_id IN (SELECT id FROM users WHERE org_id = $1))`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM shifts WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM scheduled_shifts WHERE org_id = $1`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE org_id = $1)`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM chat_conversation_members WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE org_id = $1)`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM chat_conversations WHERE org_id = $1`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM flags WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM dm_manager_stores WHERE manager_id IN (SELECT id FROM users WHERE org_id = $1)`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM dm_store_locations WHERE org_id = $1`, [DEMO_ORG_ID]).catch(() => {})
    await q(`DELETE FROM users WHERE org_id = $1 AND role != 'prospect'`, [DEMO_ORG_ID]).catch(() => {})

    // ── Create stores ──
    const storeIds: string[] = []
    for (const s of STORES) {
      const [row] = await q<{ id: string }>(`
        INSERT INTO dm_store_locations (org_id, address, lat, lng, active)
        VALUES ($1, $2, $3, $4, TRUE) RETURNING id
      `, [DEMO_ORG_ID, s.address, s.lat, s.lng])
      storeIds.push(row.id)
    }

    // ── Create store hours (Mon-Sat 9am-9pm, Sun 10am-6pm) ──
    for (const storeId of storeIds) {
      await q(`DELETE FROM store_hours WHERE store_id = $1`, [storeId]).catch(() => {})
      for (let dow = 0; dow <= 6; dow++) {
        const isSun = dow === 0
        await q(`
          INSERT INTO store_hours (store_id, day_of_week, open_time, close_time, is_closed)
          VALUES ($1, $2, $3, $4, FALSE)
        `, [storeId, dow, isSun ? '10:00' : '09:00', isSun ? '18:00' : '21:00']).catch(() => {})
      }
    }

    // ── Create users ──
    const userIds: string[] = []
    const dmIds: string[] = []
    const pw = hashPassword('DemoPass1!')

    for (const emp of EMPLOYEES) {
      const [row] = await q<{ id: string }>(`
        INSERT INTO users (org_id, username, password_hash, full_name, legal_name, email, role, is_active)
        VALUES ($1, $2, $3, $4, $4, $5, $6, TRUE) RETURNING id
      `, [DEMO_ORG_ID, emp.username, pw, emp.name, emp.email, emp.role])
      userIds.push(row.id)
      if (emp.role === 'manager') dmIds.push(row.id)
    }

    // Set manager_id for employees
    for (let i = 0; i < EMPLOYEES.length; i++) {
      const emp = EMPLOYEES[i]
      if ('mgr' in emp && typeof emp.mgr === 'number') {
        await q(`UPDATE users SET manager_id = $1 WHERE id = $2`, [dmIds[emp.mgr], userIds[i]])
      }
    }

    // Assign DMs their stores
    for (const sIdx of [0, 1, 2]) {
      await q(`INSERT INTO dm_manager_stores (manager_id, store_location_id) VALUES ($1, $2)`,
        [dmIds[0], storeIds[sIdx]]).catch(() => {})
    }
    for (const sIdx of [3, 4]) {
      await q(`INSERT INTO dm_manager_stores (manager_id, store_location_id) VALUES ($1, $2)`,
        [dmIds[1], storeIds[sIdx]]).catch(() => {})
    }

    // ── Generate shifts + GPS breadcrumbs for the past 7 days ──
    for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
      const dayOfWeek = new Date(Date.now() - daysAgo * 86400000).getDay()
      if (dayOfWeek === 0) continue // Skip Sundays

      // Employee shifts (at their assigned stores)
      for (let empIdx = 1; empIdx <= 5; empIdx++) { // DM1's team
        if (Math.random() > 0.8) continue // Some days off
        const storeIdx = empIdx <= 3 ? 0 : (empIdx <= 4 ? 1 : 2)
        const clockIn = cstDateTime(daysAgo, 9 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 30))
        const clockOut = new Date(clockIn.getTime() + (7 + Math.random() * 2) * 3600000)

        const [shift] = await q<{ id: string }>(`
          INSERT INTO shifts (user_id, clock_in_at, clock_out_at, store_location_id, clock_in_lat, clock_in_lng)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [userIds[empIdx], clockIn.toISOString(), clockOut?.toISOString() ?? null, storeIds[storeIdx],
            STORES[storeIdx].lat + (Math.random() - 0.5) * 0.0002,
            STORES[storeIdx].lng + (Math.random() - 0.5) * 0.0002])

        // Breadcrumbs every 3 min at the store
        const crumbCount = Math.floor((clockOut.getTime() - clockIn.getTime()) / 180000)
        for (let c = 0; c < Math.min(crumbCount, 50); c++) {
          const crumbTime = new Date(clockIn.getTime() + c * 180000)
          await q(`
            INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at)
            VALUES ($1, $2, $3, $4, $5)
          `, [shift.id, userIds[empIdx],
              STORES[storeIdx].lat + (Math.random() - 0.5) * 0.0004,
              STORES[storeIdx].lng + (Math.random() - 0.5) * 0.0004,
              crumbTime.toISOString()])
        }
      }

      // DM2's team
      for (let empIdx = 7; empIdx <= 10; empIdx++) {
        if (Math.random() > 0.8) continue
        const storeIdx = empIdx <= 9 ? 3 : 4
        const clockIn = cstDateTime(daysAgo, 9 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 30))
        const clockOut = new Date(clockIn.getTime() + (7 + Math.random() * 2) * 3600000)

        const [shift] = await q<{ id: string }>(`
          INSERT INTO shifts (user_id, clock_in_at, clock_out_at, store_location_id, clock_in_lat, clock_in_lng)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [userIds[empIdx], clockIn.toISOString(), clockOut?.toISOString() ?? null, storeIds[storeIdx],
            STORES[storeIdx].lat + (Math.random() - 0.5) * 0.0002,
            STORES[storeIdx].lng + (Math.random() - 0.5) * 0.0002])

        const crumbCount = Math.floor((clockOut.getTime() - clockIn.getTime()) / 180000)
        for (let c = 0; c < Math.min(crumbCount, 50); c++) {
          const crumbTime = new Date(clockIn.getTime() + c * 180000)
          await q(`
            INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at)
            VALUES ($1, $2, $3, $4, $5)
          `, [shift.id, userIds[empIdx],
              STORES[storeIdx].lat + (Math.random() - 0.5) * 0.0004,
              STORES[storeIdx].lng + (Math.random() - 0.5) * 0.0004,
              crumbTime.toISOString()])
        }
      }

      // DM1 — visits 2-3 stores per day with GPS trail between them
      {
        const visitStores = [0, 1, 2].filter(() => Math.random() > 0.3)
        let dmTime = cstDateTime(daysAgo, 8, 30)
        for (let v = 0; v < visitStores.length; v++) {
          const sIdx = visitStores[v]
          const arriveTime = new Date(dmTime.getTime() + 20 * 60000) // 20 min travel
          const departTime = new Date(arriveTime.getTime() + (90 + Math.random() * 60) * 60000) // 1.5-2.5 hrs at store

          const [shift] = await q<{ id: string }>(`
            INSERT INTO shifts (user_id, clock_in_at, clock_out_at, store_location_id, clock_in_lat, clock_in_lng)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
          `, [dmIds[0], (v === 0 ? cstDateTime(daysAgo, 8, 0) : arriveTime).toISOString(),
              departTime.toISOString(),
              storeIds[sIdx], STORES[sIdx].lat, STORES[sIdx].lng])

          // Travel breadcrumbs (if not first store)
          if (v > 0) {
            const prevIdx = visitStores[v - 1]
            const travelCrumbs = generateBreadcrumbs(
              STORES[prevIdx].lat, STORES[prevIdx].lng,
              STORES[sIdx].lat, STORES[sIdx].lng,
              dmTime, 20, 8
            )
            for (const c of travelCrumbs) {
              await q(`INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at) VALUES ($1,$2,$3,$4,$5)`,
                [shift.id, dmIds[0], c.lat, c.lng, c.time.toISOString()])
            }
          }

          // At-store breadcrumbs
          const storeMinutes = (departTime.getTime() - arriveTime.getTime()) / 60000
          for (let m = 0; m < storeMinutes; m += 3) {
            await q(`INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at) VALUES ($1,$2,$3,$4,$5)`,
              [shift.id, dmIds[0],
               STORES[sIdx].lat + (Math.random() - 0.5) * 0.0004,
               STORES[sIdx].lng + (Math.random() - 0.5) * 0.0004,
               new Date(arriveTime.getTime() + m * 60000).toISOString()])
          }

          dmTime = departTime
        }
      }

      // DM2 — visits stores with similar pattern
      {
        const visitStores = [3, 4].filter(() => Math.random() > 0.2)
        let dmTime = cstDateTime(daysAgo, 8, 45)
        for (let v = 0; v < visitStores.length; v++) {
          const sIdx = visitStores[v]
          const arriveTime = new Date(dmTime.getTime() + 25 * 60000)
          const departTime = new Date(arriveTime.getTime() + (100 + Math.random() * 60) * 60000)

          const [shift] = await q<{ id: string }>(`
            INSERT INTO shifts (user_id, clock_in_at, clock_out_at, store_location_id, clock_in_lat, clock_in_lng)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
          `, [dmIds[1], (v === 0 ? cstDateTime(daysAgo, 8, 15) : arriveTime).toISOString(),
              departTime.toISOString(),
              storeIds[sIdx], STORES[sIdx].lat, STORES[sIdx].lng])

          if (v > 0) {
            const prevIdx = visitStores[v - 1]
            const travelCrumbs = generateBreadcrumbs(
              STORES[prevIdx].lat, STORES[prevIdx].lng,
              STORES[sIdx].lat, STORES[sIdx].lng,
              dmTime, 25, 10
            )
            for (const c of travelCrumbs) {
              await q(`INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at) VALUES ($1,$2,$3,$4,$5)`,
                [shift.id, dmIds[1], c.lat, c.lng, c.time.toISOString()])
            }
          }

          const storeMinutes = (departTime.getTime() - arriveTime.getTime()) / 60000
          for (let m = 0; m < storeMinutes; m += 3) {
            await q(`INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at) VALUES ($1,$2,$3,$4,$5)`,
              [shift.id, dmIds[1],
               STORES[sIdx].lat + (Math.random() - 0.5) * 0.0004,
               STORES[sIdx].lng + (Math.random() - 0.5) * 0.0004,
               new Date(arriveTime.getTime() + m * 60000).toISOString()])
          }

          dmTime = departTime
        }
      }

      // Field tech — bounces between ALL stores
      {
        const techStores = [0, 2, 4, 1, 3].slice(0, 2 + Math.floor(Math.random() * 3))
        let techTime = cstDateTime(daysAgo, 7, 30)
        for (let v = 0; v < techStores.length; v++) {
          const sIdx = techStores[v]
          const arriveTime = new Date(techTime.getTime() + 15 * 60000)
          const departTime = new Date(arriveTime.getTime() + (45 + Math.random() * 60) * 60000)

          const [shift] = await q<{ id: string }>(`
            INSERT INTO shifts (user_id, clock_in_at, clock_out_at, store_location_id, clock_in_lat, clock_in_lng)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
          `, [userIds[11], (v === 0 ? cstDateTime(daysAgo, 7, 15) : arriveTime).toISOString(),
              departTime.toISOString(),
              storeIds[sIdx], STORES[sIdx].lat, STORES[sIdx].lng])

          if (v > 0) {
            const prevIdx = techStores[v - 1]
            const travelCrumbs = generateBreadcrumbs(
              STORES[prevIdx].lat, STORES[prevIdx].lng,
              STORES[sIdx].lat, STORES[sIdx].lng,
              techTime, 15, 6
            )
            for (const c of travelCrumbs) {
              await q(`INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at) VALUES ($1,$2,$3,$4,$5)`,
                [shift.id, userIds[11], c.lat, c.lng, c.time.toISOString()])
            }
          }

          const storeMinutes = (departTime.getTime() - arriveTime.getTime()) / 60000
          for (let m = 0; m < storeMinutes; m += 3) {
            await q(`INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at) VALUES ($1,$2,$3,$4,$5)`,
              [shift.id, userIds[11],
               STORES[sIdx].lat + (Math.random() - 0.5) * 0.0005,
               STORES[sIdx].lng + (Math.random() - 0.5) * 0.0005,
               new Date(arriveTime.getTime() + m * 60000).toISOString()])
          }

          techTime = departTime
        }
      }
    }

    // ── Create a demo chat conversation ──
    const [chat] = await q<{ id: string }>(`
      INSERT INTO chat_conversations (org_id, name, type, created_by)
      VALUES ($1, 'Team Chat', 'group', $2) RETURNING id
    `, [DEMO_ORG_ID, dmIds[0]])

    // Add all users to the chat
    for (const uid of userIds) {
      await q(`INSERT INTO chat_conversation_members (conversation_id, user_id) VALUES ($1, $2)`, [chat.id, uid]).catch(() => {})
    }

    // Sample messages
    const messages = [
      { user: 0, text: 'Good morning team! Remember to check the schedule for any updates today.' },
      { user: 1, text: 'Morning! Just opened up Downtown, ready to go.' },
      { user: 3, text: 'Hey, can someone cover my lunch break at Mayfair around 1pm?' },
      { user: 4, text: 'I can cover! I\'ll head over after my morning tasks.' },
      { user: 6, text: 'Brown Deer is looking good today. All displays updated.' },
      { user: 0, text: 'Great work everyone. Don\'t forget to submit your checklists before close.' },
    ]

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const msgTime = new Date(Date.now() - (6 - i) * 3600000)
      await q(`
        INSERT INTO chat_messages (conversation_id, sender_id, body, created_at)
        VALUES ($1, $2, $3, $4)
      `, [chat.id, userIds[msg.user], msg.text, msgTime.toISOString()])
    }

    // Count created data
    const counts = await q<{ table_name: string; count: string }>(`
      SELECT 'users' as table_name, COUNT(*)::text as count FROM users WHERE org_id = $1
      UNION ALL
      SELECT 'stores', COUNT(*)::text FROM dm_store_locations WHERE org_id = $1
      UNION ALL
      SELECT 'shifts', COUNT(*)::text FROM shifts WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)
      UNION ALL
      SELECT 'breadcrumbs', COUNT(*)::text FROM gps_breadcrumbs WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)
    `, [DEMO_ORG_ID])

    await directPool.end().catch(() => {})

    return NextResponse.json({
      ok: true,
      orgId: DEMO_ORG_ID,
      stores: storeIds.length,
      users: userIds.length,
      counts: Object.fromEntries(counts.map(c => [c.table_name, parseInt(c.count)])),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : ''
    console.error('Demo seed error:', msg, stack)
    await directPool.end().catch(() => {})
    return NextResponse.json({ error: msg, stack }, { status: 500 })
  }
}
