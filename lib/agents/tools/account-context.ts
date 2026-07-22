import { query, queryOne } from '@/lib/db'
import { scrubPII } from '../runtime/guardrails'

// READ-ONLY account support context tool.
// This module has ZERO write functions. It returns diagnostic data only.
// Every field is PII-scrubbed before returning.

function maskEmail(email: string | null): string {
  if (!email) return '[none]'
  const [local, domain] = email.split('@')
  return `${local[0]}***@${domain}`
}

function maskPhone(phone: string | null): string {
  if (!phone) return '[none]'
  return `***-***-${phone.slice(-4)}`
}

export interface AccountSupportContext {
  // User profile (safe fields only)
  user: {
    id: string
    full_name: string
    username: string
    role: string
    is_active: boolean
    is_floater: boolean
    is_ops_collab: boolean
    is_hidden: boolean
    approval_status: string | null
    pay_type: string | null
    must_change_password: boolean
    manager_name: string | null
    manager_id: string | null
    created_at: string
    email_masked: string
  } | null

  // Team (for DMs: who reports to them)
  team: { id: string; full_name: string; role: string; is_floater: boolean; is_active: boolean }[]

  // Store assignments (DM's stores)
  stores: { id: string; address: string; active: boolean }[]

  // Current shift status
  active_shift: { id: string; clock_in_at: string; store_address: string | null } | null

  // Schedule published status for current week
  schedule_published: boolean

  // Time off requests (dates only, no details)
  pending_time_off: { start_date: string; end_date: string; status: string }[]

  // Payroll period status
  payroll: { period_start: string; period_end: string; status: string; dm_submitted: boolean } | null

  // Barbershop-specific
  barber_profile: { is_listed: boolean; services_count: number; availability_set: boolean } | null
  shop_settings: { has_shop: boolean; shop_code: string | null; hours_set: boolean } | null
  pending_appointments: number

  // Org info
  org: { name: string; industry: string } | null
}

