import { query } from '@/lib/db'
import type { Tool, RunContext } from '../types'

// ── Normalized signal shape — same for every vertical ────────────────────────
export interface AccountSignals {
  account_id: string
  account_name: string
  industry: string
  status: string
  created_at: string
  contact_email: string | null
  age_days: number
  total_users: number
  active_users_7d: number
  user_engagement_pct: number
  last_activity_at: string | null
  days_since_activity: number | null
  activity_count_7d: number
  activity_count_prev_7d: number
  activity_trend_pct: number | null
  features_used: string[]
  unsupported_vertical?: boolean
}

// ── Vertical signal provider interface ───────────────────────────────────────
interface VerticalSignals {
  total_users: number
  active_users_7d: number
  last_activity_at: string | null
  activity_count_7d: number
  activity_count_prev_7d: number
  features_used: string[]
}

type VerticalProvider = (orgId: string) => Promise<VerticalSignals>

// ── Retail provider (wireless_retail) ────────────────────────────────────────
const retailProvider: VerticalProvider = async (orgId) => {
  const [row] = await query<{
    total_users: number; active_users_7d: number; last_activity: string | null
    shifts_7d: number; shifts_prev_7d: number
    checklists_7d: number; schedules_7d: number; tasks_7d: number; gps_7d: number
  }>(`
    SELECT
      (SELECT COUNT(*) FROM users u WHERE u.org_id = $1 AND u.is_active = TRUE)::int AS total_users,
      (SELECT COUNT(DISTINCT s.user_id) FROM shifts s JOIN users u ON u.id = s.user_id WHERE u.org_id = $1 AND s.clock_in_at > NOW() - INTERVAL '7 days')::int AS active_users_7d,
      (SELECT MAX(s.clock_in_at)::text FROM shifts s JOIN users u ON u.id = s.user_id WHERE u.org_id = $1) AS last_activity,
      (SELECT COUNT(*) FROM shifts s JOIN users u ON u.id = s.user_id WHERE u.org_id = $1 AND s.clock_in_at > NOW() - INTERVAL '7 days')::int AS shifts_7d,
      (SELECT COUNT(*) FROM shifts s JOIN users u ON u.id = s.user_id WHERE u.org_id = $1 AND s.clock_in_at > NOW() - INTERVAL '14 days' AND s.clock_in_at <= NOW() - INTERVAL '7 days')::int AS shifts_prev_7d,
      (SELECT COUNT(*) FROM checklist_submissions cs WHERE cs.org_id = $1 AND cs.submitted_at > NOW() - INTERVAL '7 days')::int AS checklists_7d,
      (SELECT COUNT(*) FROM scheduled_shifts ss WHERE ss.org_id = $1 AND ss.shift_date > CURRENT_DATE - 7)::int AS schedules_7d,
      (SELECT COUNT(*) FROM tasks t WHERE t.org_id = $1 AND t.created_at > NOW() - INTERVAL '7 days')::int AS tasks_7d,
      (SELECT COUNT(*) FROM gps_breadcrumbs g JOIN shifts s ON s.id = g.shift_id JOIN users u ON u.id = s.user_id WHERE u.org_id = $1 AND g.recorded_at > NOW() - INTERVAL '7 days')::int AS gps_7d
  `, [orgId])

  if (!row) return { total_users: 0, active_users_7d: 0, last_activity_at: null, activity_count_7d: 0, activity_count_prev_7d: 0, features_used: [] }

  const features: string[] = []
  if (row.shifts_7d > 0) features.push('clock-in')
  if (row.checklists_7d > 0) features.push('checklists')
  if (row.schedules_7d > 0) features.push('scheduling')
  if (row.tasks_7d > 0) features.push('tasks')
  if (row.gps_7d > 0) features.push('gps-tracking')

  return {
    total_users: row.total_users,
    active_users_7d: row.active_users_7d,
    last_activity_at: row.last_activity,
    activity_count_7d: row.shifts_7d,
    activity_count_prev_7d: row.shifts_prev_7d,
    features_used: features,
  }
}

