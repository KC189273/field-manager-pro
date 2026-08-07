import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getGeofenceSettings } from '@/lib/geofence'

// GET — return geofence settings for caller's org
export async function GET() {
  const session = await getSession()
  if (!session || !['owner', 'sales_director', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const settings = await getGeofenceSettings(session.org_id)
  return NextResponse.json({ settings })
}

// PATCH — update geofence settings for caller's org
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !['owner', 'sales_director', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!session.org_id) {
    return NextResponse.json({ error: 'No organization assigned' }, { status: 400 })
  }

  const { enabled, radius_ft, exit_minutes } = await req.json()

  const updates: string[] = []
  const params: (boolean | number | string)[] = []
  let idx = 1

  if (typeof enabled === 'boolean') {
    updates.push(`geofence_enabled = $${idx++}`)
    params.push(enabled)
  }
  if (typeof radius_ft === 'number' && radius_ft >= 50 && radius_ft <= 2000) {
    updates.push(`geofence_radius_ft = $${idx++}`)
    params.push(Math.round(radius_ft))
  }
  if (typeof exit_minutes === 'number' && exit_minutes >= 5 && exit_minutes <= 60) {
    updates.push(`geofence_exit_minutes = $${idx++}`)
    params.push(Math.round(exit_minutes))
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  params.push(session.org_id)
  await query(`UPDATE organizations SET ${updates.join(', ')} WHERE id = $${idx}`, params)

  const settings = await getGeofenceSettings(session.org_id)
  return NextResponse.json({ ok: true, settings })
}
