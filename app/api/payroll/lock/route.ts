import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

const ALLOWED_ROLES = ['ops_manager', 'owner', 'developer']

// GET — check lock status for a period
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const periodId = searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ error: 'periodId required' }, { status: 400 })

  const locks = await query<{ dm_id: string; dm_name: string; approved_at: string }>(`
    SELECT pda.dm_id, u.full_name as dm_name, pda.approved_at::text
    FROM payroll_dm_approvals pda
    JOIN users u ON u.id = pda.dm_id
    WHERE pda.period_id = $1
    ORDER BY u.full_name
  `, [periodId])

  return NextResponse.json({ locks })
}

// POST — lock or unlock timecards
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { periodId, dmId, action } = await req.json()
  if (!periodId || !action) return NextResponse.json({ error: 'periodId and action required' }, { status: 400 })
  if (!['unlock', 'lock', 'unlock_all', 'lock_all'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Verify the period exists
  const period = await queryOne<{ id: string; period_start: string; period_end: string }>(`
    SELECT id, period_start::text, period_end::text FROM payroll_periods WHERE id = $1
  `, [periodId])
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const fmtPeriod = (s: string, e: string) => {
    const start = new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const end = new Date(e + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${start} – ${end}`
  }
  const periodLabel = fmtPeriod(period.period_start, period.period_end)

  if (action === 'unlock' && dmId) {
    // Unlock a specific DM
    await query(`DELETE FROM payroll_dm_approvals WHERE period_id = $1 AND dm_id = $2`, [periodId, dmId])

    // Notify DM
    const dm = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [dmId])
    sendPushToUser(dmId, 'Timecards Unlocked',
      `Your timecards for ${periodLabel} have been unlocked by ${session.fullName}. You can now make edits.`,
      'payroll'
    ).catch(() => {})

    return NextResponse.json({ ok: true, action: 'unlock', dm: dm?.full_name })
  }

  if (action === 'lock' && dmId) {
    // Lock a specific DM
    await query(`
      INSERT INTO payroll_dm_approvals (period_id, dm_id)
      VALUES ($1, $2)
      ON CONFLICT (period_id, dm_id) DO NOTHING
    `, [periodId, dmId])

    sendPushToUser(dmId, 'Timecards Locked',
      `Your timecards for ${periodLabel} have been locked by ${session.fullName}.`,
      'payroll'
    ).catch(() => {})

    const dm = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [dmId])
    return NextResponse.json({ ok: true, action: 'lock', dm: dm?.full_name })
  }

  if (action === 'unlock_all') {
    // Unlock ALL DMs for this period
    const deleted = await query(`DELETE FROM payroll_dm_approvals WHERE period_id = $1 RETURNING dm_id`, [periodId])

    // Notify all affected DMs
    for (const row of deleted) {
      sendPushToUser(row.dm_id as string, 'Timecards Unlocked',
        `All timecards for ${periodLabel} have been unlocked by ${session.fullName}.`,
        'payroll'
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, action: 'unlock_all', count: deleted.length })
  }

  if (action === 'lock_all') {
    // Lock ALL active DMs with employees
    const orgFilter = session.org_id ? `AND u.org_id = '${(session.org_id as string).replace(/'/g, "''")}'` : ''
    const dms = await query<{ id: string }>(`
      SELECT u.id FROM users u
      WHERE u.role = 'manager' AND u.is_active = TRUE
        AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)
        AND EXISTS (SELECT 1 FROM users e WHERE e.manager_id = u.id AND e.role = 'employee' AND e.is_active = TRUE)
        ${orgFilter}
    `)

    let locked = 0
    for (const dm of dms) {
      await query(`
        INSERT INTO payroll_dm_approvals (period_id, dm_id)
        VALUES ($1, $2)
        ON CONFLICT (period_id, dm_id) DO NOTHING
      `, [periodId, dm.id])
      locked++

      sendPushToUser(dm.id, 'Timecards Locked',
        `All timecards for ${periodLabel} have been locked by ${session.fullName}.`,
        'payroll'
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, action: 'lock_all', count: locked })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
