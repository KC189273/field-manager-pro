'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface SwapRequest {
  id: string
  status: string
  requester_id: string
  requester_name: string
  requester_avatar_url?: string | null
  target_id: string
  target_name: string
  target_avatar_url?: string | null
  manager_id: string
  requester_note: string | null
  target_note: string | null
  dm_note: string | null
  created_at: string
  responded_at: string | null
  decided_at: string | null
  requester_shift_id: string | null
  requester_shift_date: string | null
  requester_shift_start: string | null
  requester_shift_end: string | null
  requester_shift_store: string | null
  target_shift_id: string | null
  target_shift_date: string | null
  target_shift_start: string | null
  target_shift_end: string | null
  target_shift_store: string | null
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function shiftHrs(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, (eh + em / 60) - (sh + sm / 60))
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending_target': return { text: 'Awaiting Response', color: 'text-yellow-400', dot: 'bg-yellow-400' }
    case 'pending_dm': return { text: 'Awaiting Manager', color: 'text-blue-400', dot: 'bg-blue-400' }
    case 'approved': return { text: 'Approved', color: 'text-green-400', dot: 'bg-green-400' }
    case 'denied': return { text: 'Denied', color: 'text-red-400', dot: 'bg-red-400' }
    case 'target_declined': return { text: 'Declined', color: 'text-gray-400', dot: 'bg-gray-400' }
    default: return { text: status, color: 'text-gray-400', dot: 'bg-gray-600' }
  }
}

interface HoursImpact {
  currentPeriodHours: number
  projectedPeriodHours: number
  weekOtRisk: boolean
  periodOtRisk: boolean
}

function ShiftCard({ label, date, start, end, store }: {
  label: string
  date: string | null
  start: string | null
  end: string | null
  store: string | null
}) {
  if (!date || !start || !end) return null
  const hrs = shiftHrs(start, end)
  return (
    <div className="bg-gray-800 rounded-xl px-4 py-3">
      <p className="text-[10px] text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-semibold text-white">{fmtDate(date)}</p>
      <p className="text-xs text-gray-300 mt-0.5">{fmtTime(start)} – {fmtTime(end)} <span className="text-gray-500">({Math.round(hrs * 10) / 10}h)</span></p>
      {store && <p className="text-xs text-gray-500 mt-0.5 truncate">{store.split(',')[0]}</p>}
    </div>
  )
}

function HoursImpactRow({ name, impact }: { name: string; impact: HoursImpact }) {
  const delta = impact.projectedPeriodHours - impact.currentPeriodHours
  const anyOt = impact.weekOtRisk || impact.periodOtRisk
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-300">{name}</span>
      <div className="flex items-center gap-3 text-right">
        <div>
          <p className="text-xs text-gray-500">Current</p>
          <p className="text-sm text-white">{impact.currentPeriodHours.toFixed(1)}h</p>
        </div>
        <div className="text-gray-600">→</div>
        <div>
          <p className="text-xs text-gray-500">If Approved</p>
          <p className={`text-sm font-semibold ${anyOt ? 'text-red-400' : 'text-green-400'}`}>
            {impact.projectedPeriodHours.toFixed(1)}h
            <span className="text-gray-500 font-normal text-xs ml-1">({delta >= 0 ? '+' : ''}{delta.toFixed(1)}h)</span>
          </p>
        </div>
        {anyOt && <span className="text-[10px] bg-red-900/60 text-red-400 px-1.5 py-0.5 rounded font-bold">OT</span>}
      </div>
    </div>
  )
}

