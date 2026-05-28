'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isCapacitor, resumeNativeTrackingIfClocked } from '@/lib/gps-native'

interface Notification {
  id: string
  title: string
  body: string
  type: string | null
  read: boolean
  created_at: string
}

interface NavBarProps {
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
  fullName: string
}

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

const NOTIFICATION_PATHS: Record<string, string> = {
  chat_message: '/chat',
  task_assigned: '/tasks',
  task_completed: '/tasks',
  checklist_submitted: '/checklist',
  flag_created: '/flags',
  expense_submitted: '/expenses',
  schedule_published: '/my-schedule',
  time_off_request: '/time-off',
  facility_request: '/facilities',
  facility_update: '/facilities',
  accountability: '/accountability',
  shift_swap: '/shift-swaps',
  supply_request: '/supply-requests',
  merch_order: '/merch-orders',
  payroll: '/payroll',
  clock_out: '/timecards',
  handoff_note: '/timecards',
}

interface Org { id: string; name: string }

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':        'Dashboard',
  '/clock':            'Clock In/Out',
  '/chat':             'Messages',
  '/my-schedule':      'My Schedule',
  '/staff-schedule':   'Store Scheduling',
  '/tasks':            'Tasks',
  '/checklist':        'Checklist',
  '/map':              'Live Map',
  '/team':             'Team',
  '/payroll':          'Payroll',
  '/flags':            'Flags',
  '/timecards':        'Timecards',
  '/time-history':     'Time History',
  '/time-off':         'Time Off',
  '/shift-swaps':      'Shift Swaps',
  '/expenses':         'Expenses',
  '/facilities':       'Facilities',
  '/supply-requests':  'Supply Requests',
  '/merch-orders':     'Merch Orders',
  '/accountability':   'Accountability',
  '/dm-visit':         'DM Store Visit',
  '/dm-engagement':    'DM Engagement',
  '/calendar':         'Calendar',
  '/service-analysis': 'Service Analysis',
  '/settings':         'Settings',
  '/config':           'Config',
  '/schedule':         'Schedule',
}

