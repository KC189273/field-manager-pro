import { NextRequest, NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/super-admin-guard'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'

// GET — list users for an org
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const { id } = await params
  const users = await query<{
    id: string; username: string; full_name: string; email: string
    role: string; is_active: boolean; created_at: string
  }>(`
    SELECT id, username, full_name, email, role, is_active, created_at::text
    FROM users WHERE org_id = $1 ORDER BY created_at DESC
  `, [id])

  return NextResponse.json({ users })
}

// POST — create a new user for an org
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const { id } = await params
  const { username, full_name, email, password, role } = await req.json()

  if (!username?.trim() || !full_name?.trim() || !password) {
    return NextResponse.json({ error: 'Username, full name, and password are required' }, { status: 400 })
  }

  // Check username uniqueness
  const existing = await query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username.trim().toLowerCase()])
  if (existing.length > 0) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 400 })
  }

  const hash = await bcrypt.hash(password, 10)

  const [user] = await query<{ id: string }>(`
    INSERT INTO users (username, full_name, email, password_hash, role, org_id, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, true)
    RETURNING id
  `, [
    username.trim().toLowerCase(),
    full_name.trim(),
    email?.trim() || null,
    hash,
    role || 'employee',
    id,
  ])

  return NextResponse.json({ ok: true, id: user.id })
}
