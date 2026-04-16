import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const canViewAll = isManager(session.role) || isOwner(session.role) || session.role === 'developer'

  if (userId && userId !== session.id && !canViewAll) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []
  let dateFilter = ''
  if (from) { params.push(from); dateFilter += ` AND s.clock_in_at >= $${params.length}` }
  if (to) { params.push(to); dateFilter += ` AND s.clock_in_at <= $${params.length}` }

  let shifts: unknown[]

  if (userId) {
    // Specific user requested
    params.unshift(userId)
    // Renumber date params (they were added assuming no userId prefix)
    const reIndexed: unknown[] = [userId]
    if (from) reIndexed.push(from)
    if (to) reIndexed.push(to)
    params.length = 0
    params.push(...reIndexed)

    let df = ''
    let i = 2
    if (from) { df += ` AND s.clock_in_at >= $${i++}` }
    if (to) { df += ` AND s.clock_in_at <= $${i++}` }

    shifts = await query(`
      SELECT s.id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
             s.clock_out_at, s.clock_out_lat, s.clock_out_lng, s.clock_out_address,
             u.full_name, u.username
      FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1${df}
      ORDER BY s.clock_in_at DESC LIMIT 50
    `, params)
  } else if (canViewAll) {
    // All users in org (or all orgs for developer with no filter)
    const orgClause = appendOrgFilter(orgFilter, params)
    shifts = await query(`
      SELECT s.id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
             s.clock_out_at, s.clock_out_lat, s.clock_out_lng, s.clock_out_address,
             u.full_name, u.username
      FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE 1=1${dateFilter}${orgClause}
      ORDER BY s.clock_in_at DESC LIMIT 200
    `, params)
  } else {
    // Employee sees only their own
    params.unshift(session.id)
    const reIndexed: unknown[] = [session.id]
    if (from) reIndexed.push(from)
    if (to) reIndexed.push(to)
    params.length = 0
    params.push(...reIndexed)

    let df = ''
    let i = 2
    if (from) { df += ` AND s.clock_in_at >= $${i++}` }
    if (to) { df += ` AND s.clock_in_at <= $${i++}` }

    shifts = await query(`
      SELECT s.id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
             s.clock_out_at, s.clock_out_lat, s.clock_out_lng, s.clock_out_address,
             u.full_name, u.username
      FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1${df}
      ORDER BY s.clock_in_at DESC LIMIT 50
    `, params)
  }

  return NextResponse.json({ shifts })
}
