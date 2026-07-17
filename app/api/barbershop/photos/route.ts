import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getReceiptUploadUrl, getReceiptViewUrl } from '@/lib/s3'

// GET — get upload URL or view portfolio photos
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const barberId = searchParams.get('barberId')
  const action = searchParams.get('action') // 'upload-avatar' | 'upload-portfolio' | 'list'
  const ext = (searchParams.get('ext') ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')

  if (!barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })

  if (action === 'upload-avatar') {
    const key = `barber-avatars/${barberId}.${ext}`
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
    const uploadUrl = await getReceiptUploadUrl(key, contentType)
    return NextResponse.json({ uploadUrl, key })
  }

  if (action === 'upload-portfolio') {
    const ts = Date.now()
    const key = `barber-portfolio/${barberId}/${ts}.${ext}`
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
    const uploadUrl = await getReceiptUploadUrl(key, contentType)
    return NextResponse.json({ uploadUrl, key })
  }

  // Default: list portfolio photos
  const photos = await query<{ id: string; photo_key: string; caption: string | null; created_at: string }>(`
    SELECT id, photo_key, caption, created_at::text
    FROM barber_portfolio WHERE barber_id = $1 ORDER BY sort_order, created_at DESC
  `, [barberId])

  const enriched = await Promise.all(photos.map(async p => {
    let url: string | null = null
    try { url = await getReceiptViewUrl(p.photo_key) } catch {}
    return { ...p, url }
  }))

  // Also get avatar
  const bp = await queryOne<{ avatar_key: string | null }>(`SELECT avatar_key FROM barber_profiles WHERE id = $1`, [barberId])
  let avatarUrl: string | null = null
  if (bp?.avatar_key) { try { avatarUrl = await getReceiptViewUrl(bp.avatar_key) } catch {} }

  return NextResponse.json({ photos: enriched, avatarUrl })
}

// POST — save avatar key or add portfolio photo
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['barber', 'shop_owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { barberId, action, key, caption } = await req.json()
  if (!barberId || !action) return NextResponse.json({ error: 'barberId and action required' }, { status: 400 })

  // Verify ownership
  const bp = await queryOne<{ user_id: string; org_id: string }>(`SELECT user_id, org_id FROM barber_profiles WHERE id = $1`, [barberId])
  if (!bp) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
  if (session.role === 'barber' && bp.user_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (session.role === 'shop_owner' && bp.org_id !== session.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (action === 'save-avatar') {
    await query(`UPDATE barber_profiles SET avatar_key = $1, updated_at = NOW() WHERE id = $2`, [key, barberId])
    return NextResponse.json({ ok: true })
  }

  if (action === 'add-portfolio') {
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
    await query(`INSERT INTO barber_portfolio (barber_id, photo_key, caption) VALUES ($1, $2, $3)`, [barberId, key, caption?.trim() || null])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

// DELETE — remove a portfolio photo
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['barber', 'shop_owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { photoId, barberId } = await req.json()
  if (!photoId || !barberId) return NextResponse.json({ error: 'photoId and barberId required' }, { status: 400 })

  // Verify ownership
  const bp = await queryOne<{ user_id: string; org_id: string }>(`SELECT user_id, org_id FROM barber_profiles WHERE id = $1`, [barberId])
  if (!bp) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
  if (session.role === 'barber' && bp.user_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (session.role === 'shop_owner' && bp.org_id !== session.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await query(`DELETE FROM barber_portfolio WHERE id = $1 AND barber_id = $2`, [photoId, barberId])
  return NextResponse.json({ ok: true })
}
