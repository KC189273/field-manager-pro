import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const rows = await query<{
    id: string
    checklist_type: string
    store_address: string
    submitted_by_name: string
    dm_id: string
    dm_name: string
    submitted_at: string
    items_completed: unknown
    inventory_photo_key: string | null
    inventory_photo_2_key: string | null
    pos_photo_key: string | null
    aframe_photo_key: string | null
    sales_floor_photo_key: string | null
    cash_drawer_photo_key: string | null
    reconciliation_photo_key: string | null
    reconciliation_photo_2_key: string | null
    org_id: string | null
  }>(
    `SELECT id, checklist_type, store_address, submitted_by_name, dm_id, dm_name,
            submitted_at, items_completed, inventory_photo_key,
            inventory_photo_2_key, pos_photo_key, aframe_photo_key,
            sales_floor_photo_key, cash_drawer_photo_key,
            reconciliation_photo_key, reconciliation_photo_2_key,
            org_id, comment, voice_lines, mim, home_internet
     FROM checklist_submissions WHERE id = $1`,
    [id]
  )

  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = rows[0]

  // DMs can only view submissions for their own stores
  if (session.role === 'manager' && row.dm_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let inventory_photo_url: string | null = null
  let inventory_photo_2_url: string | null = null
  let pos_photo_url: string | null = null
  let aframe_photo_url: string | null = null
  let sales_floor_photo_url: string | null = null
  let cash_drawer_photo_url: string | null = null
  let reconciliation_photo_url: string | null = null
  let reconciliation_photo_2_url: string | null = null

  const resolveUrl = async (key: string | null): Promise<string | null> => {
    if (!key) return null
    try { return await getReceiptViewUrl(key) } catch { return null }
  }

  ;[
    inventory_photo_url,
    inventory_photo_2_url,
    pos_photo_url,
    aframe_photo_url,
    sales_floor_photo_url,
    cash_drawer_photo_url,
    reconciliation_photo_url,
    reconciliation_photo_2_url,
  ] = await Promise.all([
    resolveUrl(row.inventory_photo_key),
    resolveUrl(row.inventory_photo_2_key),
    resolveUrl(row.pos_photo_key),
    resolveUrl(row.aframe_photo_key),
    resolveUrl(row.sales_floor_photo_key),
    resolveUrl(row.cash_drawer_photo_key),
    resolveUrl(row.reconciliation_photo_key),
    resolveUrl(row.reconciliation_photo_2_key),
  ])

  return NextResponse.json({
    ...row,
    inventory_photo_url,
    inventory_photo_2_url,
    pos_photo_url,
    aframe_photo_url,
    sales_floor_photo_url,
    cash_drawer_photo_url,
    reconciliation_photo_url,
    reconciliation_photo_2_url,
  })
}