export default function ShiftSwapsPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [swaps, setSwaps] = useState<SwapRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [responding, setResponding] = useState<string | null>(null)

  // Response modal state
  const [modal, setModal] = useState<{ swapId: string; action: 'accept' | 'decline' | 'approve' | 'deny' } | null>(null)
  const [modalNote, setModalNote] = useState('')
  const [modalError, setModalError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Create swap state
  const [showCreate, setShowCreate] = useState(false)
  const [myShifts, setMyShifts] = useState<Array<{ id: string; shift_date: string; start_time: string; end_time: string; store_address: string | null }>>([])
  const [selectedMyShift, setSelectedMyShift] = useState<string | null>(null)
  const [availableTargets, setAvailableTargets] = useState<Array<{ id: string; shift_date: string; start_time: string; end_time: string; employee_name: string; store_address: string | null }>>([])
  const [selectedTargetShift, setSelectedTargetShift] = useState<string | null>(null)
  const [swapNote, setSwapNote] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const [loadingShifts, setLoadingShifts] = useState(false)

  // Hours impact for DM review (fetched lazily per swap)
  const [hoursMap, setHoursMap] = useState<Record<string, { requester: HoursImpact; target: HoursImpact }>>({})

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  const loadSwaps = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/shift-swaps')
    if (res.ok) {
      const data = await res.json()
      setSwaps(data.swaps ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (session) loadSwaps()
  }, [session, loadSwaps])

  // Fetch hours impact for a pending_dm swap (DM view)
  async function fetchImpact(swap: SwapRequest) {
    if (hoursMap[swap.id]) return
    if (!swap.requester_shift_date || !swap.requester_shift_start || !swap.requester_shift_end) return
    if (!swap.target_shift_date || !swap.target_shift_start || !swap.target_shift_end) return

    try {
      const res = await fetch(`/api/shift-swaps/${swap.id}/impact`)
      if (res.ok) {
        const data = await res.json()
        setHoursMap(m => ({ ...m, [swap.id]: data }))
      }
    } catch {}
  }

  function openModal(swapId: string, action: 'accept' | 'decline' | 'approve' | 'deny') {
    setModal({ swapId, action })
    setModalNote('')
    setModalError('')
  }

  async function submitResponse() {
    if (!modal) return
    const { swapId, action } = modal

    if ((action === 'deny') && !modalNote.trim()) {
      setModalError('A note is required when denying.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/shift-swaps/${swapId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: modalNote.trim() || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setModalError(d.error ?? 'Something went wrong.')
        return
      }
      setModal(null)
      await loadSwaps()
    } catch {
      setModalError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function openCreateSwap() {
    setShowCreate(true)
    setSelectedMyShift(null)
    setSelectedTargetShift(null)
    setAvailableTargets([])
    setSwapNote('')
    setCreateError('')
    setLoadingShifts(true)
    try {
      const res = await fetch('/api/shift-swaps?myShifts=true')
      if (res.ok) {
        const data = await res.json()
        setMyShifts(data.myShifts ?? [])
      }
    } catch {
      setCreateError('Failed to load your shifts.')
    } finally {
      setLoadingShifts(false)
    }
  }

  async function selectMyShift(shiftId: string) {
    setSelectedMyShift(shiftId)
    setSelectedTargetShift(null)
    setAvailableTargets([])
    setCreateError('')
    try {
      const res = await fetch(`/api/shift-swaps?availableFor=${shiftId}`)
      if (res.ok) {
        const data = await res.json()
        setAvailableTargets(data.targets ?? [])
        if ((data.targets ?? []).length === 0) {
          setCreateError('No coworkers are scheduled at your store this week to swap with.')
        }
      }
    } catch {
      setCreateError('Failed to load available shifts.')
    }
  }

  async function submitSwapRequest() {
    if (!selectedMyShift || !selectedTargetShift) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch('/api/shift-swaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterShiftId: selectedMyShift,
          targetShiftId: selectedTargetShift,
          note: swapNote.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setCreateError(d.error ?? 'Failed to create swap request.')
        return
      }
      setShowCreate(false)
      await loadSwaps()
    } catch {
      setCreateError('Network error. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const isManager = session.role === 'manager' || session.role === 'ops_manager' || session.role === 'owner' || session.role === 'sales_director' || session.role === 'developer'

  // Segment swaps
  const needsMyResponse = swaps.filter(s => s.status === 'pending_target' && s.target_id === session.id)
  const pendingDmApproval = swaps.filter(s => s.status === 'pending_dm' && s.manager_id === session.id)
  const myPending = swaps.filter(s =>
    (s.status === 'pending_target' || s.status === 'pending_dm') &&
    (s.requester_id === session.id || (s.target_id === session.id && s.status === 'pending_dm'))
    && !needsMyResponse.find(r => r.id === s.id)
    && !pendingDmApproval.find(r => r.id === s.id)
  )
  const history = swaps.filter(s =>
    s.status === 'approved' || s.status === 'denied' || s.status === 'target_declined'
  )

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-white">Shift Swaps</h1>
          {session.role === 'employee' && (
            <button onClick={openCreateSwap}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
              <span className="text-base leading-none">+</span>
              <span>Request Swap</span>
            </button>
          )}
        </div>

        {/* Create Swap Flow */}
        {showCreate && (
          <div className="bg-gray-900 border border-violet-500/30 rounded-2xl p-4 mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-white">Request a Shift Swap</p>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {loadingShifts ? (
              <p className="text-sm text-gray-500 text-center py-4">Loading your shifts...</p>
            ) : myShifts.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">You have no upcoming published shifts to swap.</p>
            ) : (
              <>
                {/* Step 1: Pick your shift */}
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">1. Select your shift to give up</p>
                  <div className="space-y-2">
                    {myShifts.map(shift => (
                      <button key={shift.id} type="button" onClick={() => selectMyShift(shift.id)}
                        className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                          selectedMyShift === shift.id
                            ? 'bg-violet-600/20 border-violet-500'
                            : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                        }`}>
                        <p className="text-sm font-semibold text-white">{fmtDate(shift.shift_date)}</p>
                        <p className="text-xs text-gray-400">{fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}</p>
                        {shift.store_address && <p className="text-xs text-gray-500 mt-0.5 truncate">{shift.store_address}</p>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Step 2: Pick target shift */}
                {selectedMyShift && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">2. Select shift to swap with</p>
                    {availableTargets.length === 0 && !createError ? (
                      <p className="text-sm text-gray-500 text-center py-4">Loading available shifts...</p>
                    ) : (
                      <div className="space-y-2">
                        {availableTargets.map(target => (
                          <button key={target.id} type="button" onClick={() => setSelectedTargetShift(target.id)}
                            className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                              selectedTargetShift === target.id
                                ? 'bg-violet-600/20 border-violet-500'
                                : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                            }`}>
                            <p className="text-sm font-semibold text-white">{target.employee_name}</p>
                            <p className="text-xs text-gray-400">{fmtDate(target.shift_date)} · {fmtTime(target.start_time)} – {fmtTime(target.end_time)}</p>
                            {target.store_address && <p className="text-xs text-gray-500 mt-0.5 truncate">{target.store_address}</p>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 3: Note + Submit */}
                {selectedTargetShift && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">3. Add a note (optional)</p>
                      <input type="text" value={swapNote} onChange={e => setSwapNote(e.target.value)}
                        placeholder="e.g. I have a doctor's appointment that day"
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                    </div>
                    <button onClick={submitSwapRequest} disabled={creating}
                      className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                      {creating ? 'Submitting...' : 'Submit Swap Request'}
                    </button>
                  </div>
                )}
              </>
            )}

            {createError && (
              <p className="text-sm text-red-400 text-center">{createError}</p>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading…</div>
        ) : (
          <div className="space-y-6">
            {/* Needs My Response */}
            {needsMyResponse.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-3">
                  Action Needed ({needsMyResponse.length})
                </h2>
                <div className="space-y-3">
                  {needsMyResponse.map(swap => (
                    <div key={swap.id} className="bg-gray-900 border border-yellow-600/40 rounded-2xl p-4">
                      <div className="flex items-center gap-2 mb-1">
                        {swap.requester_avatar_url
                          ? <img src={swap.requester_avatar_url} alt={swap.requester_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          : <div className="w-7 h-7 rounded-full bg-violet-800 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">{swap.requester_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
                        }
                        <p className="text-sm font-semibold text-white">
                          {swap.requester_name} wants to swap shifts with you
                        </p>
                      </div>
                      <p className="text-xs text-gray-500 mb-3">
                        {swap.created_at ? new Date(swap.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                      </p>

                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <ShiftCard
                          label={`${swap.requester_name}'s shift (they give up)`}
                          date={swap.requester_shift_date}
                          start={swap.requester_shift_start}
                          end={swap.requester_shift_end}
                          store={swap.requester_shift_store}
                        />
                        <ShiftCard
                          label="Your shift (you give up)"
                          date={swap.target_shift_date}
                          start={swap.target_shift_start}
                          end={swap.target_shift_end}
                          store={swap.target_shift_store}
                        />
                      </div>

                      {swap.requester_note && (
                        <div className="bg-gray-800 rounded-xl px-3 py-2.5 mb-3">
                          <p className="text-[10px] text-gray-500 mb-0.5">Note from {swap.requester_name}</p>
                          <p className="text-xs text-gray-300">{swap.requester_note}</p>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => openModal(swap.id, 'decline')}
                          disabled={!!responding}
                          className="flex-1 py-2.5 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => openModal(swap.id, 'accept')}
                          disabled={!!responding}
                          className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm text-white font-semibold transition-colors"
                        >
                          Accept
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* DM Approval Queue */}
            {isManager && pendingDmApproval.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">
                  Pending Approval ({pendingDmApproval.length})
                </h2>
                <div className="space-y-3">
                  {pendingDmApproval.map(swap => {
                    const impact = hoursMap[swap.id]
                    const anyOt = impact && (impact.requester.weekOtRisk || impact.requester.periodOtRisk || impact.target.weekOtRisk || impact.target.periodOtRisk)

                    // Trigger impact fetch when rendered
                    if (!impact) fetchImpact(swap)

                    return (
                      <div key={swap.id} className={`bg-gray-900 border rounded-2xl p-4 ${anyOt ? 'border-red-600/50' : 'border-blue-600/40'}`}>
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {swap.requester_name} ↔ {swap.target_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {swap.responded_at ? `Both agreed ${new Date(swap.responded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                            </p>
                          </div>
                          {anyOt && (
                            <span className="shrink-0 text-[10px] bg-red-900/60 text-red-400 px-2 py-1 rounded-lg font-bold ml-2">
                              ⚠ OT RISK
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <ShiftCard
                            label={`${swap.requester_name} gives up`}
                            date={swap.requester_shift_date}
                            start={swap.requester_shift_start}
                            end={swap.requester_shift_end}
                            store={swap.requester_shift_store}
                          />
                          <ShiftCard
                            label={`${swap.target_name} gives up`}
                            date={swap.target_shift_date}
                            start={swap.target_shift_start}
                            end={swap.target_shift_end}
                            store={swap.target_shift_store}
                          />
                        </div>

                        {/* Hours impact */}
                        {impact ? (
                          <div className="bg-gray-800 rounded-xl px-4 py-2 mb-3">
                            <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider">Pay Period Hours Impact</p>
                            <HoursImpactRow name={swap.requester_name} impact={impact.requester} />
                            <HoursImpactRow name={swap.target_name} impact={impact.target} />
                          </div>
                        ) : (
                          <div className="bg-gray-800 rounded-xl px-4 py-3 mb-3 text-center">
                            <p className="text-xs text-gray-600">Calculating hours impact…</p>
                          </div>
                        )}

                        {swap.requester_note && (
                          <div className="bg-gray-800 rounded-xl px-3 py-2.5 mb-2">
                            <p className="text-[10px] text-gray-500 mb-0.5">Note from {swap.requester_name}</p>
                            <p className="text-xs text-gray-300">{swap.requester_note}</p>
                          </div>
                        )}
                        {swap.target_note && (
                          <div className="bg-gray-800 rounded-xl px-3 py-2.5 mb-3">
                            <p className="text-[10px] text-gray-500 mb-0.5">Note from {swap.target_name}</p>
                            <p className="text-xs text-gray-300">{swap.target_note}</p>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            onClick={() => openModal(swap.id, 'deny')}
                            className="flex-1 py-2.5 rounded-xl border border-red-700/50 text-sm text-red-400 hover:bg-red-900/20 transition-colors"
                          >
                            Deny
                          </button>
                          <button
                            onClick={() => openModal(swap.id, 'approve')}
                            className="flex-1 py-2.5 rounded-xl bg-green-700 hover:bg-green-600 text-sm text-white font-semibold transition-colors"
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* My Pending */}
            {myPending.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">My Pending Requests</h2>
                <div className="space-y-3">
                  {myPending.map(swap => {
                    const s = statusLabel(swap.status)
                    return (
                      <div key={swap.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold text-white">
                            {swap.requester_id === session.id
                              ? `Swap with ${swap.target_name}`
                              : `Swap with ${swap.requester_name}`}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            <span className={`text-xs ${s.color}`}>{s.text}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <ShiftCard label="Your shift" date={swap.requester_shift_date} start={swap.requester_shift_start} end={swap.requester_shift_end} store={swap.requester_shift_store} />
                          <ShiftCard label="Their shift" date={swap.target_shift_date} start={swap.target_shift_start} end={swap.target_shift_end} store={swap.target_shift_store} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* History */}
            {history.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">History</h2>
                <div className="space-y-2">
                  {history.map(swap => {
                    const s = statusLabel(swap.status)
                    return (
                      <div key={swap.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-white">
                            {swap.requester_name} ↔ {swap.target_name}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            <span className={`text-xs ${s.color}`}>{s.text}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <ShiftCard label={`${swap.requester_name}'s old shift`} date={swap.requester_shift_date} start={swap.requester_shift_start} end={swap.requester_shift_end} store={swap.requester_shift_store} />
                          <ShiftCard label={`${swap.target_name}'s old shift`} date={swap.target_shift_date} start={swap.target_shift_start} end={swap.target_shift_end} store={swap.target_shift_store} />
                        </div>
                        {swap.dm_note && (
                          <div className="mt-2 bg-gray-800 rounded-xl px-3 py-2">
                            <p className="text-[10px] text-gray-500 mb-0.5">Manager note</p>
                            <p className="text-xs text-gray-300">{swap.dm_note}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {swaps.length === 0 && (
              <div className="text-center text-gray-500 py-16">
                <p className="text-sm">No shift swap requests yet.</p>
                {session.role === 'employee' && (
                  <p className="text-xs mt-1">Go to your schedule to request a shift swap.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Response Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-2">
              {modal.action === 'accept' ? 'Accept Swap' :
               modal.action === 'decline' ? 'Decline Swap' :
               modal.action === 'approve' ? 'Approve Swap' : 'Deny Swap'}
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              {modal.action === 'accept' ? 'This will send the request to your manager for final approval.' :
               modal.action === 'decline' ? 'The requester will be notified.' :
               modal.action === 'approve' ? 'The schedule will be updated automatically and both employees will be notified.' :
               'A note is required explaining why the swap was denied.'}
            </p>

            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5">
                {modal.action === 'deny' ? 'Reason for denial (required)' : 'Note (optional)'}
              </label>
              <textarea
                value={modalNote}
                onChange={e => setModalNote(e.target.value)}
                rows={3}
                placeholder={modal.action === 'deny' ? 'Explain why you are denying this swap…' : 'Add a note…'}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>

            {modalError && (
              <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400 mb-4">
                {modalError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setModal(null)}
                className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={submitResponse}
                disabled={submitting}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                  modal.action === 'deny' ? 'bg-red-600 hover:bg-red-500' :
                  modal.action === 'approve' ? 'bg-green-700 hover:bg-green-600' :
                  'bg-violet-600 hover:bg-violet-500'
                }`}
              >
                {submitting ? '…' :
                 modal.action === 'accept' ? 'Accept & Forward to Manager' :
                 modal.action === 'decline' ? 'Decline Swap' :
                 modal.action === 'approve' ? 'Approve & Update Schedule' : 'Deny Swap'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
