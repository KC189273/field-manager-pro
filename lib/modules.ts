export interface Module {
  slug: string
  label: string
  description: string
  group: string
}

export const MODULE_GROUPS = [
  'Time & Labor',
  'Team Management',
  'Store Operations',
  'Communication',
  'Accountability & HR',
  'Analytics & AI',
  'Barbershop',
] as const

export type ModuleGroup = typeof MODULE_GROUPS[number]

export const MODULES: Module[] = [
  // Time & Labor
  { slug: 'time_clock', label: 'Time Clock', description: 'GPS-verified clock in/out with break tracking', group: 'Time & Labor' },
  { slug: 'payroll', label: 'Payroll', description: 'Bi-weekly payroll processing with DM approvals and Excel export', group: 'Time & Labor' },
  { slug: 'timecard_history', label: 'Timecard History', description: 'Detailed shift records with store locations and corrections', group: 'Time & Labor' },

  // Team Management
  { slug: 'scheduling', label: 'Scheduling', description: 'Manager-published shift schedules with compliance checking', group: 'Team Management' },
  { slug: 'shift_swap', label: 'Shift Swaps', description: 'Peer-to-peer shift trading with manager approval', group: 'Team Management' },
  { slug: 'time_off', label: 'Time Off', description: 'PTO and sick day requests with approval workflow', group: 'Team Management' },
  { slug: 'employee_onboarding', label: 'Employee Onboarding', description: 'New hire creation with approval flow and welcome emails', group: 'Team Management' },
  { slug: 'floater_support', label: 'Floater Support', description: 'Cross-district employee scheduling and task assignment', group: 'Team Management' },

  // Store Operations
  { slug: 'opening_closing_checklists', label: 'Opening/Closing Checklists', description: 'Daily store checklists with photos and end-of-day metrics', group: 'Store Operations' },
  { slug: 'dm_store_visits', label: 'DM Store Visits', description: 'Quick visits and visit guides with photo attachments', group: 'Store Operations' },
  { slug: 'dm_coaching', label: 'DM Coaching', description: 'Structured coaching checklists with observe, role play, and knowledge checks', group: 'Store Operations' },
  { slug: 'task_management', label: 'Task Management', description: 'Task assignment with due dates, photos, and recurring schedules', group: 'Store Operations' },
  { slug: 'facility_tickets', label: 'Facility Tickets', description: 'Maintenance and facility request tracking', group: 'Store Operations' },
  { slug: 'supply_requisitions', label: 'Supply Requisitions', description: 'Supply ordering with urgency levels and escalation', group: 'Store Operations' },

  // Communication
  { slug: 'group_chat', label: 'Group Chat', description: 'Real-time messaging with reactions, GIFs, and pinning', group: 'Communication' },
  { slug: 'push_notifications', label: 'Push Notifications', description: 'iOS and Android push alerts for all app events', group: 'Communication' },
  { slug: 'in_app_notifications', label: 'In-App Notifications', description: 'Notification inbox with history and deep links', group: 'Communication' },

  // Accountability & HR
  { slug: 'accountability_docs', label: 'Accountability Documents', description: 'Verbal, written, and final notices with approval hierarchy', group: 'Accountability & HR' },
  { slug: 'termination_workflow', label: 'Termination Workflow', description: 'Formal termination with Word doc generation and email delivery', group: 'Accountability & HR' },
  { slug: 'employee_profile_export', label: 'Employee Profile Export', description: 'Full accountability history export per employee', group: 'Accountability & HR' },

  // Analytics & AI
  { slug: 'ai_eod_recaps', label: 'AI End-of-Day Recaps', description: 'AI-generated daily recap emails with GPS store visit tracking', group: 'Analytics & AI' },
  { slug: 'analytics_dashboard', label: 'Analytics Dashboard', description: 'App health monitoring with action items and trend charts', group: 'Analytics & AI' },
  { slug: 'engagement_dashboard', label: 'Engagement Dashboard', description: 'DM engagement and activity tracking metrics', group: 'Analytics & AI' },
  { slug: 'commission_calculator', label: 'Commission Calculator', description: 'Daily commission estimator with voice boost and multiplier tiers', group: 'Analytics & AI' },
  { slug: 'expense_management', label: 'Expense Management', description: 'Receipt upload with AI scanning and approval workflow', group: 'Analytics & AI' },
  { slug: 'gps_live_map', label: 'GPS Live Map', description: 'Real-time team location tracking with store visit detection', group: 'Analytics & AI' },
  { slug: 'calendar_events', label: 'Calendar & Events', description: 'Team calendar with recurring events and RSVP', group: 'Analytics & AI' },
  { slug: 'resources', label: 'Resources', description: 'Shared documents, links, announcements, and key contacts', group: 'Analytics & AI' },
  { slug: 'service_analysis', label: 'Service Analysis', description: 'Sales and service performance analysis tools', group: 'Analytics & AI' },

  // Barbershop
  { slug: 'barbershop_booking', label: 'Appointment Booking', description: 'Customer appointment requests with barber confirmation', group: 'Barbershop' },
  { slug: 'barbershop_shop_setup', label: 'Shop Setup', description: 'Shop info, services, hours, payment, and QR code', group: 'Barbershop' },
  { slug: 'barbershop_customer_mgmt', label: 'Customer Management', description: 'Customer list, notes, and visit history', group: 'Barbershop' },
  { slug: 'barbershop_reminders', label: 'Reminders & Expiry', description: 'Auto appointment reminders and 24h expiry', group: 'Barbershop' },
]

export function getModulesByGroup(): Record<ModuleGroup, Module[]> {
  const grouped = {} as Record<ModuleGroup, Module[]>
  for (const group of MODULE_GROUPS) {
    grouped[group] = MODULES.filter(m => m.group === group)
  }
  return grouped
}
