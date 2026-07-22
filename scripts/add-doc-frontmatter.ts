// Script to add frontmatter mappings to all knowledge docs
// Run with: npx tsx scripts/add-doc-frontmatter.ts

import * as fs from 'fs'
import * as path from 'path'

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'lib', 'agents', 'knowledge')
const TODAY = new Date().toISOString().split('T')[0]

interface DocMapping {
  file: string
  sources: string[]
  features: string[]
  permissions: string[]
}

const MAPPINGS: DocMapping[] = [
  // ── wireless_retail ──
  { file: 'wireless_retail/clock-in.md', sources: ['app/api/clock/in/route.ts', 'app/api/clock/out/route.ts', 'app/clock/page.tsx', 'app/api/clock/my-stores/route.ts'], features: ['clock-in', 'clock-out', 'gps-tracking', 'handoff-notes', 'late-clock-in-flag'], permissions: ['all retail roles can clock in/out', 'employees must select a store', 'late clock-in flag has no grace period'] },
  { file: 'wireless_retail/breaks.md', sources: ['app/api/clock/break/route.ts', 'app/clock/page.tsx'], features: ['breaks', 'break-start', 'break-end'], permissions: ['all retail roles can start/end own breaks', 'managers+ can manually add/edit breaks'] },
  { file: 'wireless_retail/scheduling.md', sources: ['app/api/staff-schedule/route.ts', 'app/api/staff-schedule/publish/route.ts', 'app/api/staff-schedule/copy/route.ts', 'app/api/my-schedule/route.ts', 'app/staff-schedule/page.tsx', 'app/my-schedule/page.tsx'], features: ['store-schedule', 'my-schedule', 'publish', 'copy-week'], permissions: ['employees see My Schedule only', 'DMs build and publish', 'SD+ view all'] },
  { file: 'wireless_retail/shift-swaps.md', sources: ['app/api/shift-swaps/route.ts', 'app/api/shift-swaps/[id]/route.ts', 'app/shift-swaps/page.tsx'], features: ['shift-swaps'], permissions: ['employee-only creation', 'same-DM constraint', 'DM approves'] },
  { file: 'wireless_retail/time-off.md', sources: ['app/api/time-off/route.ts', 'app/time-off/page.tsx'], features: ['time-off-requests', 'published-shift-block'], permissions: ['employees request', 'DMs approve', 'blocked if scheduled on published shift'] },
  { file: 'wireless_retail/checklists.md', sources: ['app/api/checklist/submit/route.ts', 'app/api/checklist/submissions/route.ts', 'app/checklist/page.tsx'], features: ['opening-checklist', 'closing-checklist', 'daily-metrics', 'checklist-photos'], permissions: ['all retail roles can submit', 'opening requires inventory photo', 'closing requires sales floor + cash drawer photos'] },
  { file: 'wireless_retail/tasks.md', sources: ['app/api/tasks/route.ts', 'app/api/tasks/complete/route.ts', 'app/api/tasks/remind/route.ts', 'app/tasks/page.tsx'], features: ['tasks', 'recurring-tasks', 'photo-required-tasks', 'multi-assignee', 'task-deletion'], permissions: ['DMs+ create/assign/delete', 'employees complete', 'multi-assignee creates separate tasks'] },
  { file: 'wireless_retail/timecards.md', sources: ['app/api/shifts/route.ts', 'app/timecards/page.tsx'], features: ['timecards', 'time-corrections', 'edit-history', 'dm-edit-activity'], permissions: ['employees view own only', 'DMs view/edit team but not own', 'SD+ edit any including locked', 'floaters filtered by manager_id'] },
  { file: 'wireless_retail/floater-timecards.md', sources: ['app/api/shifts/route.ts', 'app/api/ot-watch/route.ts', 'app/timecards/page.tsx'], features: ['floater-timecard-visibility', 'ot-watch-floater-inclusion'], permissions: ['timecards filtered by manager_id only', 'OT watch includes floaters across all DMs'] },
  { file: 'wireless_retail/payroll.md', sources: ['app/api/payroll/route.ts', 'app/api/payroll/approve/route.ts', 'app/api/payroll/download/route.ts', 'app/payroll/page.tsx'], features: ['payroll-submission', 'dm-approval', 'sr-approval', 'owner-notification', 'adp-csv-download', 'dm-timecards'], permissions: ['DMs submit team timecards', 'SD reviews/approves each DM', 'SD can edit after lock', 'owner gets final notification'] },
  { file: 'wireless_retail/chat.md', sources: ['app/api/chat/conversations/route.ts', 'app/api/chat/conversations/[id]/messages/route.ts', 'app/api/chat/conversations/[id]/members/route.ts', 'app/api/chat/pin/route.ts', 'app/api/chat/react/route.ts', 'app/chat/page.tsx'], features: ['chat', 'group-chat', 'direct-messages', 'reactions', 'gifs', 'pinning', 'member-management', 'mentions'], permissions: ['manager+ only', 'employees cannot access', '@mentions push even when muted'] },
  { file: 'wireless_retail/accountability.md', sources: ['app/api/accountability/route.ts', 'app/api/accountability/[id]/approve/route.ts', 'app/api/accountability/[id]/reject/route.ts', 'app/api/accountability/termination/route.ts', 'app/accountability/page.tsx'], features: ['accountability-docs', 'approval-chain', 'termination', 'acknowledgment'], permissions: ['DMs/SD/owner/dev can author', 'ops_manager view only', 'employees receive only', 'DMs can only doc direct reports'] },
  { file: 'wireless_retail/accountability-states.md', sources: ['app/api/accountability/[id]/route.ts', 'app/api/accountability/[id]/approve/route.ts', 'app/api/accountability/[id]/reject/route.ts', 'app/api/accountability/[id]/conversation-complete/route.ts', 'app/api/accountability/[id]/force-send/route.ts', 'app/api/accountability/[id]/remind/route.ts'], features: ['accountability-status-transitions', 'needs-revision', 'rejection-notes'], permissions: ['only original author can resubmit', 'rejection notes required'] },
  { file: 'wireless_retail/dm-store-visits.md', sources: ['app/api/dm-store-visits/route.ts', 'app/api/dm-store-visits/upload-url/route.ts', 'app/api/dm-coaching-checklist/route.ts', 'app/dm-visit/page.tsx'], features: ['dm-store-visits', 'quick-visit', 'coaching-checklist', 'visit-photos'], permissions: ['manager+ can submit', 'SD+ view all visits'] },
  { file: 'wireless_retail/dm-schedule.md', sources: ['app/api/dm-schedule/route.ts', 'app/dm-schedule/page.tsx'], features: ['dm-schedule', 'auto-save', 'blur-save'], permissions: ['DMs edit own', 'SD/owner/dev view all'] },
  { file: 'wireless_retail/expenses.md', sources: ['app/api/expenses/route.ts', 'app/api/expenses/scan/route.ts', 'app/expenses/page.tsx'], features: ['expenses', 'ai-receipt-scan', 'expense-approval', 'denial-note-required'], permissions: ['manager+ submit', 'SD/owner/dev approve', 'denial requires note'] },
  { file: 'wireless_retail/supplies-facilities.md', sources: ['app/api/supply-requests/route.ts', 'app/api/facility-tickets/route.ts', 'app/supply-requests/page.tsx', 'app/facilities/page.tsx'], features: ['supply-requests', 'facility-tickets', 'auto-escalation', 'photo-required-tickets'], permissions: ['all retail roles submit', 'DMs approve own team', 'ops+ approve any', 'facility photo required', '48h auto-escalation'] },
  { file: 'wireless_retail/merch-orders.md', sources: ['app/api/merch-orders/route.ts', 'app/merch-orders/page.tsx'], features: ['merch-orders'], permissions: ['employees/DMs create', 'ops+ approve', 'notes and ops manager required'] },
  { file: 'wireless_retail/map-gps.md', sources: ['app/api/map/route.ts', 'app/api/map/live/route.ts', 'app/api/gps/breadcrumb/route.ts', 'app/map/page.tsx'], features: ['live-map', 'gps-breadcrumbs', 'store-visit-detection'], permissions: ['SD/owner/developer only'] },
  { file: 'wireless_retail/calendar-resources.md', sources: ['app/api/calendar/route.ts', 'app/api/resources/route.ts', 'app/calendar/page.tsx', 'app/resources/page.tsx'], features: ['calendar', 'recurring-events', 'rsvp', 'resources', 'document-upload'], permissions: ['calendar: manager+ access', 'resources: all read, ops+ manage'] },
  { file: 'wireless_retail/calendar-access.md', sources: ['app/api/calendar/route.ts'], features: ['personal-calendar-access'], permissions: ['DMs and SDs have own calendar', 'ops/owner/dev must specify ownerId'] },
  { file: 'wireless_retail/flags.md', sources: ['app/api/flags/route.ts', 'app/flags/page.tsx', 'app/api/clock/in/route.ts', 'app/api/clock/out/route.ts'], features: ['flags', 'late-clock-in-flag', 'overtime-flag'], permissions: ['manager+ view', 'employees cannot see', 'auto-created on late/OT'] },
  { file: 'wireless_retail/commissions.md', sources: ['app/commissions/page.tsx', 'app/api/commissions/route.ts'], features: ['commissions-estimator'], permissions: ['all retail roles', 'hardcoded July 2026 comp plan'] },
  { file: 'wireless_retail/overtime-alerts.md', sources: ['app/api/clock/out/route.ts', 'app/api/ot-watch/route.ts', 'app/api/cron/ot-tracker/route.ts'], features: ['overtime-alerts', 'ot-thresholds', 'salary-exemption', 'floater-ot'], permissions: ['40h flag to DM', '45h projected to SD', '50h projected to owner', 'salary employees exempt'] },
  { file: 'wireless_retail/eod-recaps.md', sources: ['lib/dm-eod-recap.ts', 'app/api/clock/out/route.ts'], features: ['eod-recaps', 'gps-store-visit-times'], permissions: ['generated on DM clock-out', 'ops+ can toggle notification preference'] },
  { file: 'wireless_retail/auto-clockout.md', sources: ['app/api/cron/auto-clockout/route.ts'], features: ['auto-clockout'], permissions: ['runs 9 PM CST daily', 'all active shifts auto-ended'] },
  { file: 'wireless_retail/schedule-publishing.md', sources: ['app/api/staff-schedule/publish/route.ts', 'app/api/staff-schedule/copy/route.ts', 'app/api/staff-schedule/route.ts'], features: ['schedule-publish-blocks', 'schedule-copy-blocks', 'time-off-schedule-conflict'], permissions: ['unassigned shifts block publish', 'existing shifts block copy', 'approved time-off blocks scheduling'] },
  { file: 'wireless_retail/new-employee-approval.md', sources: ['app/api/team/users/route.ts', 'app/api/team/users/approve/route.ts', 'app/api/auth/login/route.ts'], features: ['employee-approval-workflow', 'pending-approval-login-block'], permissions: ['DMs create pending users', 'SD/owner approve', 'pending users cannot log in'] },
  { file: 'wireless_retail/ops-collab.md', sources: ['app/api/supply-requests/route.ts', 'app/api/facility-tickets/route.ts', 'app/api/merch-orders/route.ts', 'app/api/team/users/route.ts'], features: ['ops-collab-flag'], permissions: ['gives DMs org-wide visibility for supplies/facilities/merch', 'removes submit ability'] },
  { file: 'wireless_retail/service-analysis.md', sources: ['app/service-analysis/page.tsx'], features: ['service-analysis-pdf'], permissions: ['all retail roles'] },
  { file: 'wireless_retail/troubleshooting.md', sources: ['app/api/clock/in/route.ts', 'app/api/clock/out/route.ts', 'app/api/clock/break/route.ts', 'app/api/shifts/route.ts', 'app/api/time-off/route.ts', 'app/api/shift-swaps/route.ts', 'app/api/staff-schedule/publish/route.ts', 'app/api/accountability/route.ts', 'app/api/auth/login/route.ts', 'components/BottomNav.tsx'], features: ['all-error-messages'], permissions: [] },
  // ── barbershop ──
  { file: 'barbershop/appointments.md', sources: ['app/api/barbershop/appointments/route.ts', 'app/api/barbershop/appointments/[id]/route.ts', 'app/api/cron/appointment-expiry/route.ts', 'app/api/cron/appointment-reminder/route.ts', 'app/book/page.tsx', 'app/barber-dashboard/page.tsx'], features: ['appointment-booking', 'confirm-decline', 'auto-expiry', 'reminders', 'customer-cancellation'], permissions: ['only customers can book', '24h auto-expiry', 'barbers confirm/decline'] },
  { file: 'barbershop/appointment-errors.md', sources: ['app/api/barbershop/appointments/[id]/route.ts', 'app/api/barbershop/respond/route.ts'], features: ['appointment-race-conditions', 'proposal-response'], permissions: ['already-updated guard', 'no-proposal guard'] },
  { file: 'barbershop/shop-setup.md', sources: ['app/api/barbershop/shop/route.ts', 'app/shop-setup/page.tsx'], features: ['shop-setup', 'shop-info', 'shop-hours', 'payment-settings', 'qr-code'], permissions: ['shop_owner only'] },
  { file: 'barbershop/shop-codes.md', sources: ['app/api/barbershop/shop/route.ts', 'app/api/barbershop/lookup/route.ts'], features: ['shop-code-validation', 'shop-code-uniqueness'], permissions: ['codes must be 4 chars and unique', 'only shop owners add barbers'] },
  { file: 'barbershop/customers.md', sources: ['app/api/barbershop/customers/route.ts', 'app/api/barbershop/customers/[id]/notes/route.ts', 'app/my-customers/page.tsx', 'app/customer-signup/page.tsx'], features: ['customer-management', 'customer-notes', 'customer-signup-flow'], permissions: ['barber/shop_owner view', 'customers self-signup only', 'no manual customer creation'] },
  { file: 'barbershop/barber-profile.md', sources: ['app/api/barbershop/barbers/route.ts', 'app/api/barbershop/shop/route.ts'], features: ['barber-profile', 'display-name', 'bio', 'walk-ins', 'cleanup-minutes', 'listed-toggle'], permissions: ['barbers edit own', 'shop owners edit any in shop'] },
  { file: 'barbershop/services.md', sources: ['app/api/barbershop/services/route.ts'], features: ['barber-services', 'service-pricing', 'active-inactive-toggle'], permissions: ['barbers edit own', 'shop owners edit any', 'no reorder UI'] },
  { file: 'barbershop/availability.md', sources: ['app/api/barbershop/availability/route.ts'], features: ['barber-availability', 'shop-hours-override'], permissions: ['barbers set own', 'shop owners set any', 'availability intersects with shop hours'] },
  { file: 'barbershop/troubleshooting.md', sources: ['app/api/barbershop/appointments/route.ts', 'app/api/barbershop/services/route.ts', 'app/api/barbershop/availability/route.ts', 'app/api/barbershop/shop/route.ts', 'app/api/barbershop/lookup/route.ts', 'app/api/barbershop/respond/route.ts'], features: ['all-barbershop-errors'], permissions: [] },
  // ── shared ──
  { file: 'shared/account-settings.md', sources: ['app/api/auth/login/route.ts', 'app/api/auth/change-password/route.ts', 'app/api/auth/forgot-password/route.ts', 'app/api/auth/reset-password/route.ts', 'app/api/team/users/avatar/route.ts', 'app/settings/page.tsx', 'app/login/page.tsx'], features: ['login', 'password-change', 'password-reset', 'avatar-upload', 'first-login-redirect'], permissions: ['all roles', 'must_change_password forces redirect', 'reset link expires 1 hour'] },
  { file: 'shared/login-troubleshooting.md', sources: ['app/api/auth/login/route.ts', 'app/api/auth/reset-password/route.ts', 'app/api/auth/change-password/route.ts'], features: ['login-failures', 'rate-limiting', 'password-requirements'], permissions: ['10 attempts per IP per 15 min', 'change=6 chars, reset=8 chars', 'inactive accounts get same error as wrong password'] },
  { file: 'shared/billing.md', sources: [], features: ['billing', 'cancellation'], permissions: ['contact shaun@gephartenterprises.com'] },
  { file: 'shared/getting-started.md', sources: ['app/login/page.tsx', 'app/dashboard/page.tsx', 'components/BottomNav.tsx'], features: ['first-login', 'app-download', 'dashboard-overview'], permissions: ['all roles'] },
  { file: 'shared/roles-permissions.md', sources: ['lib/auth.ts', 'components/BottomNav.tsx', 'proxy.ts'], features: ['role-hierarchy', 'feature-access-by-role'], permissions: ['employee→manager→ops_manager→sales_director→owner→developer'] },
  { file: 'shared/notifications.md', sources: ['app/settings/page.tsx', 'app/api/push/preferences/route.ts', 'lib/apns.ts'], features: ['notification-toggles', 'push-setup'], permissions: ['25 toggle types', 'role-filtered preferences'] },
  { file: 'shared/nav-pinning.md', sources: ['components/BottomNav.tsx'], features: ['tab-pinning', 'more-menu'], permissions: ['max 4 pins', 'saved per device'] },
]

for (const mapping of MAPPINGS) {
  const filePath = path.join(KNOWLEDGE_DIR, mapping.file)
  if (!fs.existsSync(filePath)) {
    console.warn(`SKIP: ${mapping.file} does not exist`)
    continue
  }

  const content = fs.readFileSync(filePath, 'utf-8')

  // Skip if already has frontmatter
  if (content.startsWith('---\n')) {
    console.log(`SKIP: ${mapping.file} already has frontmatter`)
    continue
  }

  const frontmatter = [
    '---',
    `sources:`,
    ...mapping.sources.map(s => `  - ${s}`),
    `features:`,
    ...mapping.features.map(f => `  - ${f}`),
    `permissions:`,
    ...mapping.permissions.map(p => `  - "${p}"`),
    `verified: ${TODAY}`,
    '---',
    '',
  ].join('\n')

  fs.writeFileSync(filePath, frontmatter + content)
  console.log(`OK: ${mapping.file}`)
}

console.log('\nDone.')
