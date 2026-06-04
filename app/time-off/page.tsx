'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

interface Session {
  id: string
  fullName: string
  role: Role
}

interface MyRequest {
  id: string
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'denied'
  notes: string | null
  created_at: string
  approver_name: string
  partial_day: boolean
  partial_start_time: string | null
  partial_end_time: string | null
}

interface PendingApproval {
  id: string
  start_date: string
  end_date: string
  reason: string | null
  status: string
  created_at: string
  user_name: string
  user_id: string
  user_avatar_url?: string | null
  partial_day: boolean
  partial_start_time: string | null
  partial_end_time: string | null
}

function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`
}

function fmtDateRange(start: string, end: string, partialDay?: boolean, startTime?: string | null, endTime?: string | null): string {
  if (partialDay && startTime && endTime) {
    return `${fmtDate(start)} · ${fmtTime12(startTime)} – ${fmtTime12(endTime)}`
  }
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  if (start === end) return fmtDate(start)
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.getDate()}, ${e.getFullYear()}`
  }
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-amber-900/40 text-amber-400 border-amber-800/40',
  approved: 'bg-green-900/40 text-green-400 border-green-800/40',
  denied:   'bg-red-900/40 text-red-400 border-red-800/40',
}

export default function TimeOffPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [myRequests, setMyRequests] = useState<MyRequest[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [loading, setLoading] = useState(true)

  // Request modal
  const [showRequest, setShowRequest] = useState(false)
  const [form, setForm] = useState({ startDate: '', endDate: '', reason: '', partialDay: false, startTime: '', endTime: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Edit modal
  const [editing, setEditing] = useState<MyRequest | null>(null)
  const [editForm, setEditForm] = useState({ startDate: '', endDate: '', reason: '', partialDay: false, startTime: '', endTime: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState('')

  // Cancel
  const [cancelling, setCancelling] = useState<string | null>(null)

  // Decision modal
  const [deciding, setDeciding] = useState<PendingApproval | null>(null)
  const [decisionStatus, setDecisionStatus] = useState<'approved' | 'denied'>('approved')
  const [decisionNotes, setDecisionNotes] = useState('')
  const [decisioning, setDecisioning] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/time-off')
    if (res.ok) {
      const d = await res.json()
      setMyRequests(d.myRequests ?? [])
      setPendingApprovals(d.pendingApprovals ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!session) return
    load()
  }, [session, load])

  async function submitRequest() {
    setSubmitError('')
    if (!form.startDate) { setSubmitError('Please select a date.'); return }
    if (!form.partialDay && !form.endDate) { setSubmitError('Please select an end date.'); return }
    if (!form.partialDay && new Date(form.startDate) > new Date(form.endDate)) { setSubmitError('Start date must be before end date.'); return }
    if (form.partialDay && (!form.startTime || !form.endTime)) { setSubmitError('Please enter start and end times.'); return }
    setSubmitting(true)
    const endDate = form.partialDay ? form.startDate : form.endDate
    try {
      const res = await fetch('/api/time-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: form.startDate, endDate, reason: form.reason || null,
          partialDay: form.partialDay,
          partialStartTime: form.partialDay ? form.startTime : null,
          partialEndTime: form.partialDay ? form.endTime : null,
        }),
      })
      const d = await res.json()
      if (!res.ok) { setSubmitError(d.error ?? 'Failed to submit request.'); return }
      setShowRequest(false)
      await load()
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function openEdit(req: MyRequest) {
    setEditing(req)
    setEditForm({
      startDate: req.start_date,
      endDate: req.end_date,
      reason: req.reason ?? '',
      partialDay: req.partial_day,
      startTime: req.partial_start_time?.slice(0, 5) ?? '',
      endTime: req.partial_end_time?.slice(0, 5) ?? '',
    })
    setEditError('')
  }

  async function submitEdit() {
    if (!editing) return
    setEditError('')
    if (!editForm.startDate) { setEditError('Please select a date.'); return }
    if (!editForm.partialDay && !editForm.endDate) { setEditError('Please select an end date.'); return }
    if (!editForm.partialDay && new Date(editForm.startDate) > new Date(editForm.endDate)) { setEditError('Start date must be before end date.'); return }
    if (editForm.partialDay && (!editForm.startTime || !editForm.endTime)) { setEditError('Please enter start and end times.'); return }
    setEditSubmitting(true)
    const endDate = editForm.partialDay ? editForm.startDate : editForm.endDate
    try {
      const res = await fetch('/api/time-off', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: editing.id, startDate: editForm.startDate, endDate, reason: editForm.reason || null,
          partialDay: editForm.partialDay,
          partialStartTime: editForm.partialDay ? editForm.startTime : null,
          partialEndTime: editForm.partialDay ? editForm.endTime : null,
        }),
      })
      const d = await res.json()
      if (!res.ok) { setEditError(d.error ?? 'Failed to update request.'); return }
      setEditing(null)
      await load()
    } catch {
      setEditError('Network error. Please try again.')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function cancelRequest(requestId: string) {
    setCancelling(requestId)
    try {
      const res = await fetch('/api/time-off', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      if (res.ok) await load()
    } finally {
      setCancelling(null)
    }
  }

  function openDecide(approval: PendingApproval, status: 'approved' | 'denied') {
    setDeciding(approval)
    setDecisionStatus(status)
    setDecisionNotes('')
    setDecisionError('')
  }

  async function submitDecision() {
    if (!deciding) return
    setDecisionError('')
    if (decisionStatus === 'denied' && !decisionNotes.trim()) {
      setDecisionError('Please provide a reason for denying this request.')
      return
    }
    setDecisioning(true)
    try {
      const res = await fetch('/api/time-off', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: deciding.id, status: decisionStatus, notes: decisionNotes || null }),
      })
      const d = await res.json()
      if (!res.ok) { setDecisionError(d.error ?? 'Failed to save decision.'); return }
      setDeciding(null)
      await load()
    } catch {
      setDecisionError('Network error. Please try again.')
    } finally {
      setDecisioning(false)
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="max-w-lg mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">Time Off</h1>
            <p className="text-gray-500 text-sm mt-0.5">Request and manage time off</p>
          </div>
          <button
            onClick={() => { setForm({ startDate: '', endDate: '', reason: '', partialDay: false, startTime: '', endTime: '' }); setSubmitError(''); setShowRequest(true) }}
            className="text-sm bg-violet-600 hover:bg-violet-500 text-white font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            + Request
          </button>
        </div>

        {loading ? (
          <div className="text-center text-gray-500 py-16">Loading…</div>
        ) : (
          <div className="space-y-6">
            {/* Pending Approvals */}
            {pendingApprovals.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">
                  Needs Your Approval — {pendingApprovals.length}
                </p>
                <div className="space-y-2">
                  {pendingApprovals.map(approval => (
                    <div key={approval.id} className="bg-gray-900 border border-amber-800/50 rounded-2xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          {approval.user_avatar_url
                            ? <img src={approval.user_avatar_url} alt={approval.user_name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                            : <div className="w-8 h-8 rounded-full bg-violet-800 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">{approval.user_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
                          }
                          <div className="min-w-0 flex-1">
                          <p className="text-white font-semibold text-sm">{approval.user_name}</p>
                          <p className="text-amber-400 text-sm font-medium mt-0.5">{fmtDateRange(approval.start_date, approval.end_date, approval.partial_day, approval.partial_start_time, approval.partial_end_time)}</p>
                          {approval.reason && (
                            <p className="text-gray-400 text-xs mt-1 italic">"{approval.reason}"</p>
                          )}
                          <p className="text-gray-600 text-[10px] mt-1">
                            Submitted {new Date(approval.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => openDecide(approval, 'approved')}
                          className="flex-1 py-2 rounded-xl bg-green-700 hover:bg-green-600 text-white text-sm font-semibold transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => openDecide(approval, 'denied')}
                          className="flex-1 py-2 rounded-xl bg-gray-800 hover:bg-red-900/60 border border-gray-700 hover:border-red-700 text-gray-300 hover:text-red-400 text-sm font-semibold transition-colors"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* My Requests */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">My Requests</p>
              {myRequests.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-8 text-center">
                  <p className="text-gray-500 text-sm">No time off requests yet</p>
                  <p className="text-gray-700 text-xs mt-1">Tap &quot;+ Request&quot; to submit one</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myRequests.map(req => (
                    <div key={req.id} className={`bg-gray-900 border rounded-2xl p-4 ${req.status === 'denied' ? 'border-red-900/50' : req.status === 'approved' ? 'border-green-900/50' : 'border-gray-800'}`}>
                      <p className="text-white font-semibold text-sm">{fmtDateRange(req.start_date, req.end_date, req.partial_day, req.partial_start_time, req.partial_end_time)}</p>
                      {req.reason && (
                        <p className="text-gray-400 text-xs mt-0.5 italic">"{req.reason}"</p>
                      )}
                      <p className="text-gray-600 text-[10px] mt-1">Sent to {req.approver_name}</p>
                      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full border ${STATUS_STYLES[req.status]}`}>
                          {req.status === 'approved' && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {req.status === 'denied' && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                          {req.status === 'pending' && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <circle cx="12" cy="12" r="9" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
                            </svg>
                          )}
                          {req.status === 'approved' ? 'Approved' : req.status === 'denied' ? 'Declined' : 'Pending'}
                        </span>
                        {req.status === 'pending' && (
                          <button
                            onClick={() => openEdit(req)}
                            className="text-xs text-gray-400 hover:text-white font-medium px-2.5 py-1 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        {req.status !== 'denied' && (
                          <button
                            onClick={() => cancelRequest(req.id)}
                            disabled={cancelling === req.id}
                            className="text-xs text-red-500 hover:text-red-400 font-medium px-2.5 py-1 rounded-lg border border-red-900/50 hover:border-red-700 transition-colors disabled:opacity-50"
                          >
                            {cancelling === req.id ? 'Cancelling…' : 'Cancel'}
                          </button>
                        )}
                      </div>
                      {req.status === 'denied' && req.notes && (
                        <div className="mt-2 bg-red-950/40 border border-red-900/40 rounded-xl px-3 py-2">
                          <p className="text-[10px] text-red-400 font-semibold mb-0.5">Reason</p>
                          <p className="text-xs text-red-300">{req.notes}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Request Modal ── */}
      {showRequest && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowRequest(false)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-5">Request Time Off</h2>
            <div className="space-y-4">
              {/* Full Day / Partial Day toggle */}
              <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-xl p-1">
                <button
                  onClick={() => setForm(f => ({ ...f, partialDay: false, startTime: '', endTime: '' }))}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${!form.partialDay ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Full Day(s)
                </button>
                <button
                  onClick={() => setForm(f => ({ ...f, partialDay: true, endDate: f.startDate }))}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${form.partialDay ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Partial Day
                </button>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">{form.partialDay ? 'Date' : 'Start Date'}</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value, ...(f.partialDay ? { endDate: e.target.value } : {}) }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              {form.partialDay ? (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1.5">Start Time</label>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1.5">End Time</label>
                    <input
                      type="time"
                      value={form.endTime}
                      onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    min={form.startDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Reason <span className="text-gray-600">(optional)</span></label>
                <textarea
                  placeholder="Vacation, personal day, appointment…"
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>
              {submitError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400">{submitError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowRequest(false)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={submitRequest}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditing(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-5">Edit Request</h2>
            <div className="space-y-4">
              {/* Full Day / Partial Day toggle */}
              <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-xl p-1">
                <button
                  onClick={() => setEditForm(f => ({ ...f, partialDay: false, startTime: '', endTime: '' }))}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${!editForm.partialDay ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Full Day(s)
                </button>
                <button
                  onClick={() => setEditForm(f => ({ ...f, partialDay: true, endDate: f.startDate }))}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${editForm.partialDay ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Partial Day
                </button>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">{editForm.partialDay ? 'Date' : 'Start Date'}</label>
                <input
                  type="date"
                  value={editForm.startDate}
                  onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value, ...(f.partialDay ? { endDate: e.target.value } : {}) }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              {editForm.partialDay ? (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1.5">Start Time</label>
                    <input
                      type="time"
                      value={editForm.startTime}
                      onChange={e => setEditForm(f => ({ ...f, startTime: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1.5">End Time</label>
                    <input
                      type="time"
                      value={editForm.endTime}
                      onChange={e => setEditForm(f => ({ ...f, endTime: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={editForm.endDate}
                    min={editForm.startDate}
                    onChange={e => setEditForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Reason <span className="text-gray-600">(optional)</span></label>
                <textarea
                  value={editForm.reason}
                  onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>
              {editError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400">{editError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setEditing(null)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={submitEdit}
                  disabled={editSubmitting}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {editSubmitting ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Decision Modal ── */}
      {deciding && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setDeciding(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">
              {decisionStatus === 'approved' ? 'Approve Request' : 'Deny Request'}
            </h2>
            <p className="text-gray-400 text-sm mb-5">
              {deciding.user_name} · {fmtDateRange(deciding.start_date, deciding.end_date, deciding.partial_day, deciding.partial_start_time, deciding.partial_end_time)}
            </p>

            {decisionStatus === 'denied' && (
              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-1.5">Reason for Denial <span className="text-red-500">*</span></label>
                <textarea
                  placeholder="Please provide a reason…"
                  value={decisionNotes}
                  onChange={e => setDecisionNotes(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 resize-none"
                />
              </div>
            )}

            {decisionStatus === 'approved' && (
              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-1.5">Note <span className="text-gray-600">(optional)</span></label>
                <textarea
                  placeholder="Any additional notes…"
                  value={decisionNotes}
                  onChange={e => setDecisionNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>
            )}

            {decisionError && (
              <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400 mb-4">{decisionError}</div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setDeciding(null)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={submitDecision}
                disabled={decisioning}
                className={`flex-1 py-3 rounded-xl disabled:opacity-50 text-white font-semibold text-sm transition-colors ${
                  decisionStatus === 'approved' ? 'bg-green-600 hover:bg-green-500' : 'bg-red-700 hover:bg-red-600'
                }`}
              >
                {decisioning ? 'Saving…' : decisionStatus === 'approved' ? 'Approve' : 'Deny'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
