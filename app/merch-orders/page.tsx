'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface MerchOrder {
  id: string
  requester_id: string
  requester_name: string
  requester_avatar_url?: string | null
  requester_role: string
  manager_id: string | null
  manager_name: string | null
  ops_manager_id: string
  ops_manager_name: string | null
  store_location_id: string | null
  store_address: string | null
  notes: string
  photos: string[] | null
  status: 'pending' | 'ordered'
  ordered_at: string | null
  ordered_by_name: string | null
  ordered_note: string | null
  created_at: string
}

interface Store    { id: string; address: string }
interface OpsMgr   { id: string; full_name: string }
interface Manager  { id: string; full_name: string }

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-orange-400 bg-orange-900/30 border-orange-800/50',
  ordered: 'text-blue-400 bg-blue-900/30 border-blue-800/50',
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function PhotoGrid({ keys }: { keys: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    keys.forEach(async key => {
      const res = await fetch(`/api/merch-orders/photo-url?key=${encodeURIComponent(key)}`)
      if (res.ok) {
        const d = await res.json()
        setUrls(prev => ({ ...prev, [key]: d.url }))
      }
    })
  }, [keys.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex gap-2 flex-wrap mt-2">
      {keys.map(key => (
        <a key={key} href={urls[key] ?? '#'} target="_blank" rel="noopener noreferrer"
          className="w-16 h-16 rounded-lg bg-gray-800 overflow-hidden border border-gray-700 flex items-center justify-center shrink-0">
          {urls[key] ? (
            <img src={urls[key]} alt="Merch photo" className="w-full h-full object-cover" />
          ) : (
            <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
          )}
        </a>
      ))}
    </div>
  )
}