export default function NavBar({ role, fullName }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [activeOrg, setActiveOrg] = useState<string>('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [chatUnread, setChatUnread] = useState(0)

  // Silently refresh session every 10 minutes to prevent mobile logout
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/auth/refresh', { method: 'POST' }).catch(() => {})
    }, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const navActiveShiftRef = useRef<{ id: string } | null>(null)
  const navEsRef = useRef<EventSource | null>(null)

  useEffect(() => {
    function applyNavData(d: { notifications: unknown[]; unread: number; chatUnread: number; activeShift: { id: string } | null }) {
      setNotifications(d.notifications as Notification[] ?? [])
      setUnread(d.unread ?? 0)
      setChatUnread(d.chatUnread ?? 0)
      if (d.activeShift !== undefined) {
        navActiveShiftRef.current = d.activeShift
      }
    }

    function connect() {
      if (navEsRef.current) navEsRef.current.close()
      const es = new EventSource('/api/nav/stream')
      es.onmessage = (event) => {
        try {
          const d = JSON.parse(event.data)
          applyNavData(d)
        } catch {}
      }
      es.onerror = () => {
        // EventSource handles reconnection automatically
      }
      navEsRef.current = es
    }

    connect()

    return () => {
      if (navEsRef.current) { navEsRef.current.close(); navEsRef.current = null }
    }
  }, [])

  function openNotifs() {
    setNotifOpen(true)
    setProfileOpen(false)
    fetch('/api/nav/status', { method: 'PATCH' }).catch(() => {})
    setUnread(0)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  function fmtNotifTime(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  useEffect(() => {
    if (role !== 'developer') return
    fetch('/api/dev/org')
      .then(r => r.json())
      .then(d => {
        setOrgs(d.orgs ?? [])
        setActiveOrg(d.orgId ?? '')
      })
  }, [role])

  // Persistent GPS tracking across all pages while clocked in
  const watchIdRef = useRef<number | null>(null)
  const lastSentRef = useRef<number>(0)
  const MIN_INTERVAL_MS = 2 * 60 * 1000

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
      () => {},
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    )
  }, [MIN_INTERVAL_MS])

  useEffect(() => {
    if (role === 'developer' || role === 'owner' || role === 'sales_director') return
    if (isCapacitor()) {
      resumeNativeTrackingIfClocked()
      return
    }
    // Use activeShift from the combined nav/status fetch (already in navActiveShiftRef)
    // instead of a separate /api/clock/status call
    const checkAndTrack = () => {
      if (navActiveShiftRef.current) startTracking()
      else stopTracking()
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
    window.location.href = '/login'
  }

  const pageTitle = PAGE_TITLES[pathname] ?? 'Field Manager Pro'
  const initials = fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <>
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800 px-4 h-14 flex items-center justify-between">
        {/* Left — home button */}
        <a
          href="/dashboard"
          className="w-[76px] flex items-center gap-1.5 text-gray-500 hover:text-white transition-colors"
          aria-label="Home"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span className="text-xs font-medium truncate">Home</span>
        </a>

        {/* Center — current page name */}
        <span className="font-bold text-white text-sm absolute left-1/2 -translate-x-1/2 truncate max-w-[55%] text-center">
          {pageTitle}
        </span>

        {/* Right — chat + bell + avatar */}
        <div className="flex items-center gap-1.5">
          {CHAT_ROLES.includes(role) && (
            <a
              href="/chat"
              className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-800 transition-colors flex-shrink-0"
              aria-label="Messages"
            >
              <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {chatUnread > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none">
                  {chatUnread > 9 ? '9+' : chatUnread}
                </span>
              )}
            </a>
          )}
          <button
            onClick={openNotifs}
            className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-800 transition-colors flex-shrink-0"
            aria-label="Notifications"
          >
            <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          <button
            onClick={() => setProfileOpen(true)}
            className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center flex-shrink-0 hover:bg-violet-600 transition-colors"
            aria-label="Profile"
          >
            <span className="text-white text-xs font-bold">{initials}</span>
          </button>
        </div>
      </header>

      {/* Notification panel */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setNotifOpen(false)}
        >
          <div
            className="bg-gray-900 rounded-t-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <p className="text-white font-bold text-base">Notifications</p>
              <button onClick={() => setNotifOpen(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-800/60">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <svg className="w-10 h-10 text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <p className="text-gray-500 text-sm">No notifications yet</p>
                </div>
              ) : (
                notifications.map(n => {
                  const path = n.type ? NOTIFICATION_PATHS[n.type] : null
                  return (
                    <button
                      key={n.id}
                      className={`w-full text-left px-5 py-4 transition-colors ${n.read ? '' : 'bg-violet-950/20'} ${path ? 'hover:bg-gray-800/60 active:bg-gray-800' : ''}`}
                      onClick={() => {
                        setNotifOpen(false)
                        if (path) router.push(path)
                      }}
                    >
                      <div className="flex items-start gap-3">
                        {!n.read && <div className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0 mt-1.5" />}
                        {n.read && <div className="w-2 h-2 flex-shrink-0 mt-1.5" />}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold leading-tight ${n.read ? 'text-gray-300' : 'text-white'}`}>{n.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{n.body}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-[10px] text-gray-600">{fmtNotifTime(n.created_at)}</p>
                            {path && <p className="text-[10px] text-violet-500">Tap to view →</p>}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile sheet */}
      {profileOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setProfileOpen(false)}
        >
          <div
            className="bg-gray-900 rounded-t-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>

            {/* User info */}
            <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-violet-700 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-base font-bold">{initials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold truncate">{fullName}</p>
                <p className="text-xs text-gray-500 capitalize mt-0.5">{role.replace(/_/g, ' ')}</p>
              </div>
              <button onClick={() => setProfileOpen(false)} className="ml-auto text-gray-500 hover:text-gray-300 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Org switcher (developer only) */}
            {role === 'developer' && orgs.length > 0 && (
              <div className="px-5 py-4 border-b border-gray-800">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 mb-2">Viewing Org</p>
                <select
                  value={activeOrg}
                  onChange={e => { switchOrg(e.target.value); setProfileOpen(false) }}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500"
                >
                  <option value="">All Orgs</option>
                  {orgs.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Sign out */}
            <div className="px-5 py-4">
              <button
                onClick={logout}
                className="w-full flex items-center gap-3 bg-gray-800 hover:bg-gray-750 rounded-2xl px-4 py-3.5 text-red-400 hover:text-red-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-sm font-semibold">Sign Out</span>
              </button>
            </div>

            <div className="h-4" />
          </div>
        </div>
      )}
    </>
  )
}
