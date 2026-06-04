'use client'

import { useEffect, useRef, useState } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface Ticket {
  id: string
  store_address: string | null
  category: string
  custom_category: string | null
  title: string
  description: string | null
  urgency: string
  photo_key: string | null
  photo_url: string | null
  status: string
  submitted_by: string | null
  submitted_by_name: string
  submitted_by_avatar_url?: string | null
  created_at: string
  updated_at: string
}

interface TicketUpdate {
  id: string
  updated_by_name: string
  status: string
  note: string | null
  created_at: string
}

interface Store { id: string; address: string }

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-500/15 text-blue-400',
  in_progress: 'bg-amber-500/15 text-amber-400',
  resolved: 'bg-emerald-500/15 text-emerald-400',
  closed: 'bg-gray-500/15 text-gray-400',
}

const canManage = (role: string) =>
  ['manager', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(role)

export default function FacilitiesPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'open' | 'in_progress' | 'resolved' | 'closed'>('open')

  // New request form
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    storeId: '', category: '', customCategory: '',
    title: '', description: '', urgency: 'normal',
  })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Detail view
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [ticketUpdates, setTicketUpdates] = useState<TicketUpdate[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [updateForm, setUpdateForm] = useState({ status: 'in_progress', note: '' })
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  useEffect(() => {
    if (!session) return
    loadTickets()
  }, [session, tab])

  async function loadTickets() {
    setLoading(true)
    try {
      const r = await fetch(`/api/facility-tickets?status=${tab}`)
      const d = await r.json()
      setTickets(d.tickets ?? [])
      setStores(d.stores ?? [])
      setCategories(d.categories ?? [])
    } catch {
      setTickets([])
    } finally {
      setLoading(false)
    }
  }

  async function openDetail(ticket: Ticket) {
    setSelectedTicket(ticket)
    setDetailLoading(true)
    setUpdateForm({ status: 'in_progress', note: '' })
    const r = await fetch(`/api/facility-tickets/${ticket.id}`)
    const d = await r.json()
    if (d.ticket) setSelectedTicket(prev => ({ ...prev!, ...d.ticket }))
    setTicketUpdates(d.updates ?? [])
    setDetailLoading(false)
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function submitTicket() {
    if (!form.storeId) return alert('Please select a store.')
    if (!form.category) return alert('Please select a category.')
    if (!form.title.trim()) return alert('Please enter a title.')
    if (form.category === 'Other' && !form.customCategory.trim()) return alert('Please describe the category.')
    if (!photoFile) return alert('A photo is required.')

    setSubmitting(true)
    try {
      // Upload photo
      const urlRes = await fetch('/api/facility-tickets/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: photoFile.name, contentType: photoFile.type }),
      })
      const { url, key } = await urlRes.json()
      await fetch(url, { method: 'PUT', body: photoFile, headers: { 'Content-Type': photoFile.type } })

      const res = await fetch('/api/facility-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, photoKey: key }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error ?? 'Failed to submit.')
        return
      }

      setShowForm(false)
      setForm({ storeId: '', category: '', customCategory: '', title: '', description: '', urgency: 'normal' })
      setPhotoFile(null)
      setPhotoPreview(null)
      setTab('open')
      await loadTickets()
    } finally {
      setSubmitting(false)
    }
  }

  async function submitUpdate(overrideStatus?: string) {
    if (!selectedTicket) return
    setUpdating(true)
    try {
      const res = await fetch(`/api/facility-tickets/${selectedTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: overrideStatus ?? updateForm.status, note: updateForm.note }),
      })
      if (!res.ok) { alert('Failed to update.'); return }
      setSelectedTicket(null)
      await loadTickets()
    } finally {
      setUpdating(false)
    }
  }

  if (!session) return null

  const filteredTickets = tickets.filter(t => t.status === tab)

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-10">
      <NavBar role={session.role} fullName={session.fullName} />
      <div className="pt-14 px-4 max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between pt-5 pb-4">
          <h1 className="text-xl font-bold">Facilities Requests</h1>
          <button
            onClick={() => setShowForm(true)}
            className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            + New Request
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {(['open', 'in_progress', 'resolved', 'closed'] as const).map(s => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === s ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Ticket list */}
        {loading ? (
          <div className="text-center text-gray-500 py-16 text-sm">Loading...</div>
        ) : filteredTickets.length === 0 ? (
          <div className="text-center text-gray-500 py-16 text-sm">No {STATUS_LABELS[tab].toLowerCase()} requests.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredTickets.map(ticket => (
              <button
                key={ticket.id}
                onClick={() => openDetail(ticket)}
                className="w-full text-left bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-semibold text-white text-sm leading-tight">{ticket.title}</span>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {ticket.urgency === 'urgent' && (
                      <span className="text-xs font-bold bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full">Urgent</span>
                    )}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[ticket.status]}`}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-violet-400 font-medium mb-1">
                  {ticket.category === 'Other' && ticket.custom_category ? ticket.custom_category : ticket.category}
                </p>
                {ticket.store_address && (
                  <p className="text-xs text-gray-500 mb-1">{ticket.store_address}</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5">
                    {ticket.submitted_by_avatar_url
                      ? <img src={ticket.submitted_by_avatar_url} alt={ticket.submitted_by_name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                      : <div className="w-5 h-5 rounded-full bg-violet-800 flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">{ticket.submitted_by_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
                    }
                    <span className="text-xs text-gray-600">{ticket.submitted_by_name}</span>
                  </div>
                  <span className="text-xs text-gray-600">
                    {new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── New Request Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setShowForm(false)}>
          <div
            className="bg-gray-900 rounded-t-2xl max-h-[92vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="font-bold text-white">New Facility Request</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Store */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Store Location</label>
                <select
                  value={form.storeId}
                  onChange={e => setForm(f => ({ ...f, storeId: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500"
                >
                  <option value="">Select a store...</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
                </select>
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Category</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value, customCategory: '' }))}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500"
                >
                  <option value="">Select a category...</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Custom category */}
              {form.category === 'Other' && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Describe Category</label>
                  <input
                    type="text"
                    value={form.customCategory}
                    onChange={e => setForm(f => ({ ...f, customCategory: e.target.value }))}
                    placeholder="e.g. Parking lot lights"
                    className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500 placeholder-gray-600"
                  />
                </div>
              )}

              {/* Title */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Issue Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. A/C unit not cooling"
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500 placeholder-gray-600"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Details <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Describe the issue in more detail..."
                  className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500 placeholder-gray-600 resize-none"
                />
              </div>

              {/* Urgency */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Urgency</label>
                <div className="flex gap-2">
                  {(['normal', 'urgent'] as const).map(u => (
                    <button
                      key={u}
                      onClick={() => setForm(f => ({ ...f, urgency: u }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors border ${
                        form.urgency === u
                          ? u === 'urgent'
                            ? 'bg-red-600/20 border-red-500 text-red-400'
                            : 'bg-violet-600/20 border-violet-500 text-violet-400'
                          : 'bg-gray-800 border-gray-700 text-gray-400'
                      }`}
                    >
                      {u === 'urgent' ? 'Urgent' : 'Normal'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photo */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Photo <span className="text-red-400">*</span></label>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoChange} />
                {photoPreview ? (
                  <div className="relative">
                    <img src={photoPreview} alt="Preview" className="w-full h-48 object-cover rounded-xl" />
                    <button
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null) }}
                      className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full h-32 border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center gap-2 text-gray-500 hover:border-violet-500 hover:text-violet-400 transition-colors"
                  >
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm">Tap to take or upload a photo</span>
                  </button>
                )}
              </div>

            </div>
            <div className="px-5 pb-6 pt-3 border-t border-gray-800">
              <button
                onClick={submitTicket}
                disabled={submitting}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Ticket Detail Modal ── */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setSelectedTicket(null)}>
          <div
            className="bg-gray-900 rounded-t-2xl max-h-[92vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[selectedTicket.status]}`}>
                  {STATUS_LABELS[selectedTicket.status]}
                </span>
                {selectedTicket.urgency === 'urgent' && (
                  <span className="text-xs font-bold bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full">Urgent</span>
                )}
              </div>
              <button onClick={() => setSelectedTicket(null)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white">{selectedTicket.title}</h2>
                <p className="text-sm text-violet-400 font-medium mt-0.5">
                  {selectedTicket.category === 'Other' && selectedTicket.custom_category
                    ? selectedTicket.custom_category
                    : selectedTicket.category}
                </p>
                {selectedTicket.store_address && (
                  <p className="text-sm text-gray-400 mt-0.5">{selectedTicket.store_address}</p>
                )}
              </div>

              {selectedTicket.description && (
                <p className="text-sm text-gray-300 bg-gray-800 rounded-xl p-3">{selectedTicket.description}</p>
              )}

              {selectedTicket.photo_url && (
                <img
                  src={selectedTicket.photo_url}
                  alt="Issue photo"
                  className="w-full rounded-xl object-cover max-h-64"
                />
              )}

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Submitted by {selectedTicket.submitted_by_name}</span>
                <span>{new Date(selectedTicket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>

              {/* Timeline */}
              {detailLoading ? (
                <p className="text-xs text-gray-600 text-center py-2">Loading...</p>
              ) : ticketUpdates.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Activity</p>
                  <div className="space-y-3">
                    {ticketUpdates.map((u, i) => (
                      <div key={u.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${
                            u.status === 'open' ? 'bg-blue-500'
                            : u.status === 'in_progress' ? 'bg-amber-500'
                            : u.status === 'closed' ? 'bg-gray-500'
                            : 'bg-emerald-500'
                          }`} />
                          {i < ticketUpdates.length - 1 && (
                            <div className="w-px flex-1 bg-gray-800 mt-1" />
                          )}
                        </div>
                        <div className="pb-3 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-white">{STATUS_LABELS[u.status]}</span>
                            <span className="text-xs text-gray-500">
                              {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {' '}by {u.updated_by_name}
                            </span>
                          </div>
                          {u.note && <p className="text-sm text-gray-400 mt-0.5">{u.note}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Update form for ops+ */}
              {canManage(session.role) && selectedTicket.status !== 'resolved' && selectedTicket.status !== 'closed' ? (
                <div className="border-t border-gray-800 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Update Status</p>
                  <div className="flex gap-2">
                    {(['in_progress', 'resolved', 'closed'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => setUpdateForm(f => ({ ...f, status: s }))}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors border ${
                          updateForm.status === s
                            ? s === 'resolved'
                              ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400'
                              : s === 'closed'
                              ? 'bg-gray-600/20 border-gray-500 text-gray-300'
                              : 'bg-amber-600/20 border-amber-500 text-amber-400'
                            : 'bg-gray-800 border-gray-700 text-gray-400'
                        }`}
                      >
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={updateForm.note}
                    onChange={e => setUpdateForm(f => ({ ...f, note: e.target.value }))}
                    rows={2}
                    placeholder="Add a note (optional)..."
                    className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500 placeholder-gray-600 resize-none"
                  />
                  <button
                    onClick={() => submitUpdate()}
                    disabled={updating}
                    className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-3 rounded-2xl transition-colors"
                  >
                    {updating ? 'Saving...' : 'Save Update'}
                  </button>
                </div>
              ) : canManage(session.role) && selectedTicket.status === 'closed' ? (
                <div className="border-t border-gray-800 pt-4">
                  <button
                    onClick={() => submitUpdate('open')}
                    disabled={updating}
                    className="w-full bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500 disabled:opacity-50 text-blue-400 font-bold py-3 rounded-2xl transition-colors text-sm"
                  >
                    {updating ? 'Reopening...' : 'Reopen Ticket'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