function OrderCard({
  order, session, onOrder,
}: {
  order: MerchOrder
  session: Session
  onOrder?: (o: MerchOrder) => void
}) {
  const canMarkOrdered = ['ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {order.requester_avatar_url
            ? <img src={order.requester_avatar_url} alt={order.requester_name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            : <div className="w-8 h-8 rounded-full bg-violet-800 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">{order.requester_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
          }
          <div className="min-w-0 flex-1">
          <p className="text-white font-semibold text-sm">
            {order.requester_name}
            {order.requester_role === 'manager' && (
              <span className="text-gray-500 text-xs font-normal"> (DM)</span>
            )}
          </p>
          {order.manager_name && order.requester_role === 'employee' && (
            <p className="text-xs text-gray-500">DM: {order.manager_name}</p>
          )}
          {order.store_address && (
            <p className="text-xs text-gray-500 mt-0.5">{order.store_address}</p>
          )}
          </div>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize shrink-0 ${STATUS_COLOR[order.status]}`}>
          {order.status}
        </span>
      </div>

      {/* Ops manager target */}
      <p className="text-[11px] text-violet-400 mb-2">→ {order.ops_manager_name ?? 'Ops Manager'}</p>

      {/* Notes */}
      <p className="text-xs text-gray-300 mb-2 leading-relaxed">{order.notes}</p>

      {/* Photos */}
      {order.photos && order.photos.length > 0 && (
        <PhotoGrid keys={order.photos} />
      )}

      {/* Timestamps */}
      <div className="text-[10px] text-gray-600 space-y-0.5 mt-3">
        <p>Submitted: {fmtTs(order.created_at)}</p>
        {order.ordered_at && (
          <p>Ordered: {fmtTs(order.ordered_at)} by {order.ordered_by_name}</p>
        )}
        {order.ordered_note && (
          <p className="text-gray-500 italic">"{order.ordered_note}"</p>
        )}
      </div>

      {/* Ordered confirmation banner for requester */}
      {order.status === 'ordered' && order.requester_id === session.id && (
        <div className="mt-3 bg-blue-900/20 border border-blue-800/40 rounded-xl px-3 py-2 text-xs text-blue-300">
          Your merch order has been placed — keep an eye out in the coming days!
        </div>
      )}

      {/* Mark ordered button */}
      {order.status === 'pending' && canMarkOrdered && onOrder && (
        <button
          onClick={() => onOrder(order)}
          className="mt-3 w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-2 rounded-xl transition-colors"
        >
          Mark Ordered
        </button>
      )}
    </div>
  )
}

export default function MerchOrdersPage() {
  const [session, setSession]     = useState<Session | null>(null)
  const [orders, setOrders]       = useState<MerchOrder[]>([])
  const [loading, setLoading]     = useState(true)
  const [opsMgrs, setOpsMgrs]     = useState<OpsMgr[]>([])
  const [stores, setStores]       = useState<Store[]>([])
  const [managers, setManagers]   = useState<Manager[]>([])
  const [allStores, setAllStores] = useState<Store[]>([])

  // Ops+ tabs + filters
  const [opsTab,      setOpsTab]      = useState<'active' | 'history'>('active')
  const [filterMgr,   setFilterMgr]   = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [histFrom,    setHistFrom]    = useState('')
  const [histTo,      setHistTo]      = useState('')
  const [histMgr,     setHistMgr]     = useState('')
  const [histStore,   setHistStore]   = useState('')
  const [histData,    setHistData]    = useState<MerchOrder[]>([])
  const [histLoading, setHistLoading] = useState(false)

  // Submit form
  const [showSubmit,  setShowSubmit]  = useState(false)
  const [form, setForm] = useState({ notes: '', opsManagerId: '', storeLocationId: '' })
  const [photoFiles,    setPhotoFiles]    = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [submitting,  setSubmitting]  = useState(false)
  const [submitError, setSubmitError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Mark ordered modal
  const [orderingItem, setOrderingItem] = useState<MerchOrder | null>(null)
  const [orderNote,    setOrderNote]    = useState('')
  const [orderSaving,  setOrderSaving]  = useState(false)

  const isOpsPlus = (role: string) =>
    ['ops_manager', 'owner', 'sales_director', 'developer'].includes(role)

  const loadOrders = useCallback(async () => {
    if (!session) return
    setLoading(true)
    const params = new URLSearchParams()
    if (isOpsPlus(session.role)) {
      if (filterMgr)   params.set('managerId', filterMgr)
      if (filterStore) params.set('storeId', filterStore)
    }
    const res = await fetch(`/api/merch-orders?${params}`)
    if (res.ok) {
      const d = await res.json()
      setOrders(d.orders ?? [])
      if (d.opsMgrs)   setOpsMgrs(d.opsMgrs)
      if (d.stores)    setStores(d.stores)
      if (d.managers)  setManagers(d.managers)
      if (d.allStores) setAllStores(d.allStores)
    }
    setLoading(false)
  }, [session, filterMgr, filterStore])

  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(setSession) }, [])
  useEffect(() => { if (session) loadOrders() }, [session, loadOrders])

  async function loadHistory() {
    setHistLoading(true)
    const params = new URLSearchParams({ history: 'true' })
    if (histFrom)  params.set('from', histFrom)
    if (histTo)    params.set('to', histTo)
    if (histMgr)   params.set('managerId', histMgr)
    if (histStore) params.set('storeId', histStore)
    const res = await fetch(`/api/merch-orders?${params}`)
    if (res.ok) { const d = await res.json(); setHistData(d.orders ?? []) }
    setHistLoading(false)
  }

  function addPhotos(files: FileList | null) {
    if (!files) return
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'))
    setPhotoFiles(prev => [...prev, ...imgs])
    imgs.forEach(f => {
      const reader = new FileReader()
      reader.onload = e => setPhotoPreviews(prev => [...prev, e.target?.result as string])
      reader.readAsDataURL(f)
    })
  }

  function removePhoto(i: number) {
    setPhotoFiles(prev => prev.filter((_, j) => j !== i))
    setPhotoPreviews(prev => prev.filter((_, j) => j !== i))
  }

  function resetSubmitModal() {
    setShowSubmit(false)
    setForm({ notes: '', opsManagerId: '', storeLocationId: '' })
    setPhotoFiles([])
    setPhotoPreviews([])
    setSubmitError('')
  }

  async function submitOrder() {
    setSubmitError('')
    if (!form.notes.trim())    { setSubmitError('Please describe what you need.'); return }
    if (!form.opsManagerId)    { setSubmitError('Please select an ops manager.'); return }
    setSubmitting(true)

    // Upload photos sequentially
    const photoKeys: string[] = []
    for (const file of photoFiles) {
      try {
        const res = await fetch('/api/merch-orders/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        })
        if (!res.ok) throw new Error('upload-url failed')
        const { url, key } = await res.json()
        const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
        if (!put.ok) throw new Error('S3 PUT failed')
        photoKeys.push(key)
      } catch {
        setSubmitError('Failed to upload a photo. Please try again.')
        setSubmitting(false)
        return
      }
    }

    const res = await fetch('/api/merch-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: form.notes,
        opsManagerId: form.opsManagerId,
        storeLocationId: form.storeLocationId || null,
        photos: photoKeys,
      }),
    })
    setSubmitting(false)
    if (res.ok) {
      resetSubmitModal()
      await loadOrders()
    } else {
      const d = await res.json().catch(() => ({}))
      setSubmitError(d.error ?? 'Failed to submit. Please try again.')
    }
  }

  async function markOrdered() {
    if (!orderingItem) return
    setOrderSaving(true)
    const res = await fetch('/api/merch-orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: orderingItem.id, note: orderNote }),
    })
    setOrderSaving(false)
    if (res.ok) {
      setOrderingItem(null)
      setOrderNote('')
      await loadOrders()
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const pending = orders.filter(o => o.status === 'pending')
  const ordered = orders.filter(o => o.status === 'ordered')
  const canSubmit = session.role === 'employee' || session.role === 'manager'

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-2xl mx-auto">

        {/* ─────────────────────────── EMPLOYEE / DM VIEW ─────────────────────────── */}
        {canSubmit && (
          <>
            <div className="flex items-center justify-between mb-5">
              <h1 className="text-xl font-bold text-white">Merch Orders</h1>
              <button
                onClick={() => { setShowSubmit(true); setSubmitError('') }}
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                + New Order
              </button>
            </div>

            {/* Summary pills for DMs */}
            {session.role === 'manager' && orders.length > 0 && (
              <div className="flex gap-2 mb-5">
                <div className="flex-1 bg-orange-900/20 border border-orange-800/40 rounded-xl px-3 py-2 text-center">
                  <p className="text-xl font-bold text-orange-400">{pending.length}</p>
                  <p className="text-[10px] text-orange-600">Pending</p>
                </div>
                <div className="flex-1 bg-blue-900/20 border border-blue-800/40 rounded-xl px-3 py-2 text-center">
                  <p className="text-xl font-bold text-blue-400">{ordered.length}</p>
                  <p className="text-[10px] text-blue-600">Ordered</p>
                </div>
              </div>
            )}

            {loading ? (
              <div className="text-center text-gray-500 py-16">Loading…</div>
            ) : orders.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-sm">No merch orders yet</p>
                <p className="text-gray-700 text-xs mt-1">Tap "+ New Order" to request merchandising</p>
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map(o => <OrderCard key={o.id} order={o} session={session} />)}
              </div>
            )}
          </>
        )}

        {/* ─────────────────────────── OPS+ VIEW ─────────────────────────── */}
        {isOpsPlus(session.role) && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-bold text-white">Merch Orders</h1>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-gray-800 mb-5">
              {(['active', 'history'] as const).map(tab => (
                <button key={tab} onClick={() => setOpsTab(tab)}
                  className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
                    opsTab === tab
                      ? 'border-violet-500 text-violet-400'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {tab === 'active' ? 'Active Orders' : 'History'}
                </button>
              ))}
            </div>

            {/* ── Active tab ── */}
            {opsTab === 'active' && (
              <>
                {/* Summary */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="bg-orange-900/20 border border-orange-800/40 rounded-xl px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-orange-400">{pending.length}</p>
                    <p className="text-[10px] text-orange-600">Needs Ordering</p>
                  </div>
                  <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl px-3 py-2.5 text-center">
                    <p className="text-2xl font-bold text-blue-400">{ordered.length}</p>
                    <p className="text-[10px] text-blue-600">Ordered</p>
                  </div>
                </div>

                {/* Filters */}
                <div className="flex gap-2 mb-4">
                  <select value={filterMgr} onChange={e => setFilterMgr(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="">All DMs</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                  <select value={filterStore} onChange={e => setFilterStore(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="">All Stores</option>
                    {allStores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
                  </select>
                </div>

                {loading ? (
                  <div className="text-center text-gray-500 py-16">Loading…</div>
                ) : orders.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-gray-500 text-sm">No active merch orders</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {pending.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">
                          Needs Ordering — {pending.length}
                        </p>
                        <div className="space-y-3">
                          {pending.map(o => (
                            <OrderCard key={o.id} order={o} session={session}
                              onOrder={o => { setOrderingItem(o); setOrderNote('') }} />
                          ))}
                        </div>
                      </div>
                    )}
                    {ordered.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">
                          Ordered — {ordered.length}
                        </p>
                        <div className="space-y-3">
                          {ordered.map(o => <OrderCard key={o.id} order={o} session={session} />)}
                        </div>
                      </div>
                    )}
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
                  <button onClick={loadHistory} disabled={histLoading}
                    className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                    {histLoading ? 'Loading…' : 'Search History'}
                  </button>
                </div>

                {histData.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-600 text-sm">Set filters above and tap Search</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                      {histData.length} order{histData.length !== 1 ? 's' : ''}
                    </p>
                    {histData.map(o => <OrderCard key={o.id} order={o} session={session} />)}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ─────────────────────────── SUBMIT MODAL ─────────────────────────── */}
      {showSubmit && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center"
          onClick={resetSubmitModal}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-5">New Merch Order Request</h2>
            <div className="space-y-4">

              {/* Ops manager selector */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Send To (Ops Manager)</label>
                {opsMgrs.length === 0 ? (
                  <p className="text-xs text-gray-600 italic">No ops managers found in your org.</p>
                ) : (
                  <select value={form.opsManagerId}
                    onChange={e => setForm(f => ({ ...f, opsManagerId: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="">Select ops manager…</option>
                    {opsMgrs.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                )}
              </div>

              {/* Store selector */}
              {stores.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Store Location</label>
                  <select value={form.storeLocationId}
                    onChange={e => setForm(f => ({ ...f, storeLocationId: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="">Select store…</option>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
                  </select>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  What do you need?
                  <span className="text-gray-600"> — describe the merchandising item(s)</span>
                </label>
                <textarea rows={5} placeholder="Describe the merch you need, quantity, and why…"
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none" />
              </div>

              {/* Photo upload */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Photos
                  <span className="text-gray-600"> (optional — add images to illustrate)</span>
                </label>
                {photoPreviews.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-2">
                    {photoPreviews.map((src, i) => (
                      <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-700 shrink-0">
                        <img src={src} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => removePhoto(i)}
                          className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full flex items-center justify-center text-white text-[10px] font-bold leading-none">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => { addPhotos(e.target.files); e.target.value = '' }} />
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="w-full border border-dashed border-gray-700 rounded-xl py-3 text-sm text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors">
                  + Add Photos
                </button>
              </div>

              {submitError && (
                <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-400">
                  {submitError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={resetSubmitModal}
                  className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button onClick={submitOrder} disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────── MARK ORDERED MODAL ─────────────────────────── */}
      {orderingItem && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center"
          onClick={() => setOrderingItem(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">Mark as Ordered</h2>
            <p className="text-sm text-gray-400 mb-3">Merch request from {orderingItem.requester_name}</p>

            {/* Order details for reference */}
            <div className="bg-gray-800 rounded-xl p-3 mb-5 space-y-2">
              <p className="text-xs text-gray-300 leading-relaxed">{orderingItem.notes}</p>
              {orderingItem.photos && orderingItem.photos.length > 0 && (
                <PhotoGrid keys={orderingItem.photos} />
              )}
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Order Details
                  <span className="text-gray-600"> — vendor, tracking #, estimated arrival</span>
                </label>
                <textarea rows={4}
                  placeholder="e.g. Ordered from corporate — tracking #1Z999AA10123456784. Estimated 3–5 business days."
                  value={orderNote} onChange={e => setOrderNote(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setOrderingItem(null)}
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
