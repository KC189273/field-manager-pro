import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getReceiptViewUrl, getS3ObjectBuffer } from '@/lib/s3'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'

interface ChecklistItem {
  item_number: number
  label: string
  completed: boolean
}

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS checklist_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      checklist_type TEXT NOT NULL CHECK (checklist_type IN ('opening', 'closing')),
      store_id UUID NOT NULL,
      store_address TEXT NOT NULL,
      submitted_by_id UUID NOT NULL,
      submitted_by_name TEXT NOT NULL,
      submitted_by_email TEXT NOT NULL,
      dm_id UUID NOT NULL,
      dm_name TEXT NOT NULL,
      dm_email TEXT NOT NULL,
      inventory_photo_key TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      items_completed JSONB NOT NULL
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_checklist_submissions_org ON checklist_submissions(org_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_checklist_submissions_store ON checklist_submissions(store_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_checklist_submissions_dm ON checklist_submissions(dm_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_checklist_submissions_date ON checklist_submissions(submitted_at)`)
  // Closing photo columns (added later)
  await query(`ALTER TABLE checklist_submissions ADD COLUMN IF NOT EXISTS sales_floor_photo_key TEXT`)
  await query(`ALTER TABLE checklist_submissions ADD COLUMN IF NOT EXISTS cash_drawer_photo_key TEXT`)
  await query(`ALTER TABLE checklist_submissions ADD COLUMN IF NOT EXISTS comment TEXT`)
  // Additional photo columns
  await query(`ALTER TABLE checklist_submissions ADD COLUMN IF NOT EXISTS inventory_photo_2_key TEXT`)
  await query(`ALTER TABLE checklist_submissions ADD COLUMN IF NOT EXISTS pos_photo_key TEXT`)
  await query(`ALTER TABLE checklist_submissions ADD COLUMN IF NOT EXISTS aframe_photo_key TEXT`)
  await query(`ALTER TABLE checklist_submissions ADD COLUMN IF NOT EXISTS reconciliation_photo_key TEXT`)
  await query(`ALTER TABLE checklist_submissions ADD COLUMN IF NOT EXISTS reconciliation_photo_2_key TEXT`)
}

function buildEmailHtml(params: {
  storeAddress: string
  typeLabel: string
  submittedByName: string
  submittedAt: string
  items: ChecklistItem[]
  photoUrl?: string | null
  salesFloorPhotoUrl?: string | null
  cashDrawerPhotoUrl?: string | null
  comment?: string | null
}): string {
  const { storeAddress, typeLabel, submittedByName, submittedAt, items, photoUrl, salesFloorPhotoUrl, cashDrawerPhotoUrl } = params

  const itemsHtml = items
    .map(
      (item) =>
        `<tr><td style="padding:5px 12px;border-bottom:1px solid #f3f4f6;color:#111827;font-size:14px;">✅ ${item.label}</td></tr>`
    )
    .join('')

  const photoHtml = photoUrl
    ? `<div style="margin-top:20px;">
        <p style="font-weight:600;color:#374151;margin:0 0 8px;font-size:14px;">Inventory Photo</p>
        <img src="${photoUrl}" alt="Inventory" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb;" />
      </div>`
    : ''

  const closingPhotosHtml = (salesFloorPhotoUrl || cashDrawerPhotoUrl)
    ? `<div style="margin-top:20px;">
        <p style="font-weight:600;color:#374151;margin:0 0 12px;font-size:14px;">Closing Photos</p>
        ${salesFloorPhotoUrl ? `<p style="font-size:13px;color:#6b7280;margin:0 0 6px;">Sales Floor</p><img src="${salesFloorPhotoUrl}" alt="Sales Floor" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:16px;" />` : ''}
        ${cashDrawerPhotoUrl ? `<p style="font-size:13px;color:#6b7280;margin:0 0 6px;">Cash Drawers</p><img src="${cashDrawerPhotoUrl}" alt="Cash Drawers" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb;" />` : ''}
      </div>`
    : ''

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">${typeLabel} Checklist Submitted</p>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <tr>
            <td style="padding:6px 12px;font-weight:600;color:#6b7280;width:140px;border-bottom:1px solid #f3f4f6;">Store</td>
            <td style="padding:6px 12px;color:#111827;border-bottom:1px solid #f3f4f6;">${storeAddress}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;">Type</td>
            <td style="padding:6px 12px;color:#111827;border-bottom:1px solid #f3f4f6;">${typeLabel} Checklist</td>
          </tr>
          <tr>
            <td style="padding:6px 12px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;">Submitted By</td>
            <td style="padding:6px 12px;color:#111827;border-bottom:1px solid #f3f4f6;">${submittedByName}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;">Time</td>
            <td style="padding:6px 12px;color:#111827;border-bottom:1px solid #f3f4f6;">${submittedAt}</td>
          </tr>
        </table>

        <p style="font-weight:600;color:#374151;margin:0 0 8px;font-size:14px;">Completed Items</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          ${itemsHtml}
        </table>

        ${photoHtml}
        ${closingPhotosHtml}
        ${params.comment ? `<div style="margin-top:20px;padding:14px 16px;background:#f9fafb;border-left:4px solid #7c3aed;border-radius:6px;"><p style="font-size:12px;font-weight:600;color:#6b7280;margin:0 0 4px;text-transform:uppercase;letter-spacing:.05em;">Comment</p><p style="font-size:14px;color:#374151;margin:0;">${params.comment}</p></div>` : ''}

        <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">
          Sent from <a href="https://fieldmanagerpro.app" style="color:#7c3aed;">fieldmanagerpro.app</a>
        </p>
      </div>
    </div>
  `
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch { /* already exists */ }

  const body = await req.json()
  const { checklistType, storeId, items, photoKey, inventoryPhoto2Key, posPhotoKey, aframePhotoKey, salesFloorPhotoKey, cashDrawerPhotoKey, reconciliationPhotoKey, reconciliationPhoto2Key, comment } = body

  if (!checklistType || !storeId || !Array.isArray(items)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (checklistType !== 'opening' && checklistType !== 'closing') {
    return NextResponse.json({ error: 'Invalid checklist type' }, { status: 400 })
  }
  if (checklistType === 'closing' && (!salesFloorPhotoKey || !cashDrawerPhotoKey)) {
    return NextResponse.json({ error: 'Closing checklist requires sales floor and cash drawer photos' }, { status: 400 })
  }

  // Get store info
  const storeRows = await query<{ id: string; address: string }>(
    `SELECT id, address FROM dm_store_locations WHERE id = $1 AND active = true`,
    [storeId]
  )
  if (!storeRows.length) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  }
  const store = storeRows[0]

  // Determine the DM for this submission
  // For employees, the DM is always their direct manager (most accurate)
  // For managers, the DM is themselves
  // For elevated roles, fall back to the store's assigned DM
  let dm: { id: string; full_name: string; email: string }

  if (session.role === 'employee') {
    const dmRows = await query<{ id: string; full_name: string; email: string }>(
      `SELECT id, full_name, email FROM users WHERE id = (SELECT manager_id FROM users WHERE id = $1)`,
      [session.id]
    )
    if (!dmRows.length) return NextResponse.json({ error: 'No DM assigned to your account' }, { status: 400 })
    dm = dmRows[0]
  } else if (session.role === 'manager') {
    dm = { id: session.id, full_name: session.fullName, email: session.email }
  } else {
    // ops_manager / owner / developer — use the store's assigned DM
    const dmRows = await query<{ id: string; full_name: string; email: string }>(
      `SELECT u.id, u.full_name, u.email
       FROM dm_manager_stores ms
       JOIN users u ON u.id = ms.manager_id
       WHERE ms.store_location_id = $1
       ORDER BY u.full_name LIMIT 1`,
      [storeId]
    )
    if (!dmRows.length) return NextResponse.json({ error: 'No DM assigned to this store' }, { status: 400 })
    dm = dmRows[0]
  }

  // Generate photo URLs for email (non-fatal if they fail)
  let photoUrl: string | null = null
  let salesFloorPhotoUrl: string | null = null
  let cashDrawerPhotoUrl: string | null = null
  if (photoKey) {
    try { photoUrl = await getReceiptViewUrl(photoKey) } catch { /* non-fatal */ }
  }
  if (salesFloorPhotoKey) {
    try { salesFloorPhotoUrl = await getReceiptViewUrl(salesFloorPhotoKey) } catch { /* non-fatal */ }
  }
  if (cashDrawerPhotoKey) {
    try { cashDrawerPhotoUrl = await getReceiptViewUrl(cashDrawerPhotoKey) } catch { /* non-fatal */ }
  }

  // Insert submission — store S3 keys so URLs can be regenerated on demand
  const [submission] = await query<{ id: string; submitted_at: string }>(
    `INSERT INTO checklist_submissions
      (org_id, checklist_type, store_id, store_address,
       submitted_by_id, submitted_by_name, submitted_by_email,
       dm_id, dm_name, dm_email, inventory_photo_key,
       inventory_photo_2_key, pos_photo_key, aframe_photo_key,
       sales_floor_photo_key, cash_drawer_photo_key,
       reconciliation_photo_key, reconciliation_photo_2_key,
       items_completed, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING id, submitted_at`,
    [
      session.org_id ?? null,
      checklistType,
      storeId,
      store.address,
      session.id,
      session.fullName,
      session.email,
      dm.id,
      dm.full_name,
      dm.email,
      photoKey ?? null,
      inventoryPhoto2Key ?? null,
      posPhotoKey ?? null,
      aframePhotoKey ?? null,
      salesFloorPhotoKey ?? null,
      cashDrawerPhotoKey ?? null,
      reconciliationPhotoKey ?? null,
      reconciliationPhoto2Key ?? null,
      JSON.stringify(items),
      comment?.trim() || null,
    ]
  )

  // Build email attachments from S3 keys
  const attachments: { filename: string; content: string }[] = []
  const keysToAttach = (checklistType === 'opening'
    ? [photoKey, inventoryPhoto2Key, posPhotoKey, aframePhotoKey]
    : [salesFloorPhotoKey, cashDrawerPhotoKey, reconciliationPhotoKey, reconciliationPhoto2Key]
  ).filter(Boolean) as string[]

  const attachLabels: Record<string, string> = {
    [photoKey ?? '']: 'inventory',
    [inventoryPhoto2Key ?? '']: 'inventory-2',
    [posPhotoKey ?? '']: 'pos-drawers',
    [aframePhotoKey ?? '']: 'aframe',
    [salesFloorPhotoKey ?? '']: 'sales-floor',
    [cashDrawerPhotoKey ?? '']: 'cash-drawers',
    [reconciliationPhotoKey ?? '']: 'reconciliation-1',
    [reconciliationPhoto2Key ?? '']: 'reconciliation-2',
  }

  await Promise.all(keysToAttach.map(async key => {
    const buf = await getS3ObjectBuffer(key)
    if (buf) {
      const ext = key.split('.').pop() ?? 'jpg'
      attachments.push({ filename: `${attachLabels[key] ?? 'photo'}.${ext}`, content: buf.toString('base64') })
    }
  }))

  // Send email to DM
  const submittedAt = new Date(submission.submitted_at).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const typeLabel = checklistType === 'opening' ? 'Opening' : 'Closing'

  try {
    if (await isEmailEnabled(dm.id)) await sendEmail(
      dm.email,
      `${typeLabel} Checklist — ${store.address}`,
      buildEmailHtml({
        storeAddress: store.address,
        typeLabel,
        submittedByName: session.fullName,
        submittedAt,
        items: items as ChecklistItem[],
        photoUrl: checklistType === 'opening' ? photoUrl : null,
        salesFloorPhotoUrl: checklistType === 'closing' ? salesFloorPhotoUrl : null,
        cashDrawerPhotoUrl: checklistType === 'closing' ? cashDrawerPhotoUrl : null,
        comment: comment?.trim() || null,
      }),
      attachments
    )
  } catch (e) {
    console.error('Checklist email send failed:', e)
  }

  // Push notification to DM
  sendPushToUser(
    dm.id,
    `${typeLabel} Checklist Submitted`,
    `${store.address} — submitted by ${session.fullName}`,
    'checklist_submitted'
  ).catch(() => {})

  return NextResponse.json({ ok: true, id: submission.id })
}
