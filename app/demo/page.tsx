'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Session {
  id: string; fullName: string; role: string; org_id?: string | null
}

const TIER1 = [
  { href: '/map', label: 'Live Map', desc: 'Real-time GPS tracking with location history, route replay, and store coverage', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7', color: 'from-emerald-500 to-teal-600' },
  { href: '/clock', label: 'Clock In/Out', desc: 'GPS-verified clock-in with geofencing, uniform photo capture, and auto clock-out', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', color: 'from-blue-500 to-cyan-600' },
  { href: '/timecards', label: 'Timecards', desc: 'Weekly timecards with edit history, OT tracking, and Excel/CSV export', icon: 'M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', color: 'from-violet-500 to-purple-600' },
  { href: '/staff-schedule', label: 'Scheduling', desc: 'Store scheduling with shift swaps, time-off requests, and live coverage', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', color: 'from-amber-500 to-orange-600' },
  { href: '/help', label: 'AI Assistant', desc: 'Built-in AI help desk that answers questions, troubleshoots, and learns from every interaction', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', color: 'from-pink-500 to-rose-600' },
]

const TIER2 = [
  { href: '/tasks', label: 'Tasks', desc: 'Recurring tasks with photo requirements and scheduled dispatch' },
  { href: '/accountability', label: 'Accountability', desc: 'Progressive discipline with approval workflows and Word doc export' },
  { href: '/dm-engagement', label: 'DM Engagement', desc: 'Coaching grades, uniform compliance, and performance tracking' },
  { href: '/expenses', label: 'Expenses', desc: 'AI receipt scanning with approval workflows' },
  { href: '/chat', label: 'Team Chat', desc: 'Group messaging with reactions, GIFs, and @mentions' },
  { href: '/payroll', label: 'Payroll', desc: 'Biweekly payroll with ADP CSV export and state tracking' },
]

const TIER3 = [
  { href: '/commissions', label: 'Commissions' },
  { href: '/checklist', label: 'Checklists' },
  { href: '/supply-requests', label: 'Supply Requests' },
  { href: '/team', label: 'Team Management' },
  { href: '/flags', label: 'Flags & Alerts' },
  { href: '/calendar', label: 'Calendar' },
]

export default function DemoPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => { if (d) setSession(d) })
  }, [router])

  if (!session) return null

  const firstName = session.fullName.split(' ')[0]

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <p className="text-violet-200 text-xs font-semibold uppercase tracking-widest mb-2">Welcome to the Demo</p>
          <h1 className="text-2xl font-bold text-white">Hey {firstName}, explore Field Manager Pro</h1>
          <p className="text-violet-100 text-sm mt-2 leading-relaxed">
            Everything below is loaded with sample data from a real-looking business. Click any feature to see it in action — and yes, you can enter data to try it out.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-4">
        {/* Tier 1 — Hero Features */}
        <div className="space-y-3 mb-6">
          {TIER1.map(f => (
            <button key={f.href} onClick={() => router.push(f.href)}
              className="w-full bg-gray-900 border border-gray-800 hover:border-violet-500/50 rounded-2xl p-4 flex items-center gap-4 text-left transition-all hover:shadow-lg hover:shadow-violet-900/20 group">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center shrink-0 shadow-lg group-hover:scale-105 transition-transform`}>
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm">{f.label}</p>
                <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{f.desc}</p>
              </div>
              <svg className="w-4 h-4 text-gray-600 shrink-0 group-hover:text-violet-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        {/* Tier 2 — Power Features */}
        <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-3 px-1">More Features</p>
        <div className="grid grid-cols-2 gap-3 mb-6">
          {TIER2.map(f => (
            <button key={f.href} onClick={() => router.push(f.href)}
              className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-3.5 text-left transition-colors">
              <p className="text-white font-semibold text-sm">{f.label}</p>
              <p className="text-gray-500 text-[11px] mt-1 leading-relaxed">{f.desc}</p>
            </button>
          ))}
        </div>

        {/* Tier 3 — Additional */}
        <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-3 px-1">And More</p>
        <div className="flex flex-wrap gap-2 mb-8">
          {TIER3.map(f => (
            <button key={f.href} onClick={() => router.push(f.href)}
              className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-full px-4 py-2 text-xs text-gray-300 font-medium transition-colors">
              {f.label}
            </button>
          ))}
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-r from-violet-600/20 to-purple-600/20 border border-violet-500/30 rounded-2xl p-5 text-center">
          <p className="text-white font-semibold">Ready to use this for your team?</p>
          <p className="text-violet-200 text-xs mt-1 mb-4">Our AI assistant can walk you through pricing, setup, and customization.</p>
          <button onClick={() => router.push('/help')}
            className="bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl px-6 py-3 text-sm transition-colors">
            Talk to Us — Get Started
          </button>
        </div>

        {/* Exit demo */}
        <button onClick={() => {
          document.cookie = 'fmp-session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
          window.location.href = '/login'
        }} className="block mx-auto mt-6 text-gray-600 hover:text-gray-400 text-xs transition-colors">
          Exit Demo
        </button>
      </div>

      {/* Floating CTA */}
      <div className="fixed bottom-4 left-4 right-4 z-40 max-w-2xl mx-auto">
        <button onClick={() => router.push('/help')}
          className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl py-3 text-sm transition-colors shadow-xl shadow-violet-900/40 flex items-center justify-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Want to use this? Talk to us
        </button>
      </div>
    </div>
  )
}
