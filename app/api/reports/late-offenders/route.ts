import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { query } from '@/lib/db'

const ALLOWED = ['manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const dmId = searchParams.get('dmId')
  const days = Math.min(parseInt(searchParams.get('days') || '30') || 30, 90)

  const canViewAll = ['ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)
  const effectiveDmId = canViewAll ? dmId : session.id

  try {
    let offenders: Array<{
      user_id: string; employee_name: string; manager_id: string | null
      dm_name: string | null; late_count: number; avg_minutes_late: number
      first_late: string; last_late: string
    }>

    if (effectiveDmId) {
      offenders = await query(`
        SELECT f.user_id, u.full_name as employee_name, u.manager_id,
          dm.full_name as dm_name,
          COUNT(*)::int as late_count,
          0 as avg_minutes_late,
          MIN(f.date)::text as first_late,
          MAX(f.date)::text as last_late
        FROM flags f
        JOIN users u ON u.id = f.user_id
        LEFT JOIN users dm ON dm.id = u.manager_id
        WHERE f.type = 'late_clock_in'
          AND f.date >= CURRENT_DATE - $1::int
          AND u.manager_id = $2
          AND u.is_active = TRUE
        GROUP BY f.user_id, u.full_name, u.manager_id, dm.full_name
        HAVING COUNT(*) >= 2
        ORDER BY COUNT(*) DESC, u.full_name
      `, [days, effectiveDmId])
    } else {
      const orgFilter = session.org_id
        ? `AND u.org_id = '${(session.org_id as string).replace(/'/g, "''")}'`
        : ''
      offenders = await query(`
        SELECT f.user_id, u.full_name as employee_name, u.manager_id,
          dm.full_name as dm_name,
          COUNT(*)::int as late_count,
          0 as avg_minutes_late,
          MIN(f.date)::text as first_late,
          MAX(f.date)::text as last_late
        FROM flags f
        JOIN users u ON u.id = f.user_id
        LEFT JOIN users dm ON dm.id = u.manager_id
        WHERE f.type = 'late_clock_in'
          AND f.date >= CURRENT_DATE - $1::int
          AND u.is_active = TRUE
          ${orgFilter}
        GROUP BY f.user_id, u.full_name, u.manager_id, dm.full_name
        HAVING COUNT(*) >= 2
        ORDER BY COUNT(*) DESC, u.full_name
      `, [days])
    }

    // Calculate avg minutes late from detail text for each offender
    if (offenders.length > 0) {
      const userIds = offenders.map(o => o.user_id)
      const avgMins = await query<{ user_id: string; avg_min: number }>(`
        SELECT f.user_id,
          ROUND(AVG(
            CASE WHEN f.detail LIKE '%min late%'
              THEN CAST(SUBSTRING(f.detail FROM '([0-9]+) min') AS int)
              ELSE 0 END
          ))::int as avg_min
        FROM flags f
        WHERE f.user_id = ANY($1) AND f.type = 'late_clock_in' AND f.date >= CURRENT_DATE - $2::int
        GROUP BY f.user_id
      `, [userIds, days]).catch(() => [])
      const avgMap = new Map(avgMins.map(a => [a.user_id, a.avg_min]))
      for (const o of offenders) {
        o.avg_minutes_late = avgMap.get(o.user_id) || 0
      }
    }

    if (!offenders.length) {
      // Still return DMs for filter dropdown
      const dms = canViewAll ? await query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM users WHERE role = 'manager' AND is_active = TRUE ${session.org_id ? `AND org_id = '${(session.org_id as string).replace(/'/g, "''")}'` : ''} ORDER BY full_name`
      ) : []
      return NextResponse.json({ offenders: [], dms })
    }

    const userIds = offenders.map(o => o.user_id)

    // Get time edit counts per employee
    const edits = await query<{ user_id: string; edit_count: number }>(`
      SELECT s.user_id, COUNT(se.id)::int as edit_count
      FROM shift_edits se
      JOIN shifts s ON s.id = se.shift_id
      WHERE s.user_id = ANY($1)
        AND se.edited_at > NOW() - make_interval(days => $2)
        AND se.edited_by != s.user_id
      GROUP BY s.user_id
    `, [userIds, days]).catch(() => [])
    const editMap = new Map(edits.map(e => [e.user_id, e.edit_count]))

    // Get last accountability doc per employee
    const docs = await query<{
      subject_id: string; level: string; created_at: string; status: string
    }>(`
      SELECT DISTINCT ON (subject_id) subject_id, level, created_at::text, status
      FROM accountability_docs
      WHERE subject_id = ANY($1)
      ORDER BY subject_id, created_at DESC
    `, [userIds]).catch(() => [])
    const docMap = new Map(docs.map(d => [d.subject_id, d]))

    // Build response
    const LEVEL_ORDER = ['documented_conversation', 'verbal', 'written', 'final']
    const result = offenders.map(o => {
      const lastDoc = docMap.get(o.user_id)
      const currentLevel = lastDoc?.level || null
      const currentIdx = currentLevel ? LEVEL_ORDER.indexOf(currentLevel) : -1
      const nextLevel = currentIdx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[currentIdx + 1] : 'final'

      return {
        user_id: o.user_id,
        employee_name: o.employee_name,
        dm_name: o.dm_name,
        dm_id: o.manager_id,
        late_count: Number(o.late_count),
        avg_minutes_late: Number(o.avg_minutes_late),
        first_late: o.first_late,
        last_late: o.last_late,
        edit_count: editMap.get(o.user_id) || 0,
        last_doc_level: lastDoc?.level || null,
        last_doc_status: lastDoc?.status || null,
        last_doc_date: lastDoc?.created_at || null,
        next_recommended_level: nextLevel,
      }
    })

    // DM list for filter
    const dms = canViewAll ? await query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM users WHERE role = 'manager' AND is_active = TRUE ${session.org_id ? `AND org_id = '${(session.org_id as string).replace(/'/g, "''")}'` : ''} ORDER BY full_name`
    ) : []

    return NextResponse.json({ offenders: result, dms })
  } catch (err) {
    console.error('Late offenders error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — detail for a specific employee
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, days: daysParam } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const days = Math.min(parseInt(daysParam || '30') || 30, 90)

  try {
    const lates = await query<{
      date: string; detail: string; shift_id: string | null
      clock_in_at: string | null; scheduled_start: string | null
      clock_in_photo_key: string | null
    }>(`
      SELECT f.date::text, f.detail, f.shift_id,
        s.clock_in_at::text,
        (SELECT ss.start_time::text FROM scheduled_shifts ss
         WHERE ss.employee_id = $1 AND ss.shift_date = f.date
         LIMIT 1) as scheduled_start,
        s.clock_in_photo_key
      FROM flags f
      LEFT JOIN shifts s ON s.id = f.shift_id
      WHERE f.user_id = $1 AND f.type = 'late_clock_in' AND f.date >= CURRENT_DATE - $2::int
      ORDER BY f.date DESC
    `, [userId, days])

    // Generate signed photo URLs
    const { getReceiptViewUrl } = await import('@/lib/s3')
    const latesWithPhotos = await Promise.all(lates.map(async l => ({
      date: l.date,
      detail: l.detail,
      clock_in_at: l.clock_in_at,
      scheduled_start: l.scheduled_start,
      photo_url: l.clock_in_photo_key
        ? await getReceiptViewUrl(l.clock_in_photo_key).catch(() => null)
        : null,
    })))

    const edits = await query<{
      edited_at: string; edited_by_name: string
      old_clock_in: string | null; new_clock_in: string | null
      old_clock_out: string | null; new_clock_out: string | null
      note: string | null
    }>(`
      SELECT se.edited_at::text,
        (SELECT full_name FROM users WHERE id = se.edited_by) as edited_by_name,
        se.old_clock_in::text, se.new_clock_in::text,
        se.old_clock_out::text, se.new_clock_out::text,
        se.note
      FROM shift_edits se
      JOIN shifts s ON s.id = se.shift_id
      WHERE s.user_id = $1
        AND se.edited_at > NOW() - make_interval(days => $2)
        AND se.edited_by != s.user_id
      ORDER BY se.edited_at DESC
    `, [userId, days])

    return NextResponse.json({ lates: latesWithPhotos, edits })
  } catch (err) {
    console.error('Late detail error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
