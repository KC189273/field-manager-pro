'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface SupplyRequest {
  id: string
  employee_id: string
  employee_name: string
  manager_id: string | null
  manager_name: string | null
  store_location_id: string | null
  store_address: string | null
  item_name: string
  quantity: string
  category: string | null
  notes: string | null
  urgency: 1 | 2 | 3
  status: 'pending' | 'ordered' | 'received'
  ordered_at: string | null
  ordered_by_name: string | null
  ordered_note: string | null
  received_at: string | null
  received_by_name: string | null
  order_escalated_at: string | null
  receipt_escalated_at: string | null
  created_at: string
}

interface Store { id: string; address: string }
interface Manager { id: string; full_name: string }

const URGENCY_HOURS: Record<number, number> = { 1: 24, 2: 72, 3: 168 }
const URGENCY_LABEL: Record<number, string> = { 1: 'Level 1', 2: 'Level 2', 3: 'Level 3' }
const URGENCY_DESC:  Record<number, string> = { 1: 'Need within 24 hours', 2: 'Need within 72 hours', 3: 'Need within 1 week' }
const URGENCY_COLOR: Record<number, string> = {
  1: 'text-red-400 bg-red-900/30 border-red-800/50',
  2: 'text-orange-400 bg-orange-900/30 border-orange-800/50',
  3: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/50',
}
const URGENCY_BAR: Record<number, string> = { 1: 'bg-red-500', 2: 'bg-orange-500', 3: 'bg-yellow-500' }

const CATEGORIES = ['Cleaning Supplies', 'Product / Inventory', 'Equipment', 'Office / Admin', 'Other']

const STATUS_COLOR: Record<string, string> = {
  pending:  'text-orange-400 bg-orange-900/30 border-orange-800/50',
  ordered:  'text-blue-400 bg-blue-900/30 border-blue-800/50',
  received: 'text-green-400 bg-green-900/30 border-green-800/50',
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])
  return now
}

