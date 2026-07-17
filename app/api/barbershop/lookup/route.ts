import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET — look up a shop by its 4-letter code (no auth required — used during signup)
export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code')?.toUpperCase()
  if (!code || code.length !== 4) return NextResponse.json({ error: 'Invalid code' }, { status: 400 })

  const shop = await queryOne<{ org_id: string; shop_name: string; address: string | null; phone: string | null }>(`
    SELECT org_id, shop_name, address, phone FROM shop_settings WHERE shop_code = $1
  `, [code])

  if (!shop) return NextResponse.json({ error: 'Shop not found. Check your code and try again.' }, { status: 404 })

  return NextResponse.json({ shop })
}

// POST — create or return a customer account linked to a shop (no password needed)
export async function POST(req: NextRequest) {
  const { code, email, fullName, phone } = await req.json()
  if (!code || !email?.trim() || !fullName?.trim()) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }

  const upperCode = code.toUpperCase()
  const shop = await queryOne<{ org_id: string }>(`SELECT org_id FROM shop_settings WHERE shop_code = $1`, [upperCode])
  if (!shop) return NextResponse.json({ error: 'Invalid shop code' }, { status: 404 })

  const emailLower = email.trim().toLowerCase()

  // Check if customer already exists — just log them back in
  const existing = await queryOne<{ id: string; full_name: string; role: string; org_id: string }>(`
    SELECT id, full_name, role, org_id FROM users WHERE email = $1
  `, [emailLower])

  if (existing) {
    // Update name/phone if changed
    await query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName.trim(), existing.id])
    if (phone?.trim()) {
      await query(`UPDATE customer_profiles SET phone = $1 WHERE user_id = $2`, [phone.trim(), existing.id])
    }

    const { createSession, setSessionCookie } = await import('@/lib/auth')
    const token = await createSession({
      id: existing.id,
      username: emailLower,
      fullName: fullName.trim(),
      email: emailLower,
      role: existing.role as 'customer',
      org_id: existing.org_id,
    })
    await setSessionCookie(token)
    return NextResponse.json({ ok: true, userId: existing.id })
  }

  // New customer — create account without password
  const [user] = await query<{ id: string }>(`
    INSERT INTO users (username, email, password_hash, role, full_name, org_id, is_active)
    VALUES ($1, $2, $3, 'customer', $4, $5, true) RETURNING id
  `, [emailLower, emailLower, 'none', fullName.trim(), shop.org_id])

  await query(`INSERT INTO customer_profiles (user_id, org_id, phone, created_via_code) VALUES ($1, $2, $3, $4)`,
    [user.id, shop.org_id, phone?.trim() || null, upperCode])

  const { createSession, setSessionCookie } = await import('@/lib/auth')
  const token = await createSession({
    id: user.id,
    username: emailLower,
    fullName: fullName.trim(),
    email: emailLower,
    role: 'customer',
    org_id: shop.org_id,
  })
  await setSessionCookie(token)

  return NextResponse.json({ ok: true, userId: user.id })
}
