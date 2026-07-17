import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// GET — get notes for a customer
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const bp = await queryOne<{ id: string }>(`SELECT id FROM barber_profiles WHERE user_id = $1`, [session.id])

  const notes = await query<{ id: string; note: string; created_at: string }>(`
    SELECT id, note, created_at::text FROM customer_notes
    WHERE customer_id = $1 ${bp ? `AND barber_id = '${bp.id}'` : ''}
    ORDER BY created_at DESC
  `, [id])

  // Also get appointment history
  const history = await query<{ appointment_date: string; service_names: string; status: string }>(`
    SELECT a.appointment_date::text,
           COALESCE((SELECT STRING_AGG(bs.name, ', ') FROM barber_services bs WHERE bs.id = ANY(a.service_ids)), 'Haircut') as service_names,
           a.status
    FROM appointments a
    WHERE a.customer_id = $1 ${bp ? `AND a.barber_id = '${bp.id}'` : ''}
    ORDER BY a.appointment_date DESC LIMIT 20
  `, [id])

  return NextResponse.json({ notes, history })
}

// POST — add a note
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['barber', 'shop_owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { note } = await req.json()
  if (!note?.trim()) return NextResponse.json({ error: 'Note is required' }, { status: 400 })

  const bp = await queryOne<{ id: string }>(`SELECT id FROM barber_profiles WHERE user_id = $1`, [session.id])
  if (!bp) return NextResponse.json({ error: 'Barber profile not found' }, { status: 400 })

  await query(`INSERT INTO customer_notes (barber_id, customer_id, note) VALUES ($1, $2, $3)`, [bp.id, id, note.trim()])

  return NextResponse.json({ ok: true })
}
