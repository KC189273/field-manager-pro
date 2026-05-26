import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const GIPHY_KEY = process.env.GIPHY_API_KEY ?? ''
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!GIPHY_KEY) {
    return NextResponse.json({ results: [] })
  }

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()

  const endpoint = q
    ? `${GIPHY_BASE}/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=20&rating=pg`
    : `${GIPHY_BASE}/trending?api_key=${GIPHY_KEY}&limit=20&rating=pg`

  const res = await fetch(endpoint).catch(() => null)
  if (!res?.ok) return NextResponse.json({ results: [] })

  const data = await res.json()
  const results = (data.data ?? []).map((item: {
    id: string
    images?: {
      fixed_width?: { url: string }
      fixed_width_small?: { url: string }
      original?: { url: string }
    }
  }) => ({
    id: item.id,
    previewUrl: item.images?.fixed_width_small?.url ?? item.images?.fixed_width?.url ?? '',
    url: item.images?.fixed_width?.url ?? item.images?.original?.url ?? '',
  })).filter((r: { url: string }) => r.url)

  return NextResponse.json({ results })
}
