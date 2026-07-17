import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

const canViewAll = (role: string) =>
  role === 'ops_manager' || role === 'owner' || role === 'sales_director' || role === 'developer'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS dm_coaching_checklists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      store_id UUID NOT NULL,
      store_address TEXT NOT NULL,
      submitted_by_id UUID NOT NULL,
      submitted_by_name TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      -- Section 1: Observe
      obs_greeted_customer BOOLEAN NOT NULL DEFAULT false,
      obs_offered_mim BOOLEAN NOT NULL DEFAULT false,
      obs_offered_hsi BOOLEAN NOT NULL DEFAULT false,
      obs_pitched_accessories BOOLEAN NOT NULL DEFAULT false,
      obs_open_ended_questions BOOLEAN NOT NULL DEFAULT false,
      obs_educated_survey BOOLEAN NOT NULL DEFAULT false,
      obs_primary_issue TEXT,
      -- Section 2: Role Play
      rp_demonstrated_mim BOOLEAN NOT NULL DEFAULT false,
      rp_demonstrated_hsi BOOLEAN NOT NULL DEFAULT false,
      rp_score TEXT,
      rp_notes TEXT,
      -- Section 3: Knowledge Check
      kc_mim_knowledge TEXT,
      kc_hsi_knowledge TEXT,
      kc_objection_handling TEXT,
      kc_gap_notes TEXT,
      -- Section 4: Commitments Gained
      commitments_gained TEXT,
      se_mim_target TEXT,
      se_hsi_target TEXT,
      se_voice_target TEXT,
      -- Section 5: Follow-Up
      fu_follow_up_date TEXT,
      -- Legacy columns (kept for existing data)
      fu_2pm_checkin BOOLEAN NOT NULL DEFAULT false,
      fu_5pm_checkin BOOLEAN NOT NULL DEFAULT false,
      vs_top_issue TEXT,
      vs_action_taken TEXT,
      vs_next_focus TEXT
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_coaching_org ON dm_coaching_checklists(org_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_coaching_submitted_by ON dm_coaching_checklists(submitted_by_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_dm_coaching_date ON dm_coaching_checklists(submitted_at)`)
  // Columns added after initial deploy
  await query(`ALTER TABLE dm_coaching_checklists ADD COLUMN IF NOT EXISTS obs_pitched_accessories BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE dm_coaching_checklists ADD COLUMN IF NOT EXISTS se_voice_target TEXT`)
  await query(`ALTER TABLE dm_coaching_checklists ADD COLUMN IF NOT EXISTS fu_follow_up_date TEXT`)
  await query(`ALTER TABLE dm_coaching_checklists ADD COLUMN IF NOT EXISTS commitments_gained TEXT`)
  await query(`ALTER TABLE dm_coaching_checklists ADD COLUMN IF NOT EXISTS obs_open_ended_questions BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE dm_coaching_checklists ADD COLUMN IF NOT EXISTS obs_educated_survey BOOLEAN NOT NULL DEFAULT false`)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch { /* already exists */ }

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const dmId = searchParams.get('dmId')

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []

  let where = 'WHERE 1=1'
  where += appendOrgFilter(orgFilter, params, 'c')

  if (!canViewAll(session.role)) {
    params.push(session.id)
    where += ` AND c.submitted_by_id = $${params.length}`
  } else if (dmId) {
    params.push(dmId)
    where += ` AND c.submitted_by_id = $${params.length}`
  }

  if (from) { params.push(from); where += ` AND c.submitted_at >= $${params.length}` }
  if (to) { params.push(to + 'T23:59:59'); where += ` AND c.submitted_at <= $${params.length}` }

  const rows = await query<{
    id: string
    dm_name: string
    submitted_by_id: string
    store_address: string
    employee_name: string
    submitted_at: string
    count: string
    obs_greeted_customer: boolean
    obs_offered_mim: boolean
    obs_offered_hsi: boolean
    obs_pitched_accessories: boolean
    obs_open_ended_questions: boolean
    obs_educated_survey: boolean
    obs_primary_issue: string | null
    rp_demonstrated_mim: boolean
    rp_demonstrated_hsi: boolean
    rp_score: string | null
    rp_notes: string | null
    kc_mim_knowledge: string | null
    kc_hsi_knowledge: string | null
    kc_objection_handling: string | null
    kc_gap_notes: string | null
    commitments_gained: string | null
    fu_follow_up_date: string | null
  }>(`
    SELECT c.id, u.full_name AS dm_name, c.submitted_by_id, c.store_address,
           c.employee_name, c.submitted_at::text,
           COUNT(*) OVER (PARTITION BY c.submitted_by_id, c.store_address)::text AS count,
           c.obs_greeted_customer, c.obs_offered_mim, c.obs_offered_hsi, c.obs_pitched_accessories, c.obs_open_ended_questions, c.obs_educated_survey, c.obs_primary_issue,
           c.rp_demonstrated_mim, c.rp_demonstrated_hsi, c.rp_score, c.rp_notes,
           c.kc_mim_knowledge, c.kc_hsi_knowledge, c.kc_objection_handling, c.kc_gap_notes,
           c.commitments_gained,
           c.fu_follow_up_date
    FROM dm_coaching_checklists c
    JOIN users u ON u.id = c.submitted_by_id
    ${where}
    ORDER BY u.full_name, c.store_address, c.submitted_at DESC
  `, params)

  return NextResponse.json({ rows })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch { /* already exists */ }

  const body = await req.json()
  const {
    store_location_id, store_address, employee_name,
    obs_greeted_customer, obs_offered_mim, obs_offered_hsi, obs_pitched_accessories, obs_open_ended_questions, obs_educated_survey, obs_primary_issue,
    rp_demonstrated_mim, rp_demonstrated_hsi, rp_score, rp_notes,
    kc_mim_knowledge, kc_hsi_knowledge, kc_objection_handling, kc_gap_notes,
    commitments_gained,
    fu_follow_up_date,
  } = body

  if (!store_location_id || !employee_name?.trim()) {
    return NextResponse.json({ error: 'Store and employee name are required' }, { status: 400 })
  }

  const [row] = await query<{ id: string; submitted_at: string }>(
    `INSERT INTO dm_coaching_checklists (
      org_id, store_id, store_address, submitted_by_id, submitted_by_name, employee_name,
      obs_greeted_customer, obs_offered_mim, obs_offered_hsi, obs_pitched_accessories, obs_open_ended_questions, obs_educated_survey, obs_primary_issue,
      rp_demonstrated_mim, rp_demonstrated_hsi, rp_score, rp_notes,
      kc_mim_knowledge, kc_hsi_knowledge, kc_objection_handling, kc_gap_notes,
      commitments_gained,
      fu_follow_up_date
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17,
      $18, $19, $20, $21,
      $22,
      $23
    ) RETURNING id, submitted_at`,
    [
      session.org_id ?? null, store_location_id, store_address, session.id, session.fullName, employee_name.trim(),
      !!obs_greeted_customer, !!obs_offered_mim, !!obs_offered_hsi, !!obs_pitched_accessories, !!obs_open_ended_questions, !!obs_educated_survey, obs_primary_issue || null,
      !!rp_demonstrated_mim, !!rp_demonstrated_hsi, rp_score || null, rp_notes?.trim() || null,
      kc_mim_knowledge || null, kc_hsi_knowledge || null, kc_objection_handling || null, kc_gap_notes?.trim() || null,
      commitments_gained?.trim() || null,
      fu_follow_up_date?.trim() || null,
    ]
  )

  return NextResponse.json({ ok: true, id: row.id })
}
