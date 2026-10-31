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

        {/* Feature Gallery */}
        <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-3 px-1">See It In Action</p>
        <div className="space-y-4 mb-8">

          {/* GPS Tracking mockup */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-900/40 to-teal-900/40 px-4 py-3 border-b border-gray-800">
              <p className="text-sm font-semibold text-white">Real-Time GPS Tracking</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Watch employees move between locations throughout the day</p>
            </div>
            <div className="p-4 space-y-2">
              <div className="bg-gray-800 rounded-xl p-3 flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-green-500 shrink-0" style={{ boxShadow: '0 0 8px rgba(34,197,94,0.6)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white font-medium">Marcus Johnson</p>
                  <p className="text-[10px] text-gray-500">Clocked in at Downtown — 2h 15m</p>
                </div>
                <span className="text-[10px] text-green-400 font-semibold">ACTIVE</span>
              </div>
              <div className="bg-gray-800 rounded-xl p-3 flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-green-500 shrink-0" style={{ boxShadow: '0 0 8px rgba(34,197,94,0.6)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white font-medium">Sarah Chen (DM)</p>
                  <p className="text-[10px] text-gray-500">Visiting Mayfair — 45m at store</p>
                </div>
                <span className="text-[10px] text-violet-400 font-semibold">3 STOPS</span>
              </div>
              <div className="bg-gray-800 rounded-xl p-3 flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-amber-500 shrink-0 animate-pulse" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white font-medium">Carlos Ramirez (Tech)</p>
                  <p className="text-[10px] text-gray-500">En route to West Allis — ETA 12m</p>
                </div>
                <span className="text-[10px] text-amber-400 font-semibold">TRAVEL</span>
              </div>
            </div>
          </div>

          {/* Accountability mockup */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-red-900/30 to-orange-900/30 px-4 py-3 border-b border-gray-800">
              <p className="text-sm font-semibold text-white">Progressive Accountability</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Documented conversations through termination with full audit trail</p>
            </div>
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0"><span className="w-2 h-2 rounded-full bg-cyan-400" /></span>
                <span className="text-gray-400">Documented Conversation</span>
                <span className="ml-auto text-cyan-400 font-semibold">Informal</span>
              </div>
              <div className="w-px h-3 bg-gray-700 ml-2.5" />
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0"><span className="w-2 h-2 rounded-full bg-amber-400" /></span>
                <span className="text-gray-400">Verbal Warning</span>
                <span className="ml-auto text-amber-400 font-semibold">Auto-sent</span>
              </div>
              <div className="w-px h-3 bg-gray-700 ml-2.5" />
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0"><span className="w-2 h-2 rounded-full bg-orange-400" /></span>
                <span className="text-gray-400">Written Warning</span>
                <span className="ml-auto text-orange-400 font-semibold">Approval req.</span>
              </div>
              <div className="w-px h-3 bg-gray-700 ml-2.5" />
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0"><span className="w-2 h-2 rounded-full bg-red-400" /></span>
                <span className="text-gray-400">Final Warning</span>
                <span className="ml-auto text-red-400 font-semibold">Word doc</span>
              </div>
              <p className="text-[10px] text-gray-600 mt-2 ml-1">Each level includes email notifications, acknowledgment tracking, and downloadable Word documents.</p>
            </div>
          </div>

          {/* Timecard mockup */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-violet-900/40 to-purple-900/40 px-4 py-3 border-b border-gray-800">
              <p className="text-sm font-semibold text-white">Smart Timecards</p>
              <p className="text-[11px] text-gray-400 mt-0.5">GPS-verified shifts with edit audit trail and payroll export</p>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-400">Oct 28 — Nov 3</span>
                <span className="text-xs font-bold text-violet-400">38.5h / 5 shifts</span>
              </div>
              {[
                { day: 'Mon', h: '8.2', t: '9:02a — 5:14p', s: 'Downtown' },
                { day: 'Tue', h: '7.8', t: '8:45a — 4:35p', s: 'Mayfair' },
                { day: 'Wed', h: '8.5', t: '9:15a — 5:45p', s: 'Downtown', edited: true },
                { day: 'Thu', h: '7.0', t: '10:00a — 5:00p', s: 'Greenfield' },
                { day: 'Fri', h: '7.0', t: '9:30a — 4:30p', s: 'Downtown' },
              ].map(s => (
                <div key={s.day} className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-7">{s.day}</span>
                    <span className="text-gray-300">{s.t}</span>
                    {s.edited && <span className="text-[9px] text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">Corrected</span>}
                  </div>
                  <span className="text-gray-400">{s.h}h</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Assistant mockup */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-pink-900/30 to-rose-900/30 px-4 py-3 border-b border-gray-800">
              <p className="text-sm font-semibold text-white">Built-In AI Assistant</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Answers employee questions, troubleshoots GPS issues, and auto-learns</p>
            </div>
            <div className="p-4 space-y-2">
              <div className="flex justify-end"><div className="bg-violet-600 rounded-2xl rounded-br-sm px-3 py-2 max-w-[75%]"><p className="text-xs text-white">I can&apos;t clock in, it says I&apos;m too far</p></div></div>
              <div className="flex justify-start"><div className="bg-gray-800 rounded-2xl rounded-bl-sm px-3 py-2 max-w-[75%]"><p className="text-xs text-gray-200">Let me check your GPS. Try force-closing the app and reopening it. Make sure Location is set to &quot;Always&quot; in your phone settings.</p></div></div>
              <div className="flex justify-end"><div className="bg-violet-600 rounded-2xl rounded-br-sm px-3 py-2 max-w-[75%]"><p className="text-xs text-white">That worked! Thanks</p></div></div>
              <div className="flex justify-start"><div className="bg-gray-800 rounded-2xl rounded-bl-sm px-3 py-2 max-w-[75%]"><p className="text-xs text-gray-200">Great! You&apos;re clocked in now. Have a good shift!</p></div></div>
              <p className="text-[10px] text-gray-600 mt-2 text-center">AI learns from every resolved conversation and escalates when it can&apos;t help</p>
            </div>
          </div>

          {/* Coaching mockup */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-900/30 to-cyan-900/30 px-4 py-3 border-b border-gray-800">
              <p className="text-sm font-semibold text-white">AI Coaching Grades</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Every coaching session is AI-graded with actionable feedback</p>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-400">Monthly Average</p>
                  <p className="text-2xl font-bold text-white">B+</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Trend</p>
                  <p className="text-sm font-semibold text-green-400">Improving</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {[
                  { cat: 'Specificity', pct: 85, color: 'bg-green-500' },
                  { cat: 'Actionability', pct: 78, color: 'bg-blue-500' },
                  { cat: 'Follow-Up', pct: 65, color: 'bg-amber-500' },
                  { cat: 'Depth', pct: 72, color: 'bg-violet-500' },
                  { cat: 'Prior Reference', pct: 55, color: 'bg-red-500' },
                ].map(c => (
                  <div key={c.cat} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500 w-24">{c.cat}</span>
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full ${c.color} rounded-full`} style={{ width: `${c.pct}%` }} />
                    </div>
                    <span className="text-gray-400 w-8 text-right">{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Custom features callout */}
          <div className="bg-gradient-to-r from-gray-800 to-gray-900 border border-gray-700 rounded-2xl p-5 text-center">
            <p className="text-white font-semibold">Don&apos;t see a feature you need?</p>
            <p className="text-gray-400 text-xs mt-1 leading-relaxed">That&apos;s the best part — Field Manager Pro is custom-built. We can add any feature your company needs. Tell us what you&apos;re looking for.</p>
          </div>
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
