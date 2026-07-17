import { NextRequest, NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/super-admin-guard'
import { query } from '@/lib/db'
import { MODULES } from '@/lib/modules'

// GET — full module list with enabled/disabled state for this org
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const { id } = await params

  const enabled = await query<{ module_slug: string; enabled: boolean }>(
    `SELECT module_slug, enabled FROM org_modules WHERE org_id = $1`,
    [id]
  )

  const enabledMap = new Map(enabled.map(e => [e.module_slug, e.enabled]))

  const modules = MODULES.map(m => ({
    ...m,
    enabled: enabledMap.get(m.slug) ?? false,
  }))

  return NextResponse.json({ modules, orgId: id })
}

// PATCH — toggle a single module or bulk update
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const { id } = await params
  const body = await req.json()

  // Bulk update: { modules: [{ slug, enabled }] }
  if (Array.isArray(body.modules)) {
    for (const { slug, enabled } of body.modules as Array<{ slug: string; enabled: boolean }>) {
      await query(`
        INSERT INTO org_modules (org_id, module_slug, enabled)
        VALUES ($1, $2, $3)
        ON CONFLICT (org_id, module_slug) DO UPDATE SET enabled = $3, updated_at = NOW()
      `, [id, slug, enabled])
    }
    return NextResponse.json({ ok: true, count: body.modules.length })
  }

  // Single toggle: { module_slug, enabled }
  const { module_slug, enabled } = body
  if (!module_slug || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'module_slug and enabled required' }, { status: 400 })
  }

  await query(`
    INSERT INTO org_modules (org_id, module_slug, enabled)
    VALUES ($1, $2, $3)
    ON CONFLICT (org_id, module_slug) DO UPDATE SET enabled = $3, updated_at = NOW()
  `, [id, module_slug, enabled])

  return NextResponse.json({ ok: true })
}
