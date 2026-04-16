'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isCapacitor, resumeNativeTrackingIfClocked } from '@/lib/gps-native'

interface NavBarProps {
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
  fullName: string
}

const isManager = (role: string) => role === 'manager' || role === 'ops_manager'
const canSubmit = (role: string) => role !== 'employee'
const canViewTeam = (role: string) => isManager(role) || role === 'owner' || role === 'sales_director' || role === 'developer'

interface Org { id: string; name: string }

interface NavLink {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  section?: string
}

export default function NavBar({ role, fullName }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [activeOrg, setActiveOrg] = useState<string>('')
  const [menuOpen, setMenuOpen] = useState(false)

  // Silently refresh session every 10 minutes to prevent mobile logout
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/auth/refresh', { method: 'POST' }).catch(() => {})
    }, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (role !== 'developer') return
    fetch('/api/dev/org')
      .then(r => r.json())
      .then(d => {
        setOrgs(d.orgs ?? [])
        setActiveOrg(d.orgId ?? '')
      })
  }, [role])

  // Persistent GPS tracking — runs across all pages while clocked in
  const watchIdRef = useRef<number | null>(null)
  const lastSentRef = useRef<number>(0)
  const MIN_INTERVAL_MS = 2 * 60 * 1000 // send at most every 2 minutes

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
  }, [])

  const startTracking = useCallback(() => {
    if (!navigator.geolocation || watchIdRef.current !== null) return
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const now = Date.now()
        if (now - lastSentRef.current < MIN_INTERVAL_MS) return
        lastSentRef.current = now
        fetch('/api/gps/breadcrumb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        }).catch(() => {})
      },
      () => {}, // permission denied — silent, handled on Clock page
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    )
  }, [MIN_INTERVAL_MS])

  useEffect(() => {
    if (role === 'developer' || role === 'owner' || role === 'sales_director') return

    // In the native Capacitor app, use the native background GPS plugin.
    // In the browser, use watchPosition (stops when backgrounded — browser limitation).
    if (isCapacitor()) {
      resumeNativeTrackingIfClocked()
      return
    }

    const checkAndTrack = () => {
      fetch('/api/clock/status')
        .then(r => r.json())
        .then(data => {
          if (data?.activeShift) startTracking()
          else stopTracking()
        })
        .catch(() => {})
    }

    checkAndTrack()
    const interval = setInterval(checkAndTrack, 5 * 60 * 1000)

    return () => {
      clearInterval(interval)
      stopTracking()
    }
  }, [role, startTracking, stopTracking])

  async function switchOrg(orgId: string) {
    setActiveOrg(orgId)
    await fetch('/api/dev/org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: orgId || null }),
    })
    router.refresh()
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const links: NavLink[] = [
    { href: '/dashboard', label: 'Home', icon: HomeIcon, section: 'General' },
    { href: '/clock', label: 'Clock In / Out', icon: ClockIcon, section: 'General' },
    { href: '/schedule', label: 'Schedule', icon: CalendarIcon, section: 'General' },
    ...(role !== 'employee' ? [{ href: '/staff-schedule', label: 'Store Scheduling', icon: StaffScheduleIcon, section: 'General' } as NavLink] : []),
    { href: '/time-history', label: 'Time History', icon: HistoryIcon, section: 'General' },
    { href: '/timecards', label: 'Timecards', icon: TimecardIcon, section: 'General' },
    { href: '/checklist', label: 'Opening / Closing Checklist', icon: ChecklistIcon, section: 'General' },
    ...(canSubmit(role) ? [{ href: '/expenses', label: 'Expenses', icon: ExpenseIcon, section: 'Finance' } as NavLink] : []),
    ...(canViewTeam(role)
      ? [
          { href: '/team', label: 'Team', icon: TeamIcon, section: 'Management' } as NavLink,
          { href: '/payroll', label: 'Payroll', icon: PayrollIcon, section: 'Management' } as NavLink,
          { href: '/tasks', label: 'Tasks', icon: TasksIcon, section: 'Management' } as NavLink,
          { href: '/flags', label: 'Flags', icon: FlagIcon, section: 'Management' } as NavLink,
          { href: '/map', label: 'Map', icon: MapIcon, section: 'Management' } as NavLink,
          { href: '/dm-visit', label: 'DM Store Visit', icon: StoreIcon, section: 'Management' } as NavLink,
        ]
      : []),
    ...(role === 'developer' ? [{ href: '/config', label: 'Config', icon: SettingsIcon, section: 'Developer' } as NavLink] : []),
  ]

  const currentLink = links.find(l => l.href === pathname)
  const sections = [...new Set(links.map(l => l.section))]

  return (
    <>
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800 px-4 h-14 flex items-center justify-between">
        {/* Left — logo + FMP */}
        <div className="flex items-center gap-2 flex-1">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <span className="font-semibold text-white text-sm">FMP</span>
        </div>

        {/* Center — current page + dropdown */}
        <button
          onClick={() => setMenuOpen(true)}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          {currentLink && (
            <span className="font-bold text-white text-sm">{currentLink.label}</span>
          )}
          <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className="flex-1 flex items-center justify-end gap-3">
          {role === 'developer' && orgs.length > 0 && (
            <select
              value={activeOrg}
              onChange={e => switchOrg(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-violet-500 max-w-[130px]"
            >
              <option value="">All Orgs</option>
              {orgs.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
          <span className="text-gray-400 text-sm">{fullName}</span>
          <button
            onClick={logout}
            className="text-gray-500 hover:text-red-400 transition-colors text-sm"
          >
            Sign out
          </button>
        </div>
      </header>


      {/* Menu overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="bg-gray-900 rounded-t-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>

            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <div>
                <p className="text-white font-semibold">{fullName}</p>
                <p className="text-xs text-gray-500 capitalize">{role.replace('_', ' ')}</p>
              </div>
              <button onClick={() => setMenuOpen(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Nav items grouped by section */}
            <div className="overflow-y-scroll flex-1 py-2">
              {sections.map(section => (
                <div key={section}>
                  <p className="px-5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-600">{section}</p>
                  {links.filter(l => l.section === section).map(link => {
                    const active = pathname === link.href
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setMenuOpen(false)}
                        className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                          active ? 'bg-violet-600/15 text-violet-400' : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        <link.icon className="w-5 h-5 flex-shrink-0" />
                        <span className="text-sm font-medium">{link.label}</span>
                        {active && (
                          <svg className="w-4 h-4 ml-auto text-violet-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </Link>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Sign out */}
            <div className="border-t border-gray-800 px-5 py-4">
              <button
                onClick={logout}
                className="w-full flex items-center gap-3 text-red-400 hover:text-red-300 transition-colors py-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-sm font-medium">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
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

function TimecardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
    </svg>
  )
}

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

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18" />
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

function ExpenseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
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

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V5a1 1 0 011-1h16l-3 5 3 5H4" />
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

function StaffScheduleIcon({ className }: { className?: string }) {
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

function PayrollIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
