'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer' | 'customer' | 'barber' | 'shop_owner'

const STORAGE_KEY = 'fmp_pinned_tabs_v2'
const ROLE_CACHE_KEY = 'fmp_role_cache'
const MAX_PINS = 4

const NO_NAV_PREFIXES = [
  '/login', '/forgot-password', '/reset-password', '/change-password',
  '/privacy', '/terms', '/delete-account', '/get-started', '/ack',
  '/customer-signup', '/download',
]

const BARBERSHOP_ROLES: Role[] = ['customer', 'barber', 'shop_owner']
function isBarbershop(role: Role) { return BARBERSHOP_ROLES.includes(role) }
function isRetail(role: Role) { return !isBarbershop(role) }
function canViewTeam(role: Role) {
  return ['manager', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(role)
}
function isOpsPlus(role: Role) {
  return ['ops_manager', 'owner', 'sales_director', 'developer'].includes(role)
}

type IconFC = React.FC<{ className?: string }>

interface Feature {
  href: string
  label: string  // full label for More sheet
  short: string  // short label for tab bar
  Icon: IconFC
  show: (role: Role) => boolean
}

const ALL_FEATURES: Feature[] = [
  // ── Retail / workforce features ──
  { href: '/dashboard',       label: 'Dashboard',        short: 'Home',      Icon: HomeIcon,           show: isRetail },
  { href: '/clock',           label: 'Clock In/Out',     short: 'Clock',     Icon: ClockIcon,          show: isRetail },
  { href: '/chat',            label: 'Messages',         short: 'Chat',      Icon: ChatIcon,           show: r => isRetail(r) && r !== 'employee' },
  { href: '/my-schedule',     label: 'My Schedule',      short: 'Schedule',  Icon: ScheduleIcon,       show: isRetail },
  { href: '/staff-schedule',  label: 'Store Schedule',   short: 'Shifts',    Icon: StaffSchedIcon,     show: r => isRetail(r) && r !== 'employee' },
  { href: '/tasks',           label: 'Tasks',            short: 'Tasks',     Icon: TasksIcon,          show: isRetail },
  { href: '/checklist',       label: 'Checklist',        short: 'Checklist', Icon: ChecklistIcon,      show: isRetail },
  { href: '/map',             label: 'Live Map',         short: 'Map',       Icon: MapIcon,            show: r => r === 'sales_director' || r === 'owner' || r === 'developer' },
  { href: '/team',            label: 'Team',             short: 'Team',      Icon: TeamIcon,           show: canViewTeam },
  { href: '/payroll',         label: 'Payroll',          short: 'Payroll',   Icon: PayrollIcon,        show: canViewTeam },
  { href: '/flags',           label: 'Flags',            short: 'Flags',     Icon: FlagIcon,           show: canViewTeam },
  { href: '/timecards',       label: 'Timecards',        short: 'Timecards', Icon: TimecardIcon,       show: isRetail },
  { href: '/time-history',    label: 'Time History',     short: 'History',   Icon: HistoryIcon,        show: isRetail },
  { href: '/time-off',        label: 'Time Off',         short: 'Time Off',  Icon: TimeOffIcon,        show: isRetail },
  { href: '/shift-swaps',     label: 'Shift Swaps',      short: 'Swaps',     Icon: SwapIcon,           show: isRetail },
  { href: '/expenses',        label: 'Expenses',         short: 'Expenses',  Icon: ExpenseIcon,        show: r => isRetail(r) && r !== 'employee' },
  { href: '/facilities',      label: 'Facilities',       short: 'Facilities',Icon: FacilitiesIcon,     show: isRetail },
  { href: '/supply-requests', label: 'Supplies',         short: 'Supplies',  Icon: SupplyIcon,         show: isRetail },
  { href: '/merch-orders',    label: 'Merch Orders',     short: 'Merch',     Icon: MerchIcon,          show: isRetail },
  { href: '/accountability',  label: 'Accountability',   short: 'Acct.',     Icon: AccountabilityIcon, show: isRetail },
  { href: '/dm-visit',        label: 'DM Store Visit',   short: 'DM Visit',  Icon: StoreIcon,          show: canViewTeam },
  { href: '/dm-schedule',     label: 'DM Schedule',      short: 'DM Sched',  Icon: ScheduleIcon,       show: r => r === 'manager' || r === 'sales_director' || r === 'owner' || r === 'developer' },
  { href: '/dm-engagement',   label: 'DM Engagement',    short: 'Engagement',Icon: EngagementIcon,     show: isOpsPlus },
  { href: '/calendar',        label: 'Calendar',         short: 'Calendar',  Icon: CalendarIcon,       show: r => isRetail(r) && r !== 'employee' },
  { href: '/resources',       label: 'Resources',        short: 'Resources', Icon: ResourcesIcon,      show: isRetail },
  { href: '/commissions',     label: 'Commissions Estimator', short: 'Comm.',  Icon: ServiceIcon,        show: isRetail },
  { href: '/service-analysis',label: 'Service Analysis', short: 'Service',   Icon: ServiceIcon,        show: isRetail },
  { href: '/settings',        label: 'Settings',         short: 'Settings',  Icon: SettingsIcon,       show: isRetail },
  { href: '/db-health',       label: 'App Health',        short: 'Health',    Icon: GearIcon,           show: r => r === 'developer' || r === 'ops_manager' || r === 'sales_director' || r === 'owner' },

  // ── Barbershop features ──
  { href: '/book',             label: 'Book',             short: 'Book',      Icon: CalendarIcon,       show: r => r === 'customer' },
  { href: '/my-appointments', label: 'My Appointments',  short: 'Appts',     Icon: CalendarIcon,       show: r => r === 'customer' },
  { href: '/barber-dashboard', label: 'Appointments',     short: 'Appts',     Icon: CalendarIcon,       show: r => r === 'barber' || r === 'shop_owner' },
  { href: '/my-customers',    label: 'My Customers',     short: 'Clients',   Icon: TeamIcon,           show: r => r === 'barber' || r === 'shop_owner' },
  { href: '/shop-setup',      label: 'Shop Setup',       short: 'Setup',     Icon: GearIcon,           show: r => r === 'shop_owner' },

  // ── Admin ──
  { href: '/super-admin',     label: 'Super Admin',      short: 'Admin',     Icon: GearIcon,           show: r => r === 'developer' },
  { href: '/config',          label: 'Config',           short: 'Config',    Icon: GearIcon,           show: r => r === 'developer' },
]

// Default pinned tabs per role (all 4 slots customizable)
const DEFAULT_PINNED_TABS: Record<Role, string[]> = {
  employee:       ['/dashboard', '/clock', '/my-schedule', '/checklist'],
  manager:        ['/dashboard', '/clock', '/tasks', '/staff-schedule'],
  ops_manager:    ['/dashboard', '/clock', '/map', '/team'],
  owner:          ['/dashboard', '/clock', '/payroll', '/team'],
  sales_director: ['/dashboard', '/clock', '/map', '/team'],
  developer:      ['/dashboard', '/clock', '/tasks', '/config'],
  customer:       ['/book', '/my-appointments'],
  barber:         ['/barber-dashboard', '/my-customers'],
  shop_owner:     ['/barber-dashboard', '/my-customers', '/shop-setup'],
}

export default function BottomNav() {
  const pathname = usePathname()
  const [role, setRole] = useState<Role | null>(null)
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([])
  const [moreOpen, setMoreOpen] = useState(false)

  // Close the More sheet whenever the route changes
  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  // Load role — use localStorage cache for instant render, then confirm with API
  useEffect(() => {
    try {
      const cached = localStorage.getItem(ROLE_CACHE_KEY) as Role | null
      if (cached) setRole(cached)
    } catch {}

    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.role) {
          setRole(d.role as Role)
          try { localStorage.setItem(ROLE_CACHE_KEY, d.role) } catch {}
        }
      })
      .catch(() => {})
  }, [])

  // Load pinned tabs from localStorage once role is known
  useEffect(() => {
    if (!role) return
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed: string[] = JSON.parse(stored)
        const valid = parsed.filter(href => ALL_FEATURES.find(f => f.href === href && f.show(role)))
        if (valid.length > 0) {
          setPinnedHrefs(valid.slice(0, MAX_PINS))
          return
        }
      }
    } catch {}
    setPinnedHrefs(DEFAULT_PINNED_TABS[role])
  }, [role])

  // Don't show on public/special pages
  const isHidden = NO_NAV_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (isHidden || !role) return null

  const tabFeatures = pinnedHrefs
    .map(href => ALL_FEATURES.find(f => f.href === href))
    .filter(Boolean) as Feature[]

  function handlePin(href: string) {
    setPinnedHrefs(prev => {
      let next: string[]
      if (prev.includes(href)) {
        next = prev.filter(h => h !== href)
      } else if (prev.length < MAX_PINS) {
        next = [...prev, href]
      } else {
        return prev // at max, do nothing
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // All features visible to this role shown in the More sheet
  const moreFeatures = ALL_FEATURES.filter(f => f.show(role))

  return (
    <>
      {/* ── Bottom tab bar ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-gray-950 border-t border-gray-800"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex h-16">
          {tabFeatures.map(tab => {
            const active = pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-violet-400' : 'text-gray-500'
                }`}
              >
                <tab.Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-none">{tab.short}</span>
              </Link>
            )
          })}

          {/* More */}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              moreOpen ? 'text-violet-400' : 'text-gray-500'
            }`}
          >
            <GridIcon className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>

      {/* ── More sheet ── */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="bg-gray-900 rounded-t-2xl flex flex-col"
            style={{ maxHeight: '72vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>

            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <p className="text-white font-bold text-sm">All Features</p>
              <div className="flex items-center gap-1.5">
                <PinIcon className="w-3.5 h-3.5 text-violet-400" />
                <p className="text-[11px] text-gray-400">
                  <span className="text-violet-400 font-semibold">{pinnedHrefs.length}</span>
                  <span className="text-gray-500">/{MAX_PINS} pinned</span>
                </p>
              </div>
            </div>

            {/* Feature grid */}
            <div className="overflow-y-auto p-4 pb-6">
              <p className="text-[11px] text-gray-600 mb-3">Tap the pin icon to add or remove from your nav bar</p>
              <div className="grid grid-cols-4 gap-3">
                {moreFeatures.map(f => {
                  const isPinned = pinnedHrefs.includes(f.href)
                  const isActive = pathname === f.href
                  const atMax = pinnedHrefs.length >= MAX_PINS && !isPinned
                  return (
                    <div key={f.href} className="relative">
                      <Link
                        href={f.href}
                        onClick={() => setMoreOpen(false)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-colors ${
                          isPinned ? 'bg-violet-900/30 ring-1 ring-violet-500/40' : isActive ? 'bg-violet-900/40' : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        <f.Icon className={`w-6 h-6 ${isPinned || isActive ? 'text-violet-400' : 'text-gray-300'}`} />
                        <span className="text-[10px] text-gray-400 text-center leading-tight">{f.label}</span>
                      </Link>

                      {/* Pin button */}
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={e => { e.stopPropagation(); handlePin(f.href) }}
                        className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center border-2 border-gray-900 transition-colors ${
                          isPinned
                            ? 'bg-violet-600 hover:bg-violet-500'
                            : atMax
                              ? 'bg-gray-800 opacity-40'
                              : 'bg-gray-700 hover:bg-gray-600'
                        }`}
                        aria-label={isPinned ? 'Remove from nav bar' : atMax ? 'Remove a pinned item first' : 'Pin to nav bar'}
                      >
                        <PinIcon className="w-2.5 h-2.5 text-white" />
                      </button>
                    </div>
                  )
                })}
              </div>
              {pinnedHrefs.length >= MAX_PINS && (
                <p className="text-[11px] text-amber-500/80 text-center mt-3">Nav bar is full — unpin an item to add another</p>
              )}
            </div>

            <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }} />
          </div>
        </div>
      )}
    </>
  )
}

// ─── Icon components ────────────────────────────────────────────────────────

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  )
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}

function ScheduleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M8 18h.01M12 18h.01" />
    </svg>
  )
}

function StaffSchedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18M8 14h4m-4 4h2" />
    </svg>
  )
}

function TasksIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}

function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  )
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  )
}

function TeamIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function PayrollIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V5a1 1 0 011-1h16l-3 5 3 5H4" />
    </svg>
  )
}

function TimecardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
    </svg>
  )
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function TimeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function SwapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  )
}

function ExpenseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
  )
}

function FacilitiesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  )
}

function SupplyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V11" />
    </svg>
  )
}

function MerchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
    </svg>
  )
}

function AccountabilityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function StoreIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EngagementIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )
}

function ResourcesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
    </svg>
  )
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

function ServiceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  )
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  )
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
    </svg>
  )
}
