import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

interface ComplianceRow {
  store_id: string
  store_address: string
  dm_name: string | null
  week1_published_at: string | null
  week2_published_at: string | null
  max_week_start: string | null
}

function currentMonday(): string {
  const d = new Date()
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const monday = currentMonday()
  const week1 = addDays(monday, 7)   // next week
  const week2 = addDays(monday, 14)  // week after next

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = [week1, week2, monday]

  let stores: ComplianceRow[]

  if (session.role === 'manager') {
    params.push(session.id)
    stores = await query<ComplianceRow>(`
      SELECT
        l.id AS store_id,
        l.address AS store_address,
        $5::text AS dm_name,
        p1.published_at AS week1_published_at,
        p2.published_at AS week2_published_at,
        max_pub.max_week_start
      FROM dm_store_locations l
      JOIN dm_manager_stores ms ON ms.store_location_id = l.id AND ms.manager_id = $4
      LEFT JOIN scheduled_shifts_publish p1
        ON p1.store_location_id = l.id AND p1.week_start = $1::date
      LEFT JOIN scheduled_shifts_publish p2
        ON p2.store_location_id = l.id AND p2.week_start = $2::date
      LEFT JOIN (
        SELECT store_location_id, MAX(week_start)::text AS max_week_start
        FROM scheduled_shifts_publish
        WHERE week_start >= $3::date
        GROUP BY store_location_id
      ) max_pub ON max_pub.store_location_id = l.id
      WHERE l.active = true
      ORDER BY l.address
    `, [...params, session.fullName])
  } else {
    // ops_manager, owner, sales_director, developer — all stores
    let orgWhere = ''
    if (orgFilter.filterByOrg) {
      if (orgFilter.orgId) {
        params.push(orgFilter.orgId)
        orgWhere = ` AND l.org_id = $${params.length}`
      } else {
        orgWhere = ` AND l.org_id IS NULL`
      }
    }

    stores = await query<ComplianceRow>(`
      SELECT DISTINCT ON (l.id)
        l.id AS store_id,
        l.address AS store_address,
        u.full_name AS dm_name,
        p1.published_at AS week1_published_at,
        p2.published_at AS week2_published_at,
        max_pub.max_week_start
      FROM dm_store_locations l
      LEFT JOIN dm_manager_stores ms ON ms.store_location_id = l.id
      LEFT JOIN users u ON u.id = ms.manager_id AND u.role = 'manager'
      LEFT JOIN scheduled_shifts_publish p1
        ON p1.store_location_id = l.id AND p1.week_start = $1::date
      LEFT JOIN scheduled_shifts_publish p2
        ON p2.store_location_id = l.id AND p2.week_start = $2::date
      LEFT JOIN (
        SELECT store_location_id, MAX(week_start)::text AS max_week_start
        FROM scheduled_shifts_publish
        WHERE week_start >= $3::date
        GROUP BY store_location_id
      ) max_pub ON max_pub.store_location_id = l.id
      WHERE l.active = true${orgWhere}
      ORDER BY l.id, u.full_name NULLS LAST
    `, params)
  }

  return NextResponse.json({ week1, week2, stores })
}
