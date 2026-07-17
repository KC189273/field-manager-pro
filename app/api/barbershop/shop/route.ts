import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// GET — get shop settings for current user's org
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shop = await queryOne<{
    id: string; shop_code: string; shop_name: string; address: string | null
    phone: string | null; operating_hours: string
  }>(`SELECT id, shop_code, shop_name, address, phone, operating_hours::text FROM shop_settings WHERE org_id = $1`, [session.org_id])

  if (!shop) return NextResponse.json({ shop: null })

  return NextResponse.json({ shop: { ...shop, operating_hours: JSON.parse(shop.operating_hours) } })
}

// POST — create or update shop settings
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'shop_owner' && session.role !== 'developer') {
    return NextResponse.json({ error: 'Only shop owners can manage shop settings' }, { status: 403 })
  }

  const { shop_name, shop_code, address, phone, operating_hours, is_listed_as_barber } = await req.json()
  if (!shop_name?.trim() || !shop_code?.trim()) {
    return NextResponse.json({ error: 'Shop name and code are required' }, { status: 400 })
  }

  const code = shop_code.trim().toUpperCase().slice(0, 4)
  if (code.length !== 4) return NextResponse.json({ error: 'Code must be exactly 4 characters' }, { status: 400 })

  // Check code uniqueness
  const existing = await queryOne<{ org_id: string }>(`SELECT org_id FROM shop_settings WHERE shop_code = $1`, [code])
  if (existing && existing.org_id !== session.org_id) {
    return NextResponse.json({ error: 'This code is already taken by another shop' }, { status: 400 })
  }

  // Upsert shop settings
  await query(`
    INSERT INTO shop_settings (org_id, shop_code, shop_name, address, phone, operating_hours)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (org_id) DO UPDATE SET
      shop_code = $2, shop_name = $3, address = $4, phone = $5, operating_hours = $6, updated_at = NOW()
  `, [session.org_id, code, shop_name.trim(), address?.trim() || null, phone?.trim() || null, JSON.stringify(operating_hours ?? [])])

  // Handle is_listed_as_barber toggle — create/update barber profile for shop owner
  if (is_listed_as_barber !== undefined) {
    const existingProfile = await queryOne<{ id: string }>(`SELECT id FROM barber_profiles WHERE user_id = $1`, [session.id])

    if (is_listed_as_barber && !existingProfile) {
      // Create barber profile for shop owner
      const [bp] = await query<{ id: string }>(`
        INSERT INTO barber_profiles (user_id, org_id, display_name, is_listed)
        VALUES ($1, $2, $3, true) RETURNING id
      `, [session.id, session.org_id, session.fullName])

      // Seed default "Haircut" service
      await query(`
        INSERT INTO barber_services (barber_id, name, price, duration_minutes, sort_order)
        VALUES ($1, 'Haircut', 0, 45, 0)
      `, [bp.id])

      // Seed default availability Mon-Sat 9-6
      for (let day = 0; day <= 5; day++) {
        await query(`
          INSERT INTO barber_availability (barber_id, day_of_week, start_time, end_time, is_available)
          VALUES ($1, $2, '09:00', '18:00', true) ON CONFLICT DO NOTHING
        `, [bp.id, day])
      }
      // Sunday off
      await query(`
        INSERT INTO barber_availability (barber_id, day_of_week, start_time, end_time, is_available)
        VALUES ($1, 6, '09:00', '18:00', false) ON CONFLICT DO NOTHING
      `, [bp.id])
    } else if (!is_listed_as_barber && existingProfile) {
      await query(`UPDATE barber_profiles SET is_listed = false, updated_at = NOW() WHERE user_id = $1`, [session.id])
    } else if (is_listed_as_barber && existingProfile) {
      await query(`UPDATE barber_profiles SET is_listed = true, updated_at = NOW() WHERE user_id = $1`, [session.id])
    }
  }

  return NextResponse.json({ ok: true })
}

// PATCH — update barber profile fields (venmo, cashapp, duration, cleanup)
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['barber', 'shop_owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { barberId, venmo_username, cashapp_tag, default_duration, cleanup_minutes } = await req.json()
  if (!barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })

  // Verify ownership
  const bp = await queryOne<{ user_id: string; org_id: string }>(`SELECT user_id, org_id FROM barber_profiles WHERE id = $1`, [barberId])
  if (!bp) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
  if (session.role === 'barber' && bp.user_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (session.role === 'shop_owner' && bp.org_id !== session.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1

  if (venmo_username !== undefined) { sets.push(`venmo_username = $${idx++}`); vals.push(venmo_username?.trim() || null) }
  if (cashapp_tag !== undefined) { sets.push(`cashapp_tag = $${idx++}`); vals.push(cashapp_tag?.trim() || null) }
  if (default_duration !== undefined) { sets.push(`default_duration = $${idx++}`); vals.push(Number(default_duration) || 45) }
  if (cleanup_minutes !== undefined) { sets.push(`cleanup_minutes = $${idx++}`); vals.push(Number(cleanup_minutes) || 15) }

  if (sets.length === 0) return NextResponse.json({ ok: true })

  sets.push(`updated_at = NOW()`)
  vals.push(barberId)
  await query(`UPDATE barber_profiles SET ${sets.join(', ')} WHERE id = $${idx}`, vals)

  return NextResponse.json({ ok: true })
}
