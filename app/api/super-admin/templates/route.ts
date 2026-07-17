import { NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/super-admin-guard'
import { query } from '@/lib/db'

export async function GET() {
  const admin = await verifySuperAdmin()
  if (!admin) return NextResponse.json(null, { status: 404 })

  const templates = await query<{
    id: string; name: string; description: string | null; industry: string | null; modules: string
  }>(`SELECT id, name, description, industry, modules::text FROM module_templates ORDER BY name`)

  return NextResponse.json({
    templates: templates.map(t => ({ ...t, modules: JSON.parse(t.modules) })),
  })
}
