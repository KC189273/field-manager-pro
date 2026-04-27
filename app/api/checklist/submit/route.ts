import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'

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
}

function buildEmailHtml(params: {
  storeAddress: string
  typeLabel: string
  submittedByName: string
  submittedAt: string
  items: ChecklistItem[]
  photoUrl?: string | null
}): string {
  const { storeAddress, typeLabel, submittedByName, submittedAt, items, photoUrl } = params

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
  const { checklistType, storeId, items, photoKey } = body

  if (!checklistType || !storeId || !Array.isArray(items)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (checklistType !== 'opening' && checklistType !== 'closing') {
    return NextResponse.json({ error: 'Invalid checklist type' }, { status: 400 })
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

  // Get DM for this store
  const dmRows = await query<{ id: string; full_name: string; email: string }>(
    `SELECT u.id, u.full_name, u.email
     FROM dm_manager_stores ms
     JOIN users u ON u.id = ms.manager_id
     WHERE ms.store_location_id = $1
     LIMIT 1`,
    [storeId]
  )
  if (!dmRows.length) {
    return NextResponse.json({ error: 'No DM assigned to this store' }, { status: 400 })
  }
  const dm = dmRows[0]

  // Generate photo URL for email (non-fatal if it fails)
  let photoUrl: string | null = null
  if (photoKey) {
    try { photoUrl = await getReceiptViewUrl(photoKey) } catch { /* non-fatal */ }
  }

  // Insert submission — store S3 key so URL can be regenerated on demand
  const [submission] = await query<{ id: string; submitted_at: string }>(
    `INSERT INTO checklist_submissions
      (org_id, checklist_type, store_id, store_address,
       submitted_by_id, submitted_by_name, submitted_by_email,
       dm_id, dm_name, dm_email, inventory_photo_key, items_completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      JSON.stringify(items),
    ]
  )

  // Send email to DM
  const submittedAt = new Date(submission.submitted_at).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const typeLabel = checklistType === 'opening' ? 'Opening' : 'Closing'

  try {
    await sendEmail(
      dm.email,
      `${typeLabel} Checklist — ${store.address}`,
      buildEmailHtml({
        storeAddress: store.address,
        typeLabel,
        submittedByName: session.fullName,
        submittedAt,
        items: items as ChecklistItem[],
        photoUrl: checklistType === 'opening' ? photoUrl : null,
      })
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
