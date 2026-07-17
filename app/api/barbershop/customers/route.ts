import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// GET — list customers for a barber (with visit count + last visit)
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['barber', 'shop_owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const bp = session.role === 'barber'
    ? await queryOne<{ id: string }>(`SELECT id FROM barber_profiles WHERE user_id = $1`, [session.id])
    : null

  const customers = await query<{
    id: string; user_id: string; full_name: string; phone: string | null; email: string
    visit_count: number; last_visit: string | null; notes_count: number
  }>(`
    SELECT cp.id, cp.user_id, u.full_name, cp.phone, u.email,
           (SELECT COUNT(*)::int FROM appointments a WHERE a.customer_id = cp.id AND a.status = 'completed'
            ${bp ? `AND a.barber_id = '${bp.id}'` : ''}) as visit_count,
           (SELECT MAX(a.appointment_date)::text FROM appointments a WHERE a.customer_id = cp.id AND a.status = 'completed'
            ${bp ? `AND a.barber_id = '${bp.id}'` : ''}) as last_visit,
           (SELECT COUNT(*)::int FROM customer_notes cn WHERE cn.customer_id = cp.id
            ${bp ? `AND cn.barber_id = '${bp.id}'` : ''}) as notes_count
    FROM customer_profiles cp
    JOIN users u ON u.id = cp.user_id
    WHERE cp.org_id = $1
    ORDER BY u.full_name
  `, [session.org_id])

  return NextResponse.json({ customers })
}
