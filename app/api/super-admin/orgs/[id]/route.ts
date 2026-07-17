import { NextRequest, NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/super-admin-guard'
import { query } from '@/lib/db'

// PATCH — update organization fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const { id } = await params
  const { name, industry, status, notes, contact_name, contact_email } = await req.json()

  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1

  if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name.trim()) }
  if (industry !== undefined) { sets.push(`industry = $${idx++}`); vals.push(industry) }
  if (status !== undefined) { sets.push(`status = $${idx++}`); vals.push(status) }
  if (notes !== undefined) { sets.push(`notes = $${idx++}`); vals.push(notes?.trim() || null) }
  if (contact_name !== undefined) { sets.push(`contact_name = $${idx++}`); vals.push(contact_name?.trim() || null) }
  if (contact_email !== undefined) { sets.push(`contact_email = $${idx++}`); vals.push(contact_email?.trim() || null) }

  if (sets.length === 0) return NextResponse.json({ ok: true })

  sets.push(`updated_at = NOW()`)
  vals.push(id)
  await query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${idx}`, vals)

  return NextResponse.json({ ok: true })
}

// DELETE — soft delete (set status to suspended)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const { id } = await params
  await query(`UPDATE organizations SET status = 'suspended', updated_at = NOW() WHERE id = $1`, [id])

  return NextResponse.json({ ok: true })
}
