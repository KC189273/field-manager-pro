import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'

const ALLOWED = ['ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

  const orgId = session.org_id
  const orgFilter = orgId ? `AND u.org_id = '${(orgId as string).replace(/'/g, "''")}'` : ''

  // Get all employee shifts for the day with uniform check results
  const shifts = await query<{
    user_id: string
    shift_id: string
    full_name: string
    username: string
    manager_name: string | null
    store_address: string | null
    clock_in_at: string
    has_photo: boolean
    uniform_result: string | null
    photo_key: string | null
    uniform_details: string | null
  }>(`
    SELECT s.user_id, s.id as shift_id, u.full_name, u.username,
           m.full_name as manager_name,
           sl.address as store_address,
           s.clock_in_at::text,
           (s.clock_in_photo_key IS NOT NULL AND s.clock_in_photo_key != '') as has_photo,
           uc.result as uniform_result,
           s.clock_in_photo_key as photo_key,
           uc.details as uniform_details
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN users m ON m.id = u.manager_id
    LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
    LEFT JOIN uniform_checks uc ON uc.shift_id = s.id
    WHERE (s.clock_in_at AT TIME ZONE 'America/Chicago')::date = $1::date
      AND u.role = 'employee'
      ${orgFilter}
    ORDER BY u.full_name, s.clock_in_at
  `, [date])

  const totalShifts = shifts.length
  const inCompliance = shifts.filter(s => s.uniform_result === 'pass').length
  const notInCompliance = shifts.filter(s => s.uniform_result === 'fail' || s.uniform_result === 'unclear').length
  const noPhoto = shifts.filter(s => !s.has_photo).length
  const pending = shifts.filter(s => s.has_photo && !s.uniform_result).length
  const complianceRate = totalShifts > 0 ? Math.round((inCompliance / totalShifts) * 100) : 0

  // Group by DM with employee detail
  interface DmEmployee { full_name: string; clock_in_at: string; store_address: string | null; uniform_result: string | null; has_photo: boolean; photo_url: string | null; uniform_details: string | null }
  const byDm: Record<string, { total: number; compliant: number; failed: number; noPhoto: number; employees: DmEmployee[] }> = {}
  for (const s of shifts) {
    const dm = s.manager_name || 'Unassigned'
    if (!byDm[dm]) byDm[dm] = { total: 0, compliant: 0, failed: 0, noPhoto: 0, employees: [] }
    byDm[dm].total++
    if (s.uniform_result === 'pass') byDm[dm].compliant++
    if (s.uniform_result === 'fail' || s.uniform_result === 'unclear') byDm[dm].failed++
    if (!s.has_photo) byDm[dm].noPhoto++
    // Only include non-compliant employees in detail
    if (s.uniform_result !== 'pass' || !s.has_photo) {
      byDm[dm].employees.push({
        full_name: s.full_name, clock_in_at: s.clock_in_at,
        store_address: s.store_address, uniform_result: s.uniform_result,
        has_photo: s.has_photo, photo_url: null, uniform_details: s.uniform_details,
      })
    }
  }

  // Generate photo URLs for non-compliant employees
  for (const dm of Object.values(byDm)) {
    for (const emp of dm.employees) {
      const shift = shifts.find(s => s.full_name === emp.full_name && s.clock_in_at === emp.clock_in_at)
      if (shift?.photo_key) {
        emp.photo_url = await getReceiptViewUrl(shift.photo_key).catch(() => null)
      }
    }
  }

  return NextResponse.json({
    date,
    totalShifts,
    inCompliance,
    notInCompliance,
    noPhoto,
    pending,
    complianceRate,
    byDm,
  })
}