// ── Barbershop provider ──────────────────────────────────────────────────────
const barbershopProvider: VerticalProvider = async (orgId) => {
  const [row] = await query<{
    total_users: number
    active_barbers_7d: number
    active_customers_7d: number
    last_activity: string | null
    appointments_7d: number
    appointments_prev_7d: number
    has_barber_profiles: boolean
    has_services: boolean
    has_shop_settings: boolean
    customers_total: number
  }>(`
    SELECT
      (SELECT COUNT(*) FROM users u WHERE u.org_id = $1 AND u.is_active = TRUE)::int AS total_users,
      (SELECT COUNT(DISTINCT a.barber_id) FROM appointments a WHERE a.org_id = $1 AND a.created_at > NOW() - INTERVAL '7 days')::int AS active_barbers_7d,
      (SELECT COUNT(DISTINCT a.customer_id) FROM appointments a WHERE a.org_id = $1 AND a.created_at > NOW() - INTERVAL '7 days')::int AS active_customers_7d,
      (SELECT GREATEST(
        MAX(a.created_at),
        (SELECT MAX(bp.updated_at) FROM barber_profiles bp WHERE bp.org_id = $1)
      )::text FROM appointments a WHERE a.org_id = $1) AS last_activity,
      (SELECT COUNT(*) FROM appointments a WHERE a.org_id = $1 AND a.created_at > NOW() - INTERVAL '7 days')::int AS appointments_7d,
      (SELECT COUNT(*) FROM appointments a WHERE a.org_id = $1 AND a.created_at > NOW() - INTERVAL '14 days' AND a.created_at <= NOW() - INTERVAL '7 days')::int AS appointments_prev_7d,
      EXISTS(SELECT 1 FROM barber_profiles bp WHERE bp.org_id = $1) AS has_barber_profiles,
      EXISTS(SELECT 1 FROM barber_services bs JOIN users u ON u.id = bs.barber_id WHERE u.org_id = $1 AND bs.is_active = TRUE) AS has_services,
      EXISTS(SELECT 1 FROM shop_settings ss WHERE ss.org_id = $1) AS has_shop_settings,
      (SELECT COUNT(*) FROM customer_profiles cp WHERE cp.org_id = $1)::int AS customers_total
  `, [orgId])

  if (!row) return { total_users: 0, active_users_7d: 0, last_activity_at: null, activity_count_7d: 0, activity_count_prev_7d: 0, features_used: [] }

  // Active users = distinct barbers + customers with appointments in 7d
  const activeUsers = row.active_barbers_7d + row.active_customers_7d

  const features: string[] = []
  if (row.appointments_7d > 0) features.push('appointments')
  if (row.has_barber_profiles) features.push('barber-profiles')
  if (row.has_services) features.push('services')
  if (row.has_shop_settings) features.push('shop-setup')
  if (row.customers_total > 0) features.push('customers')

  return {
    total_users: row.total_users,
    active_users_7d: activeUsers,
    last_activity_at: row.last_activity,
    activity_count_7d: row.appointments_7d,
    activity_count_prev_7d: row.appointments_prev_7d,
    features_used: features,
  }
}

// ── Provider registry ────────────────────────────────────────────────────────
const providers: Record<string, VerticalProvider> = {
  wireless_retail: retailProvider,
  barbershop: barbershopProvider,
}

function getProvider(industry: string): VerticalProvider | null {
  return providers[industry] ?? null
}

// ── Main signal computation ──────────────────────────────────────────────────
export async function computeAllAccountSignals(): Promise<AccountSignals[]> {
  const orgs = await query<{
    id: string; name: string; industry: string; status: string
    created_at: string; contact_email: string | null
  }>(`
    SELECT id, name, COALESCE(industry, 'wireless_retail') as industry,
      COALESCE(status, 'active') as status, created_at::text, contact_email
    FROM organizations
    WHERE COALESCE(status, 'active') != 'deleted'
    ORDER BY name
  `)

  const results: AccountSignals[] = []

  for (const org of orgs) {
    const provider = getProvider(org.industry)

    // Unsupported vertical: do NOT score, return error marker
    if (!provider) {
      results.push({
        account_id: org.id,
        account_name: org.name,
        industry: org.industry,
        status: org.status,
        created_at: org.created_at,
        contact_email: org.contact_email,
        age_days: Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86400000),
        total_users: 0,
        active_users_7d: 0,
        user_engagement_pct: 0,
        last_activity_at: null,
        days_since_activity: null,
        activity_count_7d: 0,
        activity_count_prev_7d: 0,
        activity_trend_pct: null,
        features_used: [],
        unsupported_vertical: true,
      })
      continue
    }

    const signals = await provider(org.id)

    const ageDays = Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86400000)
    const daysSinceActivity = signals.last_activity_at
      ? Math.floor((Date.now() - new Date(signals.last_activity_at).getTime()) / 86400000)
      : null
    const engagementPct = signals.total_users > 0
      ? Math.round((signals.active_users_7d / signals.total_users) * 100)
      : 0
    const trend = signals.activity_count_prev_7d > 0
      ? Math.round(((signals.activity_count_7d - signals.activity_count_prev_7d) / signals.activity_count_prev_7d) * 100)
      : null

    results.push({
      account_id: org.id,
      account_name: org.name,
      industry: org.industry,
      status: org.status,
      created_at: org.created_at,
      contact_email: org.contact_email,
      age_days: ageDays,
      total_users: signals.total_users,
      active_users_7d: signals.active_users_7d,
      user_engagement_pct: engagementPct,
      last_activity_at: signals.last_activity_at,
      days_since_activity: daysSinceActivity,
      activity_count_7d: signals.activity_count_7d,
      activity_count_prev_7d: signals.activity_count_prev_7d,
      activity_trend_pct: trend,
      features_used: signals.features_used,
    })
  }

  return results
}

// Tool: get all account signals (for Health Agent)
export const getAccountSignalsTool: Tool = {
  name: 'get_account_signals',
  description: 'Fetch precomputed usage signals for all active FMP accounts. Signals are vertical-aware: retail accounts are measured by shifts/checklists/GPS, barbershop accounts by appointments/profiles/services. Returns normalized engagement metrics, feature usage, and activity trends for the last 7 days.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async run(_input: Record<string, unknown>, _ctx: RunContext) {
    return await computeAllAccountSignals()
  },
}
