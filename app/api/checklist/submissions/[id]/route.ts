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
    org_id: string | null
  }>(
    `SELECT id, checklist_type, store_address, submitted_by_name, dm_id, dm_name,
            submitted_at, items_completed, inventory_photo_key, org_id
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
  if (row.inventory_photo_key) {
    try { inventory_photo_url = await getReceiptViewUrl(row.inventory_photo_key) } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ...row, inventory_photo_url })
}
