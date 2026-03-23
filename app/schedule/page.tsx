'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'developer'
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function nextWeekStart(): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 1 : 8 - day
  const d = new Date(now)
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function daysUntilDeadline(): number {
  const now = new Date()
  const next = nextWeekStart()
  const deadline = new Date(next)
  deadline.setDate(deadline.getDate() - 3)
  deadline.setHours(23, 59, 59, 999)
  return Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export default function SchedulePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [selectedDays, setSelectedDays] = useState<number[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [existingDays, setExistingDays] = useState<number[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const nextMon = nextWeekStart()
  const nextMonStr = nextMon.toISOString().split('T')[0]
  const daysLeft = daysUntilDeadline()
  const overdue = daysLeft < 0

  useEffect(() => {
    async function load() {
      const [meRes, schedRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch(`/api/schedule?week=${nextMonStr}`),
      ])
      if (meRes.ok) setSession(await meRes.json())
      if (schedRes.ok) {
        const { schedule } = await schedRes.json()
        if (schedule) {
          setExistingDays(schedule.days_working)
          setSelectedDays(schedule.days_working)
          setSubmitted(true)
        }
      }
    }
    load()
  }, [nextMonStr])

  function toggleDay(idx: number) {
    setSelectedDays(prev =>
      prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort((a, b) => a - b)
    )
  }

  async function handleSubmit() {
    if (selectedDays.length === 0) {
      setMessage({ text: 'Select at least one day', type: 'error' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysWorking: selectedDays, weekStart: nextMonStr }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ text: data.error || 'Failed to submit', type: 'error' })
      } else {
        setExistingDays(selectedDays)
        setSubmitted(true)
        setMessage({ text: 'Schedule submitted!', type: 'success' })
      }
    } catch {
      setMessage({ text: 'Network error', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-white mb-1">Schedule</h1>
        <p className="text-gray-400 text-sm mb-6">Week of {formatWeekRange(nextMon)}</p>

        {/* Deadline banner */}
        {!overdue && !submitted && (
          <div className={`rounded-xl p-4 mb-5 ${daysLeft <= 2 ? 'bg-amber-950 border border-amber-700' : 'bg-gray-900 border border-gray-800'}`}>
            <p className={`text-sm font-medium ${daysLeft <= 2 ? 'text-amber-400' : 'text-gray-300'}`}>
              {daysLeft <= 2 ? `⚡ Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : `📅 ${daysLeft} days to submit`}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Deadline: Friday before the week starts</p>
          </div>
        )}

        {overdue && !submitted && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-5">
            <p className="text-red-400 font-semibold text-sm">⚠ Schedule submission is past due</p>
            <p className="text-xs text-gray-400 mt-0.5">Contact your manager if you need assistance.</p>
          </div>
        )}

        {submitted && (
          <div className="bg-green-950 border border-green-800 rounded-xl p-4 mb-5">
            <p className="text-green-400 font-semibold text-sm">✓ Schedule submitted</p>
            <p className="text-xs text-gray-400 mt-0.5">You can update your selection until the deadline.</p>
          </div>
        )}

        {/* Day picker */}
        <div className="space-y-2 mb-6">
          {DAY_NAMES.map((day, idx) => {
            const selected = selectedDays.includes(idx)
            return (
              <button
                key={idx}
                onClick={() => toggleDay(idx)}
                disabled={overdue && !submitted}
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

        {/* Message */}
        {message && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
            message.type === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        {/* Submit button */}
        {!overdue && (
          <button
            onClick={handleSubmit}
            disabled={loading || selectedDays.length === 0}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl transition-colors"
          >
            {loading ? 'Submitting…' : submitted ? 'Update Schedule' : 'Submit Schedule'}
          </button>
        )}
      </div>
    </div>
  )
}
