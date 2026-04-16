'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'rdm' | 'developer'
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function getMonday(offsetWeeks: number): Date {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const d = new Date(now)
  d.setDate(d.getDate() + diffToMonday + offsetWeeks * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function deadlineDaysLeft(monday: Date): number {
  const deadline = new Date(monday)
  deadline.setDate(deadline.getDate() - 3) // Friday before the week
  deadline.setHours(23, 59, 59, 999)
  return Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

const WEEK_LABELS = ['This Week', 'Next Week', 'Week After']

export default function SchedulePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [activeTab, setActiveTab] = useState(1) // default to next week

  // Per-week state: [thisWeek, nextWeek, weekAfter]
  const [weekDays, setWeekDays] = useState<(number[] | null)[]>([null, null, null])
  const [selectedDays, setSelectedDays] = useState<number[][]>([[], [], []])
  const [submitted, setSubmitted] = useState<boolean[]>([false, false, false])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const mondays = [getMonday(0), getMonday(1), getMonday(2)]
  const mondayStrs = mondays.map(m => m.toISOString().split('T')[0])

  const loadWeek = useCallback(async (weekIdx: number) => {
    if (weekDays[weekIdx] !== null) return // already loaded
    const res = await fetch(`/api/schedule?week=${mondayStrs[weekIdx]}`)
    if (res.ok) {
      const { schedule } = await res.json()
      setWeekDays(prev => { const n = [...prev]; n[weekIdx] = schedule?.days_working ?? []; return n })
      if (schedule) {
        setSelectedDays(prev => { const n = [...prev]; n[weekIdx] = schedule.days_working; return n })
        setSubmitted(prev => { const n = [...prev]; n[weekIdx] = true; return n })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mondayStrs.join(',')])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
    // Load all 3 weeks upfront
    loadWeek(0)
    loadWeek(1)
    loadWeek(2)
  }, [loadWeek])

  function toggleDay(idx: number) {
    setSelectedDays(prev => {
      const n = [...prev]
      const cur = n[activeTab]
      n[activeTab] = cur.includes(idx) ? cur.filter(d => d !== idx) : [...cur, idx].sort((a, b) => a - b)
      return n
    })
  }

  async function handleSubmit() {
    if (selectedDays[activeTab].length === 0) {
      setMessage({ text: 'Select at least one day', type: 'error' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysWorking: selectedDays[activeTab], weekStart: mondayStrs[activeTab] }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ text: data.error || 'Failed to submit', type: 'error' })
      } else {
        setSubmitted(prev => { const n = [...prev]; n[activeTab] = true; return n })
        setWeekDays(prev => { const n = [...prev]; n[activeTab] = selectedDays[activeTab]; return n })
        setMessage({ text: 'Schedule submitted!', type: 'success' })
      }
    } catch {
      setMessage({ text: 'Network error', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const daysLeft = deadlineDaysLeft(mondays[activeTab])
  const isOverdue = activeTab === 1 && daysLeft < 0 // only enforce deadline for next week
  const curSelectedDays = selectedDays[activeTab]
  const isSubmitted = submitted[activeTab]

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-white mb-4">Schedule</h1>

        {/* Week tabs */}
        <div className="flex gap-2 mb-5">
          {WEEK_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => { setActiveTab(i); setMessage(null) }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                activeTab === i
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-gray-400 text-sm mb-4">Week of {formatWeekRange(mondays[activeTab])}</p>

        {/* Status banners */}
        {activeTab === 1 && !isOverdue && !isSubmitted && (
          <div className={`rounded-xl p-4 mb-5 ${daysLeft <= 2 ? 'bg-amber-950 border border-amber-700' : 'bg-gray-900 border border-gray-800'}`}>
            <p className={`text-sm font-medium ${daysLeft <= 2 ? 'text-amber-400' : 'text-gray-300'}`}>
              {daysLeft <= 2 ? `Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : `${daysLeft} days to submit`}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Deadline: Friday before the week starts</p>
          </div>
        )}

        {activeTab === 1 && isOverdue && !isSubmitted && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-5">
            <p className="text-red-400 font-semibold text-sm">Schedule submission is past due</p>
            <p className="text-xs text-gray-400 mt-0.5">Contact your manager if you need assistance.</p>
          </div>
        )}

        {isSubmitted && (
          <div className="bg-green-950 border border-green-800 rounded-xl p-4 mb-5">
            <p className="text-green-400 font-semibold text-sm">Schedule submitted</p>
            <p className="text-xs text-gray-400 mt-0.5">You can update your selection anytime.</p>
          </div>
        )}

        {/* Day picker */}
        <div className="space-y-2 mb-6">
          {DAY_NAMES.map((day, idx) => {
            const selected = curSelectedDays.includes(idx)
            return (
              <button
                key={idx}
                onClick={() => toggleDay(idx)}
                disabled={isOverdue && !isSubmitted}
                className={`w-full flex items-center justify-between px-5 py-4 rounded-xl border transition-all ${
                  selected
                    ? 'bg-violet-900/50 border-violet-500 text-white'
                    : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <span className="font-medium">{day}</span>
                {selected && (
                  <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>

        {message && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
            message.type === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        {!isOverdue && (
          <button
            onClick={handleSubmit}
            disabled={loading || curSelectedDays.length === 0}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl transition-colors"
          >
            {loading ? 'Submitting…' : isSubmitted ? 'Update Schedule' : 'Submit Schedule'}
          </button>
        )}
      </div>
    </div>
  )
}
