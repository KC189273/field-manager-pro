import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await query(`
    CREATE TABLE IF NOT EXISTS pay_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('pto', 'sick')),
      hours NUMERIC(5,2),
      note TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_pay_codes_user_date ON pay_codes(user_id, date)`)

  return NextResponse.json({ ok: true })
}
