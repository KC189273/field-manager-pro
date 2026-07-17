import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS commission_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      org_id UUID,
      entry_date DATE NOT NULL,
      new_activations INT NOT NULL DEFAULT 0,
      byod INT NOT NULL DEFAULT 0,
      reacts INT NOT NULL DEFAULT 0,
      promo10 INT NOT NULL DEFAULT 0,
      upgrades INT NOT NULL DEFAULT 0,
      hsi INT NOT NULL DEFAULT 0,
      bts INT NOT NULL DEFAULT 0,
      mim_lines INT NOT NULL DEFAULT 0,
      home_internet INT NOT NULL DEFAULT 0,
      complete_protection INT NOT NULL DEFAULT 0,
      hd_video INT NOT NULL DEFAULT 0,
      accessory_revenue NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, entry_date)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_commission_user ON commission_entries(user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_commission_date ON commission_entries(entry_date)`)
}

// GET — fetch entries for a month
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') // YYYY-MM
  const userId = searchParams.get('userId') || session.id

  // DMs can view their employees' data, higher roles can view anyone
  if (userId !== session.id) {
    if (session.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const monthStart = month ? `${month}-01` : new Date().toISOString().slice(0, 8) + '01'
  const [y, m] = monthStart.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const monthEnd = `${month || new Date().toISOString().slice(0, 7)}-${String(lastDay).padStart(2, '0')}`

  const entries = await query<{
    id: string; entry_date: string
    new_activations: number; byod: number; reacts: number; promo10: number
    upgrades: number; hsi: number; bts: number; mim_lines: number
    home_internet: number; complete_protection: number; hd_video: number
    accessory_revenue: string
  }>(
    `SELECT id, entry_date::text, new_activations, byod, reacts, promo10,
            upgrades, hsi, bts, mim_lines, home_internet,
            complete_protection, hd_video, accessory_revenue::text
     FROM commission_entries
     WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3
     ORDER BY entry_date`,
    [userId, monthStart, monthEnd]
  )

  return NextResponse.json({ entries })
}

// POST — save/update a daily entry
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const body = await req.json()
  const { entry_date, new_activations, byod, reacts, promo10, upgrades, hsi, bts,
    mim_lines, home_internet, complete_protection, hd_video, accessory_revenue } = body

  if (!entry_date) return NextResponse.json({ error: 'entry_date required' }, { status: 400 })

  const [row] = await query<{ id: string }>(
    `INSERT INTO commission_entries (
      user_id, org_id, entry_date,
      new_activations, byod, reacts, promo10,
      upgrades, hsi, bts, mim_lines, home_internet,
      complete_protection, hd_video, accessory_revenue
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (user_id, entry_date) DO UPDATE SET
      new_activations = $4, byod = $5, reacts = $6, promo10 = $7,
      upgrades = $8, hsi = $9, bts = $10, mim_lines = $11, home_internet = $12,
      complete_protection = $13, hd_video = $14, accessory_revenue = $15,
      updated_at = NOW()
    RETURNING id`,
    [
      session.id, session.org_id ?? null, entry_date,
      new_activations ?? 0, byod ?? 0, reacts ?? 0, promo10 ?? 0,
      upgrades ?? 0, hsi ?? 0, bts ?? 0, mim_lines ?? 0, home_internet ?? 0,
      complete_protection ?? 0, hd_video ?? 0, accessory_revenue ?? 0,
    ]
  )

  return NextResponse.json({ ok: true, id: row.id })
}
