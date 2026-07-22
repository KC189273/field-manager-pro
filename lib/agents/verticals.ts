// Vertical playbooks — consumed by Onboarding, Support, and Growth agents.
// Each vertical defines its activation milestones, churn signals, and voice.

export interface MilestoneDef {
  key: string
  label: string
  description: string        // what the user should do, in plain language
  checkSql: string           // SQL returning boolean `done` for a given $1 = org_id
}

export interface VerticalPlaybook {
  vertical: string
  label: string
  activationMilestones: MilestoneDef[]
  churnSignals: string[]
  voiceNotes: string
}

// ── Wireless Retail ──────────────────────────────────────────────────────────
const wirelessRetailPlaybook: VerticalPlaybook = {
  vertical: 'wireless_retail',
  label: 'Wireless Retail',
  activationMilestones: [
    {
      key: 'users_invited',
      label: 'Invite your first team member',
      description: 'Add at least one employee or manager to your organization so they can start clocking in and using the app.',
      checkSql: `SELECT (COUNT(*) > 1) AS done FROM users WHERE org_id = $1 AND is_active = TRUE`,
    },
    {
      key: 'first_gps_clockin',
      label: 'First GPS clock-in',
      description: 'Have a team member clock in at a store location with GPS tracking enabled.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM gps_breadcrumbs g JOIN shifts s ON s.id = g.shift_id JOIN users u ON u.id = s.user_id WHERE u.org_id = $1) AS done`,
    },
    {
      key: 'first_schedule',
      label: 'Build your first schedule',
      description: 'Create a weekly staff schedule so your team knows when and where to work.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM scheduled_shifts WHERE org_id = $1) AS done`,
    },
    {
      key: 'first_checklist',
      label: 'Complete your first checklist',
      description: 'Submit an opening or closing checklist at one of your stores.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM checklist_submissions WHERE org_id = $1) AS done`,
    },
    {
      key: 'first_store_visit',
      label: 'Log your first store visit',
      description: 'As a DM, log a store visit to start tracking your field activity.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM dm_store_visits WHERE org_id = $1) AS done`,
    },
  ],
  churnSignals: [
    'Team stopped clocking in',
    'No new schedules published in over a week',
    'Checklist submissions dropped to zero',
    'GPS tracking went silent',
  ],
  voiceNotes: 'Speak to retail store managers and district managers. They manage wireless retail stores (T-Mobile, etc). Use terms like "stores", "reps", "clock-in", "checklists", "store visits".',
}

// ── Barbershop ───────────────────────────────────────────────────────────────
const barbershopPlaybook: VerticalPlaybook = {
  vertical: 'barbershop',
  label: 'Barbershop',
  activationMilestones: [
    {
      key: 'barber_profile',
      label: 'Create a barber profile',
      description: 'Set up your barber profile with your name, bio, and availability so clients can find and book you.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM barber_profiles WHERE org_id = $1) AS done`,
    },
    {
      key: 'services_added',
      label: 'Add your services',
      description: 'List the services you offer (haircuts, fades, beard trims, etc.) with pricing and duration.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM barber_services bs JOIN users u ON u.id = bs.barber_id WHERE u.org_id = $1 AND bs.is_active = TRUE) AS done`,
    },
    {
      key: 'first_appointment',
      label: 'Book your first appointment',
      description: 'Get your first client booking through the app. Share your booking link or QR code to get started.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM appointments WHERE org_id = $1) AS done`,
    },
    {
      key: 'first_customer',
      label: 'Add your first customer',
      description: 'When a customer signs up through your booking link, they appear in your customer list.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM customer_profiles WHERE org_id = $1) AS done`,
    },
    {
      key: 'shop_settings',
      label: 'Complete shop setup',
      description: 'Fill in your shop info, hours, and payment preferences in Shop Setup.',
      checkSql: `SELECT EXISTS(SELECT 1 FROM shop_settings WHERE org_id = $1) AS done`,
    },
  ],
  churnSignals: [
    'No new appointments booked in over a week',
    'No customer activity',
    'Barber stopped updating availability',
  ],
  voiceNotes: 'Speak to barbers and shop owners. Use terms like "clients", "bookings", "appointments", "services", "your chair", "your shop".',
}

// ── Registry ─────────────────────────────────────────────────────────────────
const playbooks: Record<string, VerticalPlaybook> = {
  wireless_retail: wirelessRetailPlaybook,
  barbershop: barbershopPlaybook,
}

export function getPlaybook(industry: string): VerticalPlaybook | null {
  return playbooks[industry] ?? null
}

export function getAllPlaybooks(): VerticalPlaybook[] {
  return Object.values(playbooks)
}
