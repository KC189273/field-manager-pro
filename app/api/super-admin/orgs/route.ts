import { NextRequest, NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/super-admin-guard'
import { query, queryOne } from '@/lib/db'

// GET — list all organizations with module counts
export async function GET() {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const orgs = await query<{
    id: string; name: string; industry: string; status: string
    notes: string | null; contact_name: string | null; contact_email: string | null
    created_at: string; updated_at: string; enabled_modules: number; user_count: number
  }>(`
    SELECT o.id, o.name, o.industry, COALESCE(o.status, 'active') as status,
           o.notes, o.contact_name, o.contact_email,
           o.created_at::text, o.updated_at::text,
           (SELECT COUNT(*)::int FROM org_modules om WHERE om.org_id = o.id AND om.enabled = true) as enabled_modules,
           (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id AND u.is_active = true) as user_count
    FROM organizations o
    ORDER BY o.name
  `)

  return NextResponse.json({ orgs })
}

// POST — create a new organization
export async function POST(req: NextRequest) {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const { name, industry, status, notes, contact_name, contact_email, template_id, clone_from_org_id } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const [org] = await query<{ id: string }>(`
    INSERT INTO organizations (name, industry, status, notes, contact_name, contact_email, clone_from_org_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [
    name.trim(),
    industry || 'wireless_retail',
    status || 'active',
    notes?.trim() || null,
    contact_name?.trim() || null,
    contact_email?.trim() || null,
    clone_from_org_id || null,
  ])

  // Seed modules from template
  if (template_id) {
    const template = await queryOne<{ modules: string }>(`SELECT modules::text FROM module_templates WHERE id = $1`, [template_id])
    if (template) {
      const slugs: string[] = JSON.parse(template.modules)
      for (const slug of slugs) {
        await query(`INSERT INTO org_modules (org_id, module_slug, enabled) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`, [org.id, slug])
      }
    }
  } else if (clone_from_org_id) {
    // Clone modules from another org
    await query(`
      INSERT INTO org_modules (org_id, module_slug, enabled)
      SELECT $1, module_slug, enabled FROM org_modules WHERE org_id = $2
    `, [org.id, clone_from_org_id])
  }

  return NextResponse.json({ ok: true, id: org.id })
}
