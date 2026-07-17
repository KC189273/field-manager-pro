import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner, type Role } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { Resend } from 'resend'
import { escapeHtml } from '@/lib/escape-html'

const resend = new Resend(process.env.RESEND_API_KEY!)

const canAccess = (role: Role) => role !== 'employee'
const canViewAll = (role: Role) => role === 'ops_manager' || isOwner(role) || role === 'developer'

let ensured = false
async function ensureQuickColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE dm_store_visits ADD COLUMN IF NOT EXISTS visit_type TEXT NOT NULL DEFAULT 'normal'`)
  await query(`ALTER TABLE dm_store_visits ADD COLUMN IF NOT EXISTS quick_interaction_notes TEXT`)
  await query(`ALTER TABLE dm_store_visits ADD COLUMN IF NOT EXISTS intentionality TEXT`)
  await query(`ALTER TABLE dm_store_visits ADD COLUMN IF NOT EXISTS quick_takeaways TEXT`)
  await query(`ALTER TABLE dm_store_visits ADD COLUMN IF NOT EXISTS quick_actions TEXT`)
  await query(`ALTER TABLE dm_store_visits ADD COLUMN IF NOT EXISTS quick_impact TEXT`)
  await query(`ALTER TABLE dm_store_visits ADD COLUMN IF NOT EXISTS photo_keys TEXT[] DEFAULT '{}'`)
}

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
  'Curt Hauk': 'Curt.hauk@t-mobile.com',
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
  try { await ensureQuickColumns() } catch {}

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
    visit_type: string
    count: string
  }>(`
    SELECT u.full_name AS dm_name, v.submitted_by_id, v.store_address,
           COALESCE(v.visit_type, 'normal') AS visit_type, COUNT(*)::text AS count
    FROM dm_store_visits v
    JOIN users u ON u.id = v.submitted_by_id
    ${where}
    GROUP BY u.full_name, v.submitted_by_id, v.store_address, COALESCE(v.visit_type, 'normal')
    ORDER BY u.full_name, v.store_address, COALESCE(v.visit_type, 'normal')
  `, params)

  const typeCounts = await query<{ visit_type: string; count: string }>(`
    SELECT COALESCE(v.visit_type, 'normal') AS visit_type, COUNT(*)::text AS count
    FROM dm_store_visits v
    JOIN users u ON u.id = v.submitted_by_id
    ${where}
    GROUP BY COALESCE(v.visit_type, 'normal')
  `, params)

  // Individual visit records for detail view
  const visitRecords = await query<{
    id: string; dm_name: string; store_address: string; visit_type: string; submitted_at: string
    assigned_rdm: string | null; reason_for_visit: string | null
    intentionality: string | null; quick_interaction_notes: string | null
    quick_takeaways: string | null; quick_actions: string | null; quick_impact: string | null
    additional_comments: string | null
    employees_working: string | null; scorecard_grade: string | null
    pre_visit_1: string | null; pre_visit_2: string | null; pre_visit_3: string | null
    scorecard_1: string | null; scorecard_2: string | null; scorecard_3: string | null
    live_interaction_observed: boolean | null
    coaching_1: string | null; coaching_3: string | null
    impact_1: string | null; impact_2: string | null; impact_3: string | null; impact_4: string | null
    ops_notes: string | null
    // Coaching data (from dm_coaching_checklists for quick_coaching visits)
    coaching_employee_name: string | null
    coaching_obs_greeted_customer: boolean | null; coaching_obs_offered_mim: boolean | null
    coaching_obs_offered_hsi: boolean | null; coaching_obs_pitched_accessories: boolean | null
    coaching_obs_open_ended_questions: boolean | null; coaching_obs_educated_survey: boolean | null
    coaching_obs_primary_issue: string | null
    coaching_rp_demonstrated_mim: boolean | null; coaching_rp_demonstrated_hsi: boolean | null
    coaching_rp_score: string | null; coaching_rp_notes: string | null
    coaching_kc_mim_knowledge: string | null; coaching_kc_hsi_knowledge: string | null
    coaching_kc_objection_handling: string | null; coaching_kc_gap_notes: string | null
    coaching_commitments_gained: string | null; coaching_fu_follow_up_date: string | null
  }>(`
    SELECT v.id, u.full_name AS dm_name, v.store_address, COALESCE(v.visit_type, 'normal') AS visit_type,
           v.submitted_at::text, v.assigned_rdm, v.reason_for_visit,
           v.intentionality, v.quick_interaction_notes, v.quick_takeaways, v.quick_actions, v.quick_impact,
           v.additional_comments, v.employees_working, v.scorecard_grade,
           v.pre_visit_1, v.pre_visit_2, v.pre_visit_3,
           v.scorecard_1, v.scorecard_2, v.scorecard_3,
           v.live_interaction_observed,
           v.coaching_1, v.coaching_3,
           v.impact_1, v.impact_2, v.impact_3, v.impact_4,
           v.ops_notes, v.photo_keys,
           cc.employee_name AS coaching_employee_name,
           cc.obs_greeted_customer AS coaching_obs_greeted_customer, cc.obs_offered_mim AS coaching_obs_offered_mim,
           cc.obs_offered_hsi AS coaching_obs_offered_hsi, cc.obs_pitched_accessories AS coaching_obs_pitched_accessories,
           cc.obs_open_ended_questions AS coaching_obs_open_ended_questions, cc.obs_educated_survey AS coaching_obs_educated_survey,
           cc.obs_primary_issue AS coaching_obs_primary_issue,
           cc.rp_demonstrated_mim AS coaching_rp_demonstrated_mim, cc.rp_demonstrated_hsi AS coaching_rp_demonstrated_hsi,
           cc.rp_score AS coaching_rp_score, cc.rp_notes AS coaching_rp_notes,
           cc.kc_mim_knowledge AS coaching_kc_mim_knowledge, cc.kc_hsi_knowledge AS coaching_kc_hsi_knowledge,
           cc.kc_objection_handling AS coaching_kc_objection_handling, cc.kc_gap_notes AS coaching_kc_gap_notes,
           cc.commitments_gained AS coaching_commitments_gained, cc.fu_follow_up_date AS coaching_fu_follow_up_date
    FROM dm_store_visits v
    JOIN users u ON u.id = v.submitted_by_id
    LEFT JOIN LATERAL (
      SELECT * FROM dm_coaching_checklists c
      WHERE c.submitted_by_id = v.submitted_by_id
        AND c.store_address = v.store_address
        AND c.submitted_at BETWEEN v.submitted_at - INTERVAL '5 minutes' AND v.submitted_at + INTERVAL '5 minutes'
      ORDER BY c.submitted_at DESC LIMIT 1
    ) cc ON COALESCE(v.visit_type, 'normal') = 'quick_coaching'
    ${where}
    ORDER BY v.submitted_at DESC
    LIMIT 200
  `, params)

  // Resolve photo URLs for visits that have photos
  const { getReceiptViewUrl } = await import('@/lib/s3')
  const visitRecordsWithPhotos = await Promise.all(
    (visitRecords as Record<string, unknown>[]).map(async v => {
      const keys = (v.photo_keys as string[]) ?? []
      if (keys.length === 0) return { ...v, photo_urls: [] }
      const urls = await Promise.all(keys.map(k => getReceiptViewUrl(k).catch(() => null)))
      return { ...v, photo_urls: urls.filter(Boolean) }
    })
  )

  return NextResponse.json({ rows, typeCounts, visitRecords: visitRecordsWithPhotos })
}

// POST — submit new checklist
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try { await ensureTable() } catch { /* already exists */ }
  try { await ensureQuickColumns() } catch {}

  const body = await req.json()

  // ── Quick Visit (with optional coaching) ─────────────────────────────────
  if (body.visit_type === 'quick' || body.visit_type === 'quick_coaching') {
    if (!body.store_address) return NextResponse.json({ error: 'store_address required' }, { status: 400 })
    if (!body.quick_takeaways?.trim()) return NextResponse.json({ error: 'quick_takeaways required' }, { status: 400 })
    // quick_actions is now optional (merged into quick_takeaways on frontend)
    if (!body.quick_impact?.trim()) return NextResponse.json({ error: 'quick_impact required' }, { status: 400 })

    const quickRdm = body.assigned_rdm || 'Quick Visit'

    const [visit] = await query<{ id: string; submitted_at: string }>(`
      INSERT INTO dm_store_visits (
        org_id, submitted_by_id,
        store_location_id, store_address, employees_working, dm_name,
        assigned_rdm, reason_for_visit,
        pre_visit_1, pre_visit_2, pre_visit_3,
        scorecard_grade, scorecard_1, scorecard_2, scorecard_3,
        live_interaction_observed,
        ops_check_1, ops_check_2, ops_check_3, ops_check_4, ops_check_5,
        coaching_1, coaching_2, coaching_3,
        impact_1, impact_2, impact_3, impact_4,
        visit_type, quick_interaction_notes, quick_takeaways, quick_actions, quick_impact, intentionality, photo_keys
      ) VALUES (
        $1, $2,
        $3, $4, '', $5,
        $6, 'Quick Visit',
        '', '', '',
        'N/A', '', '', '',
        false,
        false, false, false, false, false,
        '', '', '',
        '', '', '', '',
        $12, $7, $8, $9, $10, $11, $13
      ) RETURNING id, submitted_at
    `, [
      session.org_id ?? null, session.id,
      body.store_location_id || null, body.store_address, session.fullName,
      quickRdm,
      body.quick_interaction_notes || null,
      body.quick_takeaways.trim(),
      body.quick_actions?.trim() || null,
      body.quick_impact.trim(),
      body.intentionality?.trim() || null,
      body.visit_type === 'quick_coaching' ? 'quick_coaching' : 'quick',
      body.photoKeys?.length ? body.photoKeys : [],
    ])

    // Save coaching record if included
    const c = body.coaching
    if (body.visit_type === 'quick_coaching' && c?.employee_name?.trim()) {
      query(
        `INSERT INTO dm_coaching_checklists (
          org_id, store_id, store_address, submitted_by_id, submitted_by_name, employee_name,
          obs_greeted_customer, obs_offered_mim, obs_offered_hsi, obs_pitched_accessories, obs_open_ended_questions, obs_educated_survey, obs_primary_issue,
          rp_demonstrated_mim, rp_demonstrated_hsi, rp_score, rp_notes,
          kc_mim_knowledge, kc_hsi_knowledge, kc_objection_handling, kc_gap_notes,
          commitments_gained, fu_follow_up_date
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23
        )`,
        [
          session.org_id ?? null, body.store_location_id || null, body.store_address, session.id, session.fullName, c.employee_name.trim(),
          !!c.obs_greeted_customer, !!c.obs_offered_mim, !!c.obs_offered_hsi, !!c.obs_pitched_accessories, !!c.obs_open_ended_questions, !!c.obs_educated_survey, c.obs_primary_issue || null,
          !!c.rp_demonstrated_mim, !!c.rp_demonstrated_hsi, c.rp_score || null, c.rp_notes?.trim() || null,
          c.kc_mim_knowledge || null, c.kc_hsi_knowledge || null, c.kc_objection_handling || null, c.kc_gap_notes?.trim() || null,
          c.commitments_gained?.trim() || null, c.fu_follow_up_date?.trim() || null,
        ]
      ).catch(err => console.error('Coaching record save error:', err))
    }

    // Build coaching email section
    const yn = (v: boolean) => v ? '<span style="color:#16a34a;font-weight:600">Yes</span>' : '<span style="color:#dc2626;font-weight:600">No</span>'
    const coachingHtml = (body.visit_type === 'quick_coaching' && c?.employee_name?.trim()) ? `
      <div style="background:#f3f4f6;padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#7c3aed">DM Coaching — ${c.employee_name.trim()}</div>
      <div style="padding:12px 10px;border-bottom:1px solid #e5e7eb">
        <p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 6px">Observe</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:3px 0;color:#374151">Greeted customer within 5 seconds?</td><td style="text-align:right">${yn(!!c.obs_greeted_customer)}</td></tr>
          <tr><td style="padding:3px 0;color:#374151">Offered MIM?</td><td style="text-align:right">${yn(!!c.obs_offered_mim)}</td></tr>
          <tr><td style="padding:3px 0;color:#374151">Offered HSI?</td><td style="text-align:right">${yn(!!c.obs_offered_hsi)}</td></tr>
          <tr><td style="padding:3px 0;color:#374151">Pitched accessories?</td><td style="text-align:right">${yn(!!c.obs_pitched_accessories)}</td></tr>
          <tr><td style="padding:3px 0;color:#374151">Asked open ended questions?</td><td style="text-align:right">${yn(!!c.obs_open_ended_questions)}</td></tr>
          <tr><td style="padding:3px 0;color:#374151">Educated on the survey?</td><td style="text-align:right">${yn(!!c.obs_educated_survey)}</td></tr>
        </table>
        ${c.obs_primary_issue ? `<p style="margin:6px 0 0;font-size:13px;color:#6b7280">Primary Issue: <strong style="color:#111827">${c.obs_primary_issue}</strong></p>` : ''}
      </div>
      ${c.rp_score ? `<div style="padding:12px 10px;border-bottom:1px solid #e5e7eb"><p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 4px">Role Play</p><p style="font-size:13px;color:#374151">Score: <strong>${c.rp_score}</strong></p>${c.rp_notes?.trim() ? `<p style="font-size:13px;color:#374151;margin:4px 0 0">${c.rp_notes.trim()}</p>` : ''}</div>` : ''}
      ${(c.kc_mim_knowledge || c.kc_hsi_knowledge || c.kc_objection_handling) ? `<div style="padding:12px 10px;border-bottom:1px solid #e5e7eb"><p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 4px">Knowledge Check</p><table style="width:100%;border-collapse:collapse;font-size:13px">${c.kc_mim_knowledge ? `<tr><td style="padding:3px 0;color:#374151">MIM Knowledge</td><td style="text-align:right;font-weight:600;color:${c.kc_mim_knowledge === 'Pass' ? '#16a34a' : '#dc2626'}">${c.kc_mim_knowledge}</td></tr>` : ''}${c.kc_hsi_knowledge ? `<tr><td style="padding:3px 0;color:#374151">HSI Knowledge</td><td style="text-align:right;font-weight:600;color:${c.kc_hsi_knowledge === 'Pass' ? '#16a34a' : '#dc2626'}">${c.kc_hsi_knowledge}</td></tr>` : ''}${c.kc_objection_handling ? `<tr><td style="padding:3px 0;color:#374151">Objection Handling</td><td style="text-align:right;font-weight:600;color:${c.kc_objection_handling === 'Pass' ? '#16a34a' : '#dc2626'}">${c.kc_objection_handling}</td></tr>` : ''}</table>${c.kc_gap_notes?.trim() ? `<p style="font-size:13px;color:#374151;margin:6px 0 0">${c.kc_gap_notes.trim()}</p>` : ''}</div>` : ''}
      ${c.commitments_gained?.trim() ? `<div style="padding:12px 10px;border-bottom:1px solid #e5e7eb"><p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 4px">Commitments Gained</p><p style="font-size:13px;color:#374151">${c.commitments_gained.trim()}</p></div>` : ''}
      ${c.fu_follow_up_date?.trim() ? `<div style="padding:12px 10px;border-bottom:1px solid #e5e7eb"><p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 4px">Follow-Up Date</p><p style="font-size:13px;color:#374151">${c.fu_follow_up_date.trim()}</p></div>` : ''}
    ` : ''

    // Email copy to selected RDM + DM
    const rdmEmail = RDM_EMAILS[quickRdm]
    if (rdmEmail) {
      const visitDate = new Date(visit.submitted_at).toLocaleDateString('en-US', {
        timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
      const visitLabel = body.visit_type === 'quick_coaching' ? 'Quick Visit w/ Coaching' : 'Quick Visit Report'
      const row = (label: string, value: string) =>
        `<tr><td style="padding:6px 10px;font-weight:600;color:#6b7280;width:160px;vertical-align:top;border-bottom:1px solid #e5e7eb">${label}</td><td style="padding:6px 10px;color:#111827;border-bottom:1px solid #e5e7eb">${escapeHtml(value)}</td></tr>`
      const html = `<div style="font-family:sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:8px 8px 0 0">
          <h1 style="color:white;margin:0;font-size:18px">${visitLabel}</h1>
          <p style="color:#ddd6fe;margin:4px 0 0;font-size:13px">${escapeHtml(body.store_address)} — ${visitDate}</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse">
            ${row('Store', body.store_address)}
            ${row('DM', session.fullName)}
            ${row('Assigned RDM', quickRdm)}
          </table>
          ${body.intentionality?.trim() ? `<div style="padding:12px 10px;border-bottom:1px solid #e5e7eb"><p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 4px">Intentionality</p><p style="color:#111827;margin:0;font-size:14px">${escapeHtml(body.intentionality.trim())}</p></div>` : ''}
          ${body.quick_interaction_notes ? `<div style="padding:12px 10px;border-bottom:1px solid #e5e7eb"><p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 4px">Observed Customer Interaction</p><p style="color:#111827;margin:0;font-size:14px">${escapeHtml(body.quick_interaction_notes)}</p></div>` : ''}
          <div style="padding:12px 10px;border-bottom:1px solid #e5e7eb"><p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 4px">Key Takeaways & Commitments</p><p style="color:#111827;margin:0;font-size:14px">${escapeHtml(body.quick_takeaways.trim())}</p></div>
          <div style="padding:12px 10px${coachingHtml ? ';border-bottom:1px solid #e5e7eb' : ''}"><p style="font-weight:600;color:#6b7280;font-size:12px;margin:0 0 4px">DM Visit Impact Made</p><p style="color:#111827;margin:0;font-size:14px">${escapeHtml(body.quick_impact.trim())}</p></div>
          ${coachingHtml}
        </div>
        <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px">Submitted via Field Manager Pro</p>
      </div>`

      const freshUser = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [session.id])
      const dmEmail = freshUser[0]?.email ?? session.email
      const emailTo = [rdmEmail, dmEmail]
      const subjectLine = body.visit_type === 'quick_coaching'
        ? `Quick Visit w/ Coaching — ${body.store_address} — ${visitDate}`
        : `Quick Visit — ${body.store_address} — ${visitDate}`

      resend.emails.send({
        from: 'Field Manager Pro <noreply@fieldmanagerpro.app>',
        to: emailTo,
        subject: subjectLine,
        html,
      }).catch(err => console.error('Quick visit email error:', err))
    }

    return NextResponse.json({ id: visit.id })
  }

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
    const freshUser = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [session.id])
    const to: string[] = [freshUser[0]?.email ?? session.email]
    if (rdmEmail) to.push(rdmEmail)
    const cc: string[] = []
    if (body.cc_emails) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      body.cc_emails.split(',').map((e: string) => e.trim()).filter(Boolean).filter((e: string) => emailRegex.test(e)).forEach((e: string) => cc.push(e))
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