function Countdown({ startIso, urgency, now }: { startIso: string; urgency: number; now: number }) {
  const windowMs = URGENCY_HOURS[urgency] * 3600000
  const deadline  = new Date(startIso).getTime() + windowMs
  const remaining = deadline - now
  const isOverdue = remaining <= 0
  const pct = Math.min(100, Math.max(0, (1 - remaining / windowMs) * 100))

  let label: string
  if (isOverdue) {
    const over = Math.abs(remaining)
    const h = Math.floor(over / 3600000)
    const m = Math.floor((over % 3600000) / 60000)
    label = h > 0 ? `${h}h ${m}m overdue` : `${m}m overdue`
  } else {
    const h = Math.floor(remaining / 3600000)
    const m = Math.floor((remaining % 3600000) / 60000)
    label = h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[10px] font-semibold ${isOverdue ? 'text-red-400' : 'text-gray-400'}`}>{label}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isOverdue ? 'bg-red-500' : URGENCY_BAR[urgency]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function RequestCard({
  req, session, now, onOrdered, onReceived,
}: {
  req: SupplyRequest
  session: Session
  now: number
  onOrdered?: (r: SupplyRequest) => void
  onReceived?: (id: string) => void
}) {
  const canMarkOrdered  = (session.role === 'manager' && req.manager_id === session.id) ||
    ['ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)
  const canMarkReceived = req.employee_id === session.id ||
    ['manager', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)

  return (
    <div className={`bg-gray-900 border rounded-2xl p-4 ${req.order_escalated_at || req.receipt_escalated_at ? 'border-red-800/60' : 'border-gray-800'}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{req.item_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Qty: {req.quantity}
            {req.category ? ` · ${req.category}` : ''}
            {req.store_address ? ` · ${req.store_address}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${URGENCY_COLOR[req.urgency]}`}>
            {URGENCY_LABEL[req.urgency]}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${STATUS_COLOR[req.status]}`}>
            {req.status}
          </span>
        </div>
      </div>

      {/* Employee / DM name (for managers / ops+) */}
      {session.role !== 'employee' && (
        <p className="text-xs text-violet-400 mb-1">{req.employee_name}
          {req.manager_name ? <span className="text-gray-600"> · DM: {req.manager_name}</span> : null}
        </p>
      )}

      {req.notes && <p className="text-xs text-gray-500 mb-2 italic">"{req.notes}"</p>}

      {/* Timestamps */}
      <div className="text-[10px] text-gray-600 space-y-0.5 mb-2">
        <p>Submitted: {fmtTs(req.created_at)}</p>
        {req.ordered_at && <p>Ordered: {fmtTs(req.ordered_at)} by {req.ordered_by_name}</p>}
        {req.ordered_note && <p className="text-gray-500 italic">"{req.ordered_note}"</p>}
        {req.received_at && <p>Received: {fmtTs(req.received_at)} by {req.received_by_name}</p>}
      </div>

      {/* Escalation badge */}
      {(req.order_escalated_at || req.receipt_escalated_at) && (
        <div className="mb-2 text-[10px] text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-1.5 font-semibold">
          Escalated to Sales Director
          {req.order_escalated_at ? ` — ${fmtTs(req.order_escalated_at)}` : ''}
          {req.receipt_escalated_at ? ` — ${fmtTs(req.receipt_escalated_at)}` : ''}
        </div>
      )}

      {/* Countdown — only on active requests */}
      {req.status === 'pending' && (
        <Countdown startIso={req.created_at} urgency={req.urgency} now={now} />
      )}
      {req.status === 'ordered' && req.ordered_at && (
        <Countdown startIso={req.ordered_at} urgency={req.urgency} now={now} />
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-3">
        {req.status === 'pending' && canMarkOrdered && onOrdered && (
          <button
            onClick={() => onOrdered(req)}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-2 rounded-xl transition-colors"
          >
            Mark Ordered
          </button>
        )}
        {req.status === 'ordered' && canMarkReceived && onReceived && (
          <button
            onClick={() => onReceived(req.id)}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold py-2 rounded-xl transition-colors"
          >
            Mark Received
          </button>
        )}
      </div>
    </div>
  )
}

export default function SupplyRequestsPage() {
  const [session, setSession]     = useState<Session | null>(null)
  const [requests, setRequests]   = useState<SupplyRequest[]>([])
  const [stores, setStores]       = useState<Store[]>([])
  const [managers, setManagers]   = useState<Manager[]>([])
  const [allStores, setAllStores] = useState<Store[]>([])
  const [loading, setLoading]     = useState(true)
  const now = useNow()

  // Tabs for ops+: 'active' | 'history'
  const [opsTab, setOpsTab] = useState<'active' | 'history'>('active')

  // Ops filters
  const [filterMgr,   setFilterMgr]   = useState('')
  const [filterStore, setFilterStore] = useState('')

  // History filters
  const [histFrom, setHistFrom]   = useState('')
  const [histTo,   setHistTo]     = useState('')
  const [histMgr,  setHistMgr]    = useState('')
  const [histStore, setHistStore] = useState('')
  const [histData, setHistData]   = useState<SupplyRequest[]>([])
  const [histLoading, setHistLoading] = useState(false)

  // Submit modal
  const [showSubmit, setShowSubmit] = useState(false)
  const [form, setForm] = useState({ itemName: '', quantity: '1', category: '', notes: '', urgency: 2, storeLocationId: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Mark ordered modal
  const [orderingReq, setOrderingReq] = useState<SupplyRequest | null>(null)
  const [orderNote, setOrderNote] = useState('')
  const [orderSaving, setOrderSaving] = useState(false)

  // Receiving
  const [receivingId, setReceivingId] = useState<string | null>(null)

  const isOpsPlus = (role: string) => ['ops_manager', 'owner', 'sales_director', 'developer'].includes(role)

  const loadRequests = useCallback(async () => {
    if (!session) return
    setLoading(true)
    const params = new URLSearchParams()
    if (isOpsPlus(session.role)) {
      if (filterMgr)   params.set('managerId', filterMgr)
      if (filterStore) params.set('storeId', filterStore)
    }
    const res = await fetch(`/api/supply-requests?${params}`)
    if (res.ok) {
      const d = await res.json()
      setRequests(d.requests ?? [])
      if (d.stores)    setStores(d.stores)
      if (d.managers)  setManagers(d.managers)
      if (d.allStores) setAllStores(d.allStores)
    }
    setLoading(false)
  }, [session, filterMgr, filterStore])

  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(setSession) }, [])
  useEffect(() => { if (session) loadRequests() }, [session, loadRequests])

  async function loadHistory() {
    setHistLoading(true)
    const params = new URLSearchParams({ history: 'true' })
    if (histFrom)  params.set('from', histFrom)
    if (histTo)    params.set('to', histTo)
    if (histMgr)   params.set('managerId', histMgr)
    if (histStore) params.set('storeId', histStore)
    const res = await fetch(`/api/supply-requests?${params}`)
    if (res.ok) {
      const d = await res.json()
      setHistData(d.requests ?? [])
    }
    setHistLoading(false)
  }

  async function submitRequest() {
    setSubmitError('')
    if (!form.itemName.trim()) { setSubmitError('Item name is required.'); return }
    setSubmitting(true)
    const res = await fetch('/api/supply-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemName: form.itemName,
        quantity: form.quantity,
        category: form.category || null,
        notes: form.notes || null,
        urgency: form.urgency,
        storeLocationId: form.storeLocationId || null,
      }),
    })
    setSubmitting(false)
    if (res.ok) {
      setShowSubmit(false)
      setForm({ itemName: '', quantity: '1', category: '', notes: '', urgency: 2, storeLocationId: '' })
      await loadRequests()
    } else {
      const d = await res.json().catch(() => ({}))
      setSubmitError(d.error ?? 'Failed to submit request.')
    }
  }

  async function markOrdered() {
    if (!orderingReq) return
    setOrderSaving(true)
    const res = await fetch('/api/supply-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: orderingReq.id, action: 'ordered', note: orderNote }),
    })
    setOrderSaving(false)
    if (res.ok) {
      setOrderingReq(null)
      setOrderNote('')
      await loadRequests()
    }
  }

  async function markReceived(id: string) {
    setReceivingId(id)
    await fetch('/api/supply-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'received' }),
    })
    setReceivingId(null)
    await loadRequests()
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  // ── Summary stats for ops+ ──
  const pending  = requests.filter(r => r.status === 'pending')
  const ordered  = requests.filter(r => r.status === 'ordered')
  const overdue  = requests.filter(r => r.order_escalated_at || r.receipt_escalated_at)
  const lvl1     = requests.filter(r => r.urgency === 1)
  const lvl2     = requests.filter(r => r.urgency === 2)
  const lvl3     = requests.filter(r => r.urgency === 3)

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-2xl mx-auto">

        {/* ──────────────────────────────────────── EMPLOYEE VIEW ── */}
        {session.role === 'employee' && (
          <>
            <div className="flex items-center justify-between mb-5">
              <h1 className="text-xl font-bold text-white">Supply Requests</h1>
              <button
                onClick={() => { setShowSubmit(true); setSubmitError('') }}
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                + New Request
              </button>
            </div>

            {loading ? (
              <div className="text-center text-gray-500 py-16">Loading…</div>
            ) : requests.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-sm">No supply requests yet</p>
                <p className="text-gray-700 text-xs mt-1">Tap "+ New Request" to submit one</p>
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map(r => (
                  <RequestCard
                    key={r.id} req={r} session={session} now={now}
                    onReceived={receivingId ? undefined : markReceived}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ──────────────────────────────────────── MANAGER (DM) VIEW ── */}
        {session.role === 'manager' && (
          <>
            <div className="flex items-center justify-between mb-5">
              <h1 className="text-xl font-bold text-white">Supply Requests</h1>
              <button
                onClick={() => { setShowSubmit(true); setSubmitError('') }}
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                + New Request
              </button>
            </div>

            {/* Summary pills */}
            <div className="flex gap-2 mb-5 flex-wrap">
              <div className="flex-1 min-w-[80px] bg-orange-900/20 border border-orange-800/40 rounded-xl px-3 py-2 text-center">
                <p className="text-xl font-bold text-orange-400">{pending.length}</p>
                <p className="text-[10px] text-orange-600">Needs Ordering</p>
              </div>
              <div className="flex-1 min-w-[80px] bg-blue-900/20 border border-blue-800/40 rounded-xl px-3 py-2 text-center">
                <p className="text-xl font-bold text-blue-400">{ordered.length}</p>
                <p className="text-[10px] text-blue-600">Awaiting Receipt</p>
              </div>
              <div className="flex-1 min-w-[80px] bg-red-900/20 border border-red-800/40 rounded-xl px-3 py-2 text-center">
                <p className="text-xl font-bold text-red-400">{overdue.length}</p>
                <p className="text-[10px] text-red-600">Escalated</p>
              </div>
            </div>

            {loading ? (
              <div className="text-center text-gray-500 py-16">Loading…</div>
            ) : requests.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-sm">No open supply requests</p>
              </div>
            ) : (
              <div className="space-y-5">
                {pending.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Needs Ordering — {pending.length}</p>
                    <div className="space-y-3">
                      {pending.map(r => (
                        <RequestCard
                          key={r.id} req={r} session={session} now={now}
                          onOrdered={req => { setOrderingReq(req); setOrderNote('') }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {ordered.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Awaiting Receipt — {ordered.length}</p>
                    <div className="space-y-3">
                      {ordered.map(r => (
                        <RequestCard key={r.id} req={r} session={session} now={now} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ──────────────────────────────────────── OPS+ VIEW ── */}
        {isOpsPlus(session.role) && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-bold text-white">Supply Requests</h1>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-gray-800 mb-5">
              {(['active', 'history'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setOpsTab(tab)}
                  className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
                    opsTab === tab
                      ? 'border-violet-500 text-violet-400'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {tab === 'active' ? 'Active Requests' : 'History'}
                </button>
              ))}
            </div>

            {/* ── Active tab ── */}
            {opsTab === 'active' && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-white">{requests.length}</p>
                    <p className="text-[10px] text-gray-500">Total Open</p>
                  </div>
                  <div className="bg-orange-900/20 border border-orange-800/40 rounded-xl px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-orange-400">{pending.length}</p>
                    <p className="text-[10px] text-orange-600">Needs Ordering</p>
                  </div>
                  <div className="bg-red-900/20 border border-red-800/40 rounded-xl px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-red-400">{overdue.length}</p>
                    <p className="text-[10px] text-red-600">Escalated</p>
                  </div>
                </div>

                {/* Urgency breakdown */}
                <div className="flex gap-2 mb-4">
                  {[1, 2, 3].map(lvl => {
                    const count = requests.filter(r => r.urgency === lvl).length
                    return (
                      <div key={lvl} className={`flex-1 rounded-xl px-3 py-2 text-center border ${URGENCY_COLOR[lvl]}`}>
                        <p className="text-lg font-bold">{count}</p>
                        <p className="text-[10px] font-semibold">{URGENCY_LABEL[lvl]}</p>
                      </div>
                    )
                  })}
                </div>

                {/* Filters */}
                <div className="flex gap-2 mb-4">
                  <select
                    value={filterMgr}
                    onChange={e => setFilterMgr(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="">All DMs</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                  <select
                    value={filterStore}
                    onChange={e => setFilterStore(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="">All Stores</option>
                    {allStores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
                  </select>
                </div>

                {loading ? (
                  <div className="text-center text-gray-500 py-16">Loading…</div>
                ) : requests.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-gray-500 text-sm">No open supply requests</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {requests.map(r => (
                      <RequestCard
                        key={r.id} req={r} session={session} now={now}
                        onOrdered={req => { setOrderingReq(req); setOrderNote('') }}
                        onReceived={markReceived}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── History tab ── */}
            {opsTab === 'history' && (
              <>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">From</label>
                      <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">To</label>
                      <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <select value={histMgr} onChange={e => setHistMgr(e.target.value)}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500">
                      <option value="">All DMs</option>
                      {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                    <select value={histStore} onChange={e => setHistStore(e.target.value)}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500">
                      <option value="">All Stores</option>
                      {allStores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
                    </select>
                  </div>
                  <button
                    onClick={loadHistory}
                    disabled={histLoading}
                    className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                  >
                    {histLoading ? 'Loading…' : 'Search History'}
                  </button>
                </div>

                {histData.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-600 text-sm">Set filters above and tap Search</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{histData.length} completed request{histData.length !== 1 ? 's' : ''}</p>
                    {histData.map(r => (
                      <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <p className="text-white font-semibold text-sm">{r.item_name}</p>
                            <p className="text-xs text-gray-500">Qty: {r.quantity}{r.category ? ` · ${r.category}` : ''}</p>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${URGENCY_COLOR[r.urgency]}`}>
                            {URGENCY_LABEL[r.urgency]}
                          </span>
                        </div>
                        <p className="text-xs text-violet-400 mb-2">{r.employee_name}
                          {r.manager_name ? <span className="text-gray-600"> · DM: {r.manager_name}</span> : null}
                          {r.store_address ? <span className="text-gray-600"> · {r.store_address}</span> : null}
                        </p>
                        {r.notes && <p className="text-xs text-gray-600 italic mb-2">"{r.notes}"</p>}
                        <div className="bg-gray-800/60 rounded-xl px-3 py-2 text-[10px] text-gray-500 space-y-1">
                          <div className="flex justify-between">
                            <span>Submitted</span>
                            <span className="text-gray-400">{fmtTs(r.created_at)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Ordered</span>
                            <span className="text-gray-400">{r.ordered_at ? fmtTs(r.ordered_at) : '—'}</span>
                          </div>
                          {r.ordered_note && (
                            <div className="text-gray-600 italic pt-0.5">"{r.ordered_note}"</div>
                          )}
                          <div className="flex justify-between">
                            <span>Received</span>
                            <span className="text-gray-400">{r.received_at ? fmtTs(r.received_at) : '—'}</span>
                          </div>
                          {(r.order_escalated_at || r.receipt_escalated_at) && (
                            <div className="flex justify-between text-red-500">
                              <span>Escalated</span>
                              <span>{fmtTs(r.order_escalated_at || r.receipt_escalated_at)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Submit modal (employees) ── */}
      {showSubmit && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setShowSubmit(false)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-5">New Supply Request</h2>
            <div className="space-y-4">

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Item Name</label>
                <input type="text" placeholder="e.g. Glass cleaner, receipt paper…"
                  value={form.itemName} onChange={e => setForm(f => ({ ...f, itemName: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Quantity</label>
                  <input type="text" placeholder="e.g. 2 boxes"
                    value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="">Select…</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {stores.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Store Location</label>
                  <select value={form.storeLocationId} onChange={e => setForm(f => ({ ...f, storeLocationId: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="">Select store…</option>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-2">Urgency Level</label>
                <div className="space-y-2">
                  {([1, 2, 3] as const).map(lvl => (
                    <button key={lvl} type="button"
                      onClick={() => setForm(f => ({ ...f, urgency: lvl }))}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                        form.urgency === lvl
                          ? URGENCY_COLOR[lvl]
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <p className="text-sm font-semibold">{URGENCY_LABEL[lvl]}</p>
                      <p className="text-xs opacity-70 mt-0.5">{URGENCY_DESC[lvl]}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Notes (optional)</label>
                <textarea rows={3} placeholder="Any additional details…"
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none" />
              </div>

              {submitError && (
                <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-400">{submitError}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowSubmit(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button onClick={submitRequest} disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark Ordered modal ── */}
      {orderingReq && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setOrderingReq(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">Mark as Ordered</h2>
            <p className="text-sm text-gray-400 mb-5">"{orderingReq.item_name}" for {orderingReq.employee_name}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Order Details <span className="text-gray-600">(where ordered, estimated arrival)</span>
                </label>
                <textarea rows={4}
                  placeholder="e.g. Ordered from Amazon — arrives Thursday. Order #112-3456789."
                  value={orderNote} onChange={e => setOrderNote(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setOrderingReq(null)}
                  className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button onClick={markOrdered} disabled={orderSaving}
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
                  {orderSaving ? 'Saving…' : 'Confirm Ordered'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
