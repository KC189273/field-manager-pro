import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const orgs = await query(`SELECT id, name, created_at FROM organizations ORDER BY name`)
  return NextResponse.json({ orgs })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const existing = await queryOne(`SELECT id FROM organizations WHERE name = $1`, [name.trim()])
  if (existing) return NextResponse.json({ error: 'Name already taken' }, { status: 409 })

  const org = await queryOne<{ id: string }>(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name.trim()]
  )
  return NextResponse.json({ ok: true, id: org!.id })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { orgId, name } = await req.json()
  if (!orgId || !name?.trim()) return NextResponse.json({ error: 'Missing orgId or name' }, { status: 400 })

  await query(`UPDATE organizations SET name = $1 WHERE id = $2`, [name.trim(), orgId])
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { orgId } = await req.json()
  if (!orgId) return NextResponse.json({ error: 'Missing orgId' }, { status: 400 })

  // Unassign users before deleting org
  await query(`UPDATE users SET org_id = NULL WHERE org_id = $1`, [orgId])
  await query(`DELETE FROM organizations WHERE id = $1`, [orgId])
  return NextResponse.json({ ok: true })
}
