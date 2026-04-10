import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner, type Role } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

const canAccess = (role: Role) => role !== 'employee'
const canViewAll = (role: Role) => role === 'ops_manager' || isOwner(role) || role === 'developer'

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS dm_store_visits (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id                    UUID,
      submitted_by_id           UUID NOT NULL,
      submitted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      store_location_id         UUID,
      store_address             TEXT NOT NULL,
      employees_working         TEXT NOT NULL,
      dm_name                   TEXT NOT NULL,
      assigned_rdm              TEXT NOT NULL,
      reason_for_visit          TEXT NOT NULL,
      additional_comments       TEXT,
      pre_visit_1               TEXT NOT NULL,
      pre_visit_2               TEXT NOT NULL,
      pre_visit_3               TEXT NOT NULL,
      scorecard_grade           TEXT NOT NULL,
      scorecard_1               TEXT NOT NULL,
      scorecard_2               TEXT NOT NULL,
      scorecard_3               TEXT NOT NULL,
      live_interaction_observed BOOLEAN NOT NULL,
      heart_hello               BOOLEAN,
      heart_engage              BOOLEAN,
      heart_assess              BOOLEAN,
      heart_recommend           BOOLEAN,
      heart_thank               BOOLEAN,
      sales_process_1           BOOLEAN,
      sales_process_2           BOOLEAN,
      sales_process_3           BOOLEAN,
      sales_evaluation_comments TEXT,
      ops_check_1               BOOLEAN NOT NULL,
      ops_check_2               BOOLEAN NOT NULL,
      ops_check_3               BOOLEAN NOT NULL,
      ops_check_4               BOOLEAN NOT NULL,
      ops_check_5               BOOLEAN NOT NULL,
      ops_notes                 TEXT,
      coaching_1                TEXT NOT NULL,
      coaching_2                TEXT NOT NULL,
      coaching_3                TEXT NOT NULL,
      impact_1                  TEXT NOT NULL,
      impact_2                  TEXT NOT NULL,
      impact_3                  TEXT NOT NULL,
      impact_4                  TEXT NOT NULL,
      cc_emails                 TEXT
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_store_visits_org_id       ON dm_store_visits(org_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_store_visits_submitted_by ON dm_store_visits(submitted_by_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_store_visits_submitted_at ON dm_store_visits(submitted_at)`)
}

const RDM_EMAILS: Record<string, string> = {
  'Kalee Heinzman': 'Kalee.Heinzman2@T-Mobile.com',
  'Don Woods': 'Donald.Woods22@T-Mobile.com',
  'Jeff Goodman': 'Jeffery.Goodman2@T-Mobile.com',
  'Gary Meier': 'Garry.Meier2@T-Mobile.com',
  'Zac Okerstrom': 'Zachary.2.Okerstrom@T-Mobile.com',
}

function yesNo(v: boolean | null) {
  if (v === null || v === undefined) return '—'
  return v ? 'Yes' : 'No'
}

function buildEmailHtml(data: Record<string, unknown>) {
  const live = data.live_interaction_observed as boolean
  const row = (label: string, value: unknown) =>
    `<tr><td style="padding:6px 10px;font-weight:600;color:#374151;width:220px;vertical-align:top;border-bottom:1px solid #e5e7eb">${label}</td><td style="padding:6px 10px;color:#111827;border-bottom:1px solid #e5e7eb">${value ?? '—'}</td></tr>`

  return `
<div style="font-family:sans-serif;max-width:700px;margin:0 auto">
  <div style="background:#7c3aed;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:18px">DM Store Visit Report</h1>
    <p style="color:#ddd6fe;margin:4px 0 0;font-size:13px">${data.store_address} — ${new Date(data.submitted_at as string).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Visit Details</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Store Address', data.store_address)}
      ${row('Employee(s) Working', data.employees_working)}
      ${row('DM Name', data.dm_name)}
      ${row('Assigned RDM', data.assigned_rdm)}
      ${row('Reason for Visit', data.reason_for_visit)}
      ${data.additional_comments ? row('Additional Comments', data.additional_comments) : ''}
    </table>

    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Pre-Visit Planning</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Store Metrics / Highlights', data.pre_visit_1)}
      ${row('Development Areas Pre-Visit', data.pre_visit_2)}
      ${row('Primary Objective', data.pre_visit_3)}
    </table>

    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Scorecard Review</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Letter Grade', data.scorecard_grade)}
      ${row('Scorecard Strengths', data.scorecard_1)}
      ${row('Areas Needing Focus', data.scorecard_2)}
      ${row('Progress Since Last Visit', data.scorecard_3)}
    </table>

    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Sales Interaction</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Live Interaction Observed', live ? 'Yes' : 'No')}
    </table>

    ${live ? `
    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">HEART Sales Model</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Hello — Greeted customer within 10 seconds', yesNo(data.heart_hello as boolean))}
      ${row('Engage — Connected authentically', yesNo(data.heart_engage as boolean))}
      ${row('Assess — Identified needs through discovery', yesNo(data.heart_assess as boolean))}
      ${row('Recommend — Made specific recommendation', yesNo(data.heart_recommend as boolean))}
      ${row('Thank — Expressed genuine appreciation', yesNo(data.heart_thank as boolean))}
    </table>

    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Sales Process Execution</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Demonstrated value and features', yesNo(data.sales_process_1 as boolean))}
      ${row('Handled objections confidently', yesNo(data.sales_process_2 as boolean))}
      ${row('Attempted to close / asked for sale', yesNo(data.sales_process_3 as boolean))}
      ${data.sales_evaluation_comments ? row('Evaluation Comments', data.sales_evaluation_comments) : ''}
    </table>` : ''}

    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Operations Quick Check</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Store clean and visually presentable', yesNo(data.ops_check_1 as boolean))}
      ${row('Demo devices charged and functional', yesNo(data.ops_check_2 as boolean))}
      ${row('Current marketing / pricing displayed', yesNo(data.ops_check_3 as boolean))}
      ${row('Team in compliance with dress code', yesNo(data.ops_check_4 as boolean))}
      ${row('Compliance documentation current', yesNo(data.ops_check_5 as boolean))}
      ${data.ops_notes ? row('Operational Notes', data.ops_notes) : ''}
    </table>

    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Coaching</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Behaviors / Skills Coached', data.coaching_1)}
      ${row('Action Items Agreed Upon', data.coaching_2)}
      ${row('Follow-Up Plan', data.coaching_3)}
    </table>

    <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Impact & Commitments</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Visit Impact / Key Observations', data.impact_1)}
      ${row('Employee Commitments', data.impact_2)}
      ${row('Follow-Up / Check-In Date', data.impact_3)}
      ${row('Next Scheduled Visit Date', data.impact_4)}
    </table>
  </div>
  <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px">Submitted via Field Manager Pro</p>
</div>`
}

// GET — dashboard data
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try { await ensureTable() } catch { /* already exists */ }

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const dmId = searchParams.get('dmId')

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []

  let where = 'WHERE 1=1'
  const orgClause = appendOrgFilter(orgFilter, params, 'v')
  where += orgClause

  if (!canViewAll(session.role)) {
    params.push(session.id)
    where += ` AND v.submitted_by_id = $${params.length}`
  } else if (dmId) {
    params.push(dmId)
    where += ` AND v.submitted_by_id = $${params.length}`
  }

  if (from) { params.push(from); where += ` AND v.submitted_at >= $${params.length}` }
  if (to) { params.push(to + 'T23:59:59'); where += ` AND v.submitted_at <= $${params.length}` }

  const rows = await query<{
    dm_name: string
    submitted_by_id: string
    store_address: string
    count: string
  }>(`
    SELECT u.full_name AS dm_name, v.submitted_by_id, v.store_address, COUNT(*)::text AS count
    FROM dm_store_visits v
    JOIN users u ON u.id = v.submitted_by_id
    ${where}
    GROUP BY u.full_name, v.submitted_by_id, v.store_address
    ORDER BY u.full_name, count DESC
  `, params)

  return NextResponse.json({ rows })
}

// POST — submit new checklist
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try { await ensureTable() } catch { /* already exists */ }

  const body = await req.json()
  const live = body.live_interaction_observed === true

  try {
  const [visit] = await query<{ id: string; submitted_at: string }>(`
    INSERT INTO dm_store_visits (
      org_id, submitted_by_id,
      store_location_id, store_address, employees_working, dm_name,
      assigned_rdm, reason_for_visit, additional_comments,
      pre_visit_1, pre_visit_2, pre_visit_3,
      scorecard_grade, scorecard_1, scorecard_2, scorecard_3,
      live_interaction_observed,
      heart_hello, heart_engage, heart_assess, heart_recommend, heart_thank,
      sales_process_1, sales_process_2, sales_process_3, sales_evaluation_comments,
      ops_check_1, ops_check_2, ops_check_3, ops_check_4, ops_check_5, ops_notes,
      coaching_1, coaching_2, coaching_3,
      impact_1, impact_2, impact_3, impact_4,
      cc_emails
    ) VALUES (
      $1, $2,
      $3, $4, $5, $6,
      $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15, $16,
      $17,
      $18, $19, $20, $21, $22,
      $23, $24, $25, $26,
      $27, $28, $29, $30, $31, $32,
      $33, $34, $35,
      $36, $37, $38, $39,
      $40
    ) RETURNING id, submitted_at
  `, [
    session.org_id ?? null, session.id,
    body.store_location_id || null, body.store_address, body.employees_working, body.dm_name,
    body.assigned_rdm, body.reason_for_visit, body.additional_comments || null,
    body.pre_visit_1, body.pre_visit_2, body.pre_visit_3,
    body.scorecard_grade, body.scorecard_1, body.scorecard_2, body.scorecard_3,
    live,
    live ? body.heart_hello : null,
    live ? body.heart_engage : null,
    live ? body.heart_assess : null,
    live ? body.heart_recommend : null,
    live ? body.heart_thank : null,
    live ? body.sales_process_1 : null,
    live ? body.sales_process_2 : null,
    live ? body.sales_process_3 : null,
    live ? (body.sales_evaluation_comments || null) : null,
    body.ops_check_1, body.ops_check_2, body.ops_check_3, body.ops_check_4, body.ops_check_5,
    body.ops_notes || null,
    body.coaching_1, body.coaching_2, body.coaching_3,
    body.impact_1, body.impact_2, body.impact_3, body.impact_4,
    body.cc_emails || null,
  ])

  // Send email
  try {
    const rdmEmail = RDM_EMAILS[body.assigned_rdm]
    const to: string[] = [session.email]
    if (rdmEmail) to.push(rdmEmail)
    const cc: string[] = []
    if (body.cc_emails) {
      body.cc_emails.split(',').map((e: string) => e.trim()).filter(Boolean).forEach((e: string) => cc.push(e))
    }

    await resend.emails.send({
      from: 'Field Manager Pro <noreply@fieldmanagerpro.app>',
      to,
      ...(cc.length ? { cc } : {}),
      subject: `DM Store Visit — ${body.store_address} — ${new Date(visit.submitted_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`,
      html: buildEmailHtml({ ...body, submitted_at: visit.submitted_at, live_interaction_observed: live }),
    })
  } catch (err) {
    console.error('Visit email error:', err)
  }

  return NextResponse.json({ id: visit.id })
  } catch (err) {
    console.error('Visit submit error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
