import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// GET — get services for a barber
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const barberId = new URL(req.url).searchParams.get('barberId')
  if (!barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })

  const services = await query<{ id: string; name: string; price: string; duration_minutes: number; is_active: boolean }>(`
    SELECT id, name, price::text, duration_minutes, is_active
    FROM barber_services WHERE barber_id = $1 ORDER BY sort_order, name
  `, [barberId])

  return NextResponse.json({ services })
}

// POST — add or update a service
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['barber', 'shop_owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { barberId, id, name, price, duration_minutes, is_active } = await req.json()

  // Verify the barber belongs to caller
  const bp = await queryOne<{ user_id: string; org_id: string }>(`SELECT user_id, org_id FROM barber_profiles WHERE id = $1`, [barberId])
  if (!bp) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
  if (session.role === 'barber' && bp.user_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (session.role === 'shop_owner' && bp.org_id !== session.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (id) {
    // Update
    await query(`UPDATE barber_services SET name = $1, price = $2, duration_minutes = $3, is_active = $4 WHERE id = $5 AND barber_id = $6`,
      [name.trim(), price ?? 0, duration_minutes ?? 45, is_active ?? true, id, barberId])
  } else {
    // Create
    if (!name?.trim()) return NextResponse.json({ error: 'Service name required' }, { status: 400 })
    await query(`INSERT INTO barber_services (barber_id, name, price, duration_minutes) VALUES ($1, $2, $3, $4)`,
      [barberId, name.trim(), price ?? 0, duration_minutes ?? 45])
  }

  return NextResponse.json({ ok: true })
}

// DELETE — remove a service
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, barberId } = await req.json()
  const bp = await queryOne<{ user_id: string; org_id: string }>(`SELECT user_id, org_id FROM barber_profiles WHERE id = $1`, [barberId])
  if (!bp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.role === 'barber' && bp.user_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await query(`DELETE FROM barber_services WHERE id = $1 AND barber_id = $2`, [id, barberId])
  return NextResponse.json({ ok: true })
}
