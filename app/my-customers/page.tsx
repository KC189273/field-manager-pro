'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

interface Customer {
  id: string; user_id: string; full_name: string; phone: string | null; email: string
  visit_count: number; last_visit: string | null; notes_count: number
}

interface Note { id: string; note: string; created_at: string }
interface VisitHistory { appointment_date: string; service_names: string; status: string }

export default function MyCustomersPage() {
  const router = useRouter()
  const [session, setSession] = useState<{ id: string; fullName: string; role: string } | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Detail view
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [history, setHistory] = useState<VisitHistory[]>([])
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d) return
      if (!['barber', 'shop_owner', 'developer'].includes(d.role)) { router.replace('/dashboard'); return }
      setSession(d)
    })
  }, [router])

  const loadCustomers = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/barbershop/customers')
    if (res.ok) {
      const d = await res.json()
      setCustomers(d.customers ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { if (session) loadCustomers() }, [session, loadCustomers])

  async function openCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setDetailLoading(true)
    setNewNote('')
    const res = await fetch(`/api/barbershop/customers/${customer.id}/notes`)
    if (res.ok) {
      const d = await res.json()
      setNotes(d.notes ?? [])
      setHistory(d.history ?? [])
    }
    setDetailLoading(false)
  }

  async function addNote() {
    if (!newNote.trim() || !selectedCustomer) return
    setSavingNote(true)
    await fetch(`/api/barbershop/customers/${selectedCustomer.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: newNote }),
    })
    setNewNote('')
    // Refresh notes
    const res = await fetch(`/api/barbershop/customers/${selectedCustomer.id}/notes`)
    if (res.ok) {
      const d = await res.json()
      setNotes(d.notes ?? [])
    }
    setSavingNote(false)
    await loadCustomers()
  }

  if (!session) return null

  const filtered = search.trim()
    ? customers.filter(c => c.full_name.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search) || c.email.toLowerCase().includes(search.toLowerCase()))
    : customers

  return (
    <div className="min-h-screen bg-black pb-20 pt-14">
      <NavBar role={session.role as 'barber'} fullName={session.fullName} />

      <div className="max-w-2xl mx-auto px-4 py-4">
        <h1 className="text-xl font-bold text-white mb-4">My Customers <span className="text-blue-400">({customers.length})</span></h1>

        {/* Search */}
        <div className="relative mb-4">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Search by name, phone, or email..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500" />
        </div>

        {loading ? (
          <div className="text-center text-zinc-500 py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-zinc-600 py-12 text-sm">{search ? 'No results' : 'No customers yet'}</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(customer => (
              <button key={customer.id} onClick={() => openCustomer(customer)}
                className="w-full bg-zinc-900 border border-blue-500/15 rounded-xl px-4 py-3 text-left hover:border-blue-500/40 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{customer.full_name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {customer.phone && <span className="text-xs text-zinc-500">{customer.phone}</span>}
                      <span className="text-xs text-zinc-600">{customer.email}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-blue-400">{customer.visit_count}</p>
                    <p className="text-[10px] text-zinc-600">visit{customer.visit_count !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                {customer.last_visit && (
                  <p className="text-[10px] text-zinc-600 mt-1">Last: {new Date(customer.last_visit + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Customer Detail Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center" onClick={() => setSelectedCustomer(null)}>
          <div className="bg-zinc-900 border border-blue-500/30 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-blue-400">{selectedCustomer.full_name}</h2>
                <div className="flex items-center gap-3 mt-0.5">
                  {selectedCustomer.phone && <span className="text-xs text-zinc-400">{selectedCustomer.phone}</span>}
                  <span className="text-xs text-zinc-500">{selectedCustomer.email}</span>
                </div>
              </div>
              <button onClick={() => setSelectedCustomer(null)} className="text-zinc-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex items-center gap-4 mb-4">
              <div className="bg-zinc-800 rounded-xl px-4 py-2 text-center flex-1">
                <p className="text-lg font-bold text-blue-400">{selectedCustomer.visit_count}</p>
                <p className="text-[10px] text-zinc-500">Total Visits</p>
              </div>
              <div className="bg-zinc-800 rounded-xl px-4 py-2 text-center flex-1">
                <p className="text-lg font-bold text-white">{selectedCustomer.notes_count}</p>
                <p className="text-[10px] text-zinc-500">Notes</p>
              </div>
            </div>

            {detailLoading ? (
              <p className="text-zinc-500 text-center py-4">Loading...</p>
            ) : (
              <>
                {/* Add Note */}
                <div className="mb-4">
                  <p className="text-xs text-blue-400 uppercase tracking-wide font-semibold mb-2">Add a Note</p>
                  <div className="flex gap-2">
                    <input value={newNote} onChange={e => setNewNote(e.target.value)}
                      placeholder="e.g. Prefers a low fade, talks about Bears football"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={e => { if (e.key === 'Enter') addNote() }} />
                    <button onClick={addNote} disabled={savingNote || !newNote.trim()}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm shrink-0">
                      {savingNote ? '...' : 'Add'}
                    </button>
                  </div>
                </div>

                {/* Notes */}
                {notes.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-blue-400 uppercase tracking-wide font-semibold mb-2">Notes</p>
                    <div className="space-y-2">
                      {notes.map(n => (
                        <div key={n.id} className="bg-zinc-800 rounded-lg px-3 py-2">
                          <p className="text-sm text-zinc-300">{n.note}</p>
                          <p className="text-[10px] text-zinc-600 mt-1">
                            {new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Visit History */}
                {history.length > 0 && (
                  <div>
                    <p className="text-xs text-blue-400 uppercase tracking-wide font-semibold mb-2">Visit History</p>
                    <div className="space-y-1">
                      {history.map((v, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 rounded-lg">
                          <div>
                            <p className="text-sm text-zinc-300">{v.service_names}</p>
                            <p className="text-[10px] text-zinc-600">
                              {new Date(v.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                          </div>
                          <span className={`text-[10px] font-bold ${v.status === 'completed' ? 'text-blue-400' : 'text-zinc-600'}`}>
                            {v.status === 'completed' ? 'Completed' : v.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