export async function getAccountSupportContext(
  userId: string,
  orgId: string | null
): Promise<AccountSupportContext> {
  // ── User profile ──
  const user = await queryOne<{
    id: string; full_name: string; username: string; role: string; email: string
    is_active: boolean; is_floater: boolean; is_ops_collab: boolean; is_hidden: boolean
    approval_status: string | null; pay_type: string | null; must_change_password: boolean
    manager_id: string | null; manager_name: string | null; created_at: string
  }>(`
    SELECT u.id, u.full_name, u.username, u.role, u.email,
      u.is_active, COALESCE(u.is_floater, false) as is_floater,
      COALESCE(u.is_ops_collab, false) as is_ops_collab,
      COALESCE(u.is_hidden, false) as is_hidden,
      u.approval_status, u.pay_type,
      COALESCE(u.must_change_password, false) as must_change_password,
      u.manager_id, m.full_name as manager_name,
      u.created_at::text
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.id = $1
  `, [userId])

  // Scope check: user must belong to the requesting org
  if (user && orgId) {
    const orgCheck = await queryOne<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [userId])
    if (orgCheck?.org_id !== orgId) {
      return emptyContext()
    }
  }

  // ── Team (for DMs) ──
  let team: AccountSupportContext['team'] = []
  if (user && (user.role === 'manager' || user.role === 'ops_manager' || user.role === 'sales_director' || user.role === 'owner' || user.role === 'developer')) {
    team = await query<{ id: string; full_name: string; role: string; is_floater: boolean; is_active: boolean }>(`
      SELECT id, full_name, role, COALESCE(is_floater, false) as is_floater, is_active
      FROM users WHERE manager_id = $1 AND role = 'employee'
      ORDER BY full_name
    `, [userId])
  }

  // ── Stores ──
  let stores: AccountSupportContext['stores'] = []
  const dmId = user?.role === 'manager' ? userId : user?.manager_id
  if (dmId) {
    stores = await query<{ id: string; address: string; active: boolean }>(`
      SELECT dsl.id, dsl.address, dsl.active
      FROM dm_manager_stores dms
      JOIN dm_store_locations dsl ON dsl.id = dms.store_location_id
      WHERE dms.manager_id = $1
      ORDER BY dsl.address
    `, [dmId])
  }

  // ── Active shift ──
  const activeShift = await queryOne<{ id: string; clock_in_at: string; store_address: string | null }>(`
    SELECT s.id, s.clock_in_at::text,
      dsl.address as store_address
    FROM shifts s
    LEFT JOIN dm_store_locations dsl ON dsl.id = s.store_location_id
    WHERE s.user_id = $1 AND s.clock_out_at IS NULL
    ORDER BY s.clock_in_at DESC LIMIT 1
  `, [userId])

  // ── Schedule published ──
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const weekStart = monday.toISOString().split('T')[0]

  let schedulePub = false
  if (stores.length > 0) {
    const pub = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM scheduled_shifts_publish
        WHERE store_location_id = ANY($1) AND week_start = $2
      ) as exists
    `, [stores.map(s => s.id), weekStart])
    schedulePub = pub?.exists ?? false
  }

  // ── Time off ──
  const timeOff = await query<{ start_date: string; end_date: string; status: string }>(`
    SELECT start_date::text, end_date::text, status
    FROM time_off_requests
    WHERE user_id = $1 AND status IN ('pending', 'approved') AND end_date >= CURRENT_DATE
    ORDER BY start_date
    LIMIT 10
  `, [userId])

  // ── Payroll ──
  let payroll: AccountSupportContext['payroll'] = null
  if (orgId) {
    const pp = await queryOne<{ period_start: string; period_end: string; status: string; id: string }>(`
      SELECT id, period_start::text, period_end::text, status
      FROM payroll_periods
      WHERE org_id = $1
      ORDER BY period_start DESC LIMIT 1
    `, [orgId])
    if (pp) {
      const dmSub = await queryOne<{ exists: boolean }>(`
        SELECT EXISTS(
          SELECT 1 FROM payroll_dm_approvals WHERE period_id = $1 AND dm_id = $2
        ) as exists
      `, [pp.id, user?.role === 'manager' ? userId : user?.manager_id ?? userId])
      payroll = { ...pp, dm_submitted: dmSub?.exists ?? false }
    }
  }

  // ── Barbershop: barber profile ──
  let barberProfile: AccountSupportContext['barber_profile'] = null
  if (user?.role === 'barber' || user?.role === 'shop_owner') {
    const bp = await queryOne<{ is_listed: boolean; services_count: number; availability_set: boolean }>(`
      SELECT bp.is_listed,
        (SELECT COUNT(*)::int FROM barber_services bs WHERE bs.barber_id = bp.user_id AND bs.is_active = TRUE) as services_count,
        EXISTS(SELECT 1 FROM barber_availability ba WHERE ba.barber_id = bp.id) as availability_set
      FROM barber_profiles bp
      WHERE bp.user_id = $1
    `, [userId])
    if (bp) barberProfile = bp
  }

  // ── Barbershop: shop settings ──
  let shopSettings: AccountSupportContext['shop_settings'] = null
  if (orgId && (user?.role === 'shop_owner' || user?.role === 'barber')) {
    const ss = await queryOne<{ shop_code: string | null; hours_set: boolean }>(`
      SELECT ss.shop_code,
        EXISTS(SELECT 1 FROM shop_settings WHERE org_id = $1) as hours_set
      FROM shop_settings ss
      WHERE ss.org_id = $1
    `, [orgId])
    shopSettings = ss ? { has_shop: true, shop_code: ss.shop_code, hours_set: ss.hours_set } : { has_shop: false, shop_code: null, hours_set: false }
  }

  // ── Barbershop: pending appointments ──
  let pendingAppts = 0
  if (user?.role === 'barber' || user?.role === 'shop_owner') {
    const pa = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int as count FROM appointments
      WHERE barber_id = $1 AND status = 'pending'
    `, [userId])
    pendingAppts = pa?.count ?? 0
  }

  // ── Org ──
  let org: AccountSupportContext['org'] = null
  if (orgId) {
    const o = await queryOne<{ name: string; industry: string }>(`
      SELECT name, COALESCE(industry, 'unknown') as industry FROM organizations WHERE id = $1
    `, [orgId])
    if (o) org = o
  }

  return {
    user: user ? {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      role: user.role,
      is_active: user.is_active,
      is_floater: user.is_floater,
      is_ops_collab: user.is_ops_collab,
      is_hidden: user.is_hidden,
      approval_status: user.approval_status,
      pay_type: user.pay_type,
      must_change_password: user.must_change_password,
      manager_name: user.manager_name,
      manager_id: user.manager_id,
      created_at: user.created_at,
      email_masked: maskEmail(user.email),
    } : null,
    team,
    stores,
    active_shift: activeShift,
    schedule_published: schedulePub,
    pending_time_off: timeOff,
    payroll,
    barber_profile: barberProfile,
    shop_settings: shopSettings,
    pending_appointments: pendingAppts,
    org,
  }
}

function emptyContext(): AccountSupportContext {
  return {
    user: null, team: [], stores: [], active_shift: null,
    schedule_published: false, pending_time_off: [], payroll: null,
    barber_profile: null, shop_settings: null, pending_appointments: 0, org: null,
  }
}
