import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'

// GET — list barbers for a shop (used by customers and barbers)
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId') || session.org_id

  const barbers = await query<{
    id: string; user_id: string; display_name: string; bio: string | null
    avatar_key: string | null; is_listed: boolean; walk_ins_enabled: boolean
    default_duration: number; cleanup_minutes: number
    venmo_username: string | null; cashapp_tag: string | null
  }>(`
    SELECT bp.id, bp.user_id, bp.display_name, bp.bio, bp.avatar_key,
           bp.is_listed, bp.walk_ins_enabled, bp.default_duration, bp.cleanup_minutes,
           bp.venmo_username, bp.cashapp_tag
    FROM barber_profiles bp
    WHERE bp.org_id = $1 AND bp.is_listed = true
    ORDER BY bp.sort_order, bp.display_name
  `, [orgId])

  // Resolve avatars and get services + next available for each
  const enriched = await Promise.all(barbers.map(async b => {
    let avatar_url: string | null = null
    if (b.avatar_key) { try { avatar_url = await getReceiptViewUrl(b.avatar_key) } catch {} }

    const services = await query<{ id: string; name: string; price: string; duration_minutes: number }>(`
      SELECT id, name, price::text, duration_minutes FROM barber_services
      WHERE barber_id = $1 AND is_active = true ORDER BY sort_order, name
    `, [b.id])

    // Next available slot
    const today = new Date().toISOString().split('T')[0]
    const avail = await queryOne<{ day_of_week: number }>(`
      SELECT day_of_week FROM barber_availability
      WHERE barber_id = $1 AND is_available = true
      ORDER BY CASE WHEN day_of_week >= EXTRACT(DOW FROM CURRENT_DATE)::int THEN day_of_week - EXTRACT(DOW FROM CURRENT_DATE)::int ELSE day_of_week + 7 - EXTRACT(DOW FROM CURRENT_DATE)::int END
      LIMIT 1
    `, [b.id])

    // Portfolio photos (top 6)
    const photos = await query<{ photo_key: string; caption: string | null }>(`
      SELECT photo_key, caption FROM barber_portfolio
      WHERE barber_id = $1 ORDER BY sort_order, created_at DESC LIMIT 6
    `, [b.id])
    const portfolio = await Promise.all(photos.map(async p => {
      let url: string | null = null
      try { url = await getReceiptViewUrl(p.photo_key) } catch {}
      return { url, caption: p.caption }
    }))

    return { ...b, avatar_url, services, next_available_day: avail?.day_of_week ?? null, portfolio }
  }))

  return NextResponse.json({ barbers: enriched })
}

// POST — create a new barber (shop owner only)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'shop_owner' && session.role !== 'developer') {
    return NextResponse.json({ error: 'Only shop owners can add barbers' }, { status: 403 })
  }

  const { username, email, password, fullName } = await req.json()
  if (!username?.trim() || !email?.trim() || !password || !fullName?.trim()) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  const bcrypt = await import('bcryptjs')
  const hash = await bcrypt.hash(password, 12)

  // Create user account
  const [user] = await query<{ id: string }>(`
    INSERT INTO users (username, email, password_hash, role, full_name, org_id, is_active, temp_password, must_change_password)
    VALUES ($1, $2, $3, 'barber', $4, $5, true, $6, true) RETURNING id
  `, [username.trim().toLowerCase(), email.trim(), hash, fullName.trim(), session.org_id, password])

  // Create barber profile
  const [bp] = await query<{ id: string }>(`
    INSERT INTO barber_profiles (user_id, org_id, display_name, is_listed)
    VALUES ($1, $2, $3, true) RETURNING id
  `, [user.id, session.org_id, fullName.trim()])

  // Seed default Haircut service
  await query(`INSERT INTO barber_services (barber_id, name, price, duration_minutes) VALUES ($1, 'Haircut', 0, 45)`, [bp.id])

  // Seed default availability Mon-Sat 9-6
  for (let day = 0; day <= 5; day++) {
    await query(`INSERT INTO barber_availability (barber_id, day_of_week, start_time, end_time, is_available) VALUES ($1, $2, '09:00', '18:00', true)`, [bp.id, day])
  }
  await query(`INSERT INTO barber_availability (barber_id, day_of_week, start_time, end_time, is_available) VALUES ($1, 6, '09:00', '18:00', false)`, [bp.id])

  return NextResponse.json({ ok: true, userId: user.id, barberId: bp.id })
}
