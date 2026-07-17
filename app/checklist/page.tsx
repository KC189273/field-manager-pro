'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
type Tab = 'submit' | 'dashboard'
type FormView = 'landing' | 'form' | 'success'

interface Session {
  id: string
  fullName: string
  email: string
  role: Role
  org_id?: string | null
}

interface Store {
  id: string
  address: string
  dm_id: string | null
  dm_name: string | null
  dm_email: string | null
}

interface Submission {
  id: string
  checklist_type: 'opening' | 'closing'
  store_id: string
  store_address: string
  submitted_by_name: string
  dm_id: string
  dm_name: string
  submitted_at: string
}

interface SubmissionDetail {
  id: string
  checklist_type: string
  store_address: string
  submitted_by_name: string
  dm_name: string
  submitted_at: string
  items_completed: Array<{ item_number: number; label: string; completed: boolean }>
  inventory_photo_url: string | null
  inventory_photo_2_url: string | null
  pos_photo_url: string | null
  aframe_photo_url: string | null
  sales_floor_photo_url: string | null
  cash_drawer_photo_url: string | null
  reconciliation_photo_url: string | null
  reconciliation_photo_2_url: string | null
  voice_lines: string | null
  mim: string | null
  home_internet: string | null
  comment: string | null
}

interface ChecklistItemDef {
  item_number: number
  label: string
  requiresPhoto?: boolean
  additionalPhoto?: boolean
  optionalPhoto?: boolean
  multiplePhotos?: boolean
}

const OPENING_ITEMS: ChecklistItemDef[] = [
  { item_number: 1, label: 'Alarm / clock-in / login' },
  { item_number: 2, label: 'Send a picture of your inventory to DM', requiresPhoto: true, additionalPhoto: true },
  { item_number: 3, label: 'Put demo phones up' },
  { item_number: 4, label: 'Verify POS cash drawers', optionalPhoto: true },
  { item_number: 5, label: 'Turn on Heat / AC / Fan' },
  { item_number: 6, label: 'Turn on appropriate music' },
  { item_number: 7, label: 'Make sure you are in uniform' },
  { item_number: 8, label: 'Check the Hub for new promos' },
  { item_number: 9, label: 'Check store email, group chat, and MLB' },
  { item_number: 10, label: 'Put the A frame, flags, or Wavy man out', optionalPhoto: true },
  { item_number: 11, label: 'Check voicemail' },
  { item_number: 12, label: 'Start wiping counters' },
]

const CLOSING_ITEMS: ChecklistItemDef[] = [
  { item_number: 1, label: 'Lock Door' },
  { item_number: 2, label: 'Confirm all customers have left the store' },
  { item_number: 3, label: 'Close and lock door' },
  { item_number: 4, label: 'Send end of day numbers to group chat' },
  { item_number: 5, label: 'Secure demo handsets' },
  { item_number: 6, label: 'Execute closing and drawer reconciliation procedures', multiplePhotos: true },
  { item_number: 7, label: 'Count safe, return all POS tills to safe' },
  { item_number: 8, label: 'Prepare change order as needed' },
  { item_number: 9, label: 'Confirm safe is closed and locked' },
  { item_number: 10, label: 'Leave register drawers empty and fully open' },
  { item_number: 11, label: 'Put away unsold inventory' },
  { item_number: 12, label: 'Bring in A-frame/wavy guy, flags, etc.' },
  { item_number: 13, label: 'Sweep / vacuum sales floor' },
  { item_number: 14, label: 'Dispose of all trash (If safe outside)' },
  { item_number: 15, label: 'Clock out' },
  { item_number: 16, label: 'Set alarm / lock door' },
]

const canViewDashboard = (role: Role) =>
  role === 'manager' || role === 'ops_manager' || role === 'owner' ||
  role === 'sales_director' || role === 'developer'

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Chicago',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Chicago',
  })
}

export default function ChecklistPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [tab, setTab] = useState<Tab>('submit')
  const [formView, setFormView] = useState<FormView>('landing')
  const [checklistType, setChecklistType] = useState<'opening' | 'closing' | null>(null)

  // Form state
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [photoKey, setPhotoKey] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [salesFloorPhotoKey, setSalesFloorPhotoKey] = useState<string | null>(null)
  const [salesFloorPhotoPreview, setSalesFloorPhotoPreview] = useState<string | null>(null)
  const [cashDrawerPhotoKey, setCashDrawerPhotoKey] = useState<string | null>(null)
  const [cashDrawerPhotoPreview, setCashDrawerPhotoPreview] = useState<string | null>(null)
  // Additional / optional photo slots
  const [inventoryPhoto2Key, setInventoryPhoto2Key] = useState<string | null>(null)
  const [inventoryPhoto2Preview, setInventoryPhoto2Preview] = useState<string | null>(null)
  const [posPhotoKey, setPosPhotoKey] = useState<string | null>(null)
  const [posPhotoPreview, setPosPhotoPreview] = useState<string | null>(null)
  const [aframePhotoKey, setAframePhotoKey] = useState<string | null>(null)
  const [aframePhotoPreview, setAframePhotoPreview] = useState<string | null>(null)
  const [reconciliationPhotoKey, setReconciliationPhotoKey] = useState<string | null>(null)
  const [reconciliationPhotoPreview, setReconciliationPhotoPreview] = useState<string | null>(null)
  const [reconciliationPhoto2Key, setReconciliationPhoto2Key] = useState<string | null>(null)
  const [reconciliationPhoto2Preview, setReconciliationPhoto2Preview] = useState<string | null>(null)
  const [voiceLines, setVoiceLines] = useState('')
  const [mim, setMim] = useState('')
  const [homeInternet, setHomeInternet] = useState('')
  const [comment, setComment] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const salesFloorFileRef = useRef<HTMLInputElement>(null)
  const cashDrawerFileRef = useRef<HTMLInputElement>(null)
  const inventoryPhoto2Ref = useRef<HTMLInputElement>(null)
  const posPhotoRef = useRef<HTMLInputElement>(null)
  const aframePhotoRef = useRef<HTMLInputElement>(null)
  const reconciliationPhotoRef = useRef<HTMLInputElement>(null)
  const reconciliationPhoto2Ref = useRef<HTMLInputElement>(null)

  // Dashboard state
  const [dashDate, setDashDate] = useState(todayLocal)
  const [dashSubmissions, setDashSubmissions] = useState<Submission[]>([])
  const [dashLoading, setDashLoading] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => { if (d) setSession(d) })
  }, [router])

  useEffect(() => {
    if (!session) return
    fetch('/api/checklist/stores').then(r => r.json()).then(d => {
      if (d.stores) setStores(d.stores)
    })
  }, [session])

  useEffect(() => {
    if (!session || !canViewDashboard(session.role) || tab !== 'dashboard') return
    loadDashboard()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tab, dashDate])

  async function loadDashboard() {
    setDashLoading(true)
    const res = await fetch(`/api/checklist/submissions?date=${dashDate}`)
    const data = await res.json()
    setDashSubmissions(data.submissions ?? [])
    setDashLoading(false)
  }

  async function loadDetail(id: string) {
    setDetailId(id)
    setDetail(null)
    setDetailLoading(true)
    const res = await fetch(`/api/checklist/submissions/${id}`)
    const data = await res.json()
    setDetail(data)
    setDetailLoading(false)
  }

  function openForm(type: 'opening' | 'closing') {
    setChecklistType(type)
    setChecked(new Set())
    setStoreId('')
    setPhotoKey(null)
    setPhotoPreview(null)
    setSalesFloorPhotoKey(null)
    setSalesFloorPhotoPreview(null)
    setCashDrawerPhotoKey(null)
    setCashDrawerPhotoPreview(null)
    setInventoryPhoto2Key(null)
    setInventoryPhoto2Preview(null)
    setPosPhotoKey(null)
    setPosPhotoPreview(null)
    setAframePhotoKey(null)
    setAframePhotoPreview(null)
    setReconciliationPhotoKey(null)
    setReconciliationPhotoPreview(null)
    setReconciliationPhoto2Key(null)
    setReconciliationPhoto2Preview(null)
    setVoiceLines('')
    setMim('')
    setHomeInternet('')
    setComment('')
    setSubmitError('')
    setFormView('form')
  }

  function toggleItem(num: number) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })
  }

  async function uploadPhoto(
    file: File,
    setPreview: (v: string | null) => void,
    setKey: (v: string | null) => void
  ) {
    setPreview(URL.createObjectURL(file))
    setKey(null)
    setUploading(true)
    try {
      const urlRes = await fetch('/api/checklist/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      if (!urlRes.ok) { alert('Photo upload failed. Please try again.'); setUploading(false); return }
      const { url, key } = await urlRes.json()
      const s3Res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!s3Res.ok) { alert('Photo upload failed. Please try again.'); setUploading(false); return }
      setKey(key)
    } catch {
      alert('Photo upload failed. Please try again.')
    }
    setUploading(false)
  }

  function makeFileHandler(
    setPreview: (v: string | null) => void,
    setKey: (v: string | null) => void
  ) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) uploadPhoto(file, setPreview, setKey)
    }
  }

  async function handleSubmit() {
    if (!checklistType || !storeId) return
    setSubmitting(true)
    setSubmitError('')

    const items = checklistType === 'opening' ? OPENING_ITEMS : CLOSING_ITEMS
    const payload = {
      checklistType,
      storeId,
      photoKey: checklistType === 'opening' ? photoKey : null,
      inventoryPhoto2Key: checklistType === 'opening' ? inventoryPhoto2Key : null,
      posPhotoKey: checklistType === 'opening' ? posPhotoKey : null,
      aframePhotoKey: checklistType === 'opening' ? aframePhotoKey : null,
      salesFloorPhotoKey: checklistType === 'closing' ? salesFloorPhotoKey : null,
      cashDrawerPhotoKey: checklistType === 'closing' ? cashDrawerPhotoKey : null,
      reconciliationPhotoKey: checklistType === 'closing' ? reconciliationPhotoKey : null,
      reconciliationPhoto2Key: checklistType === 'closing' ? reconciliationPhoto2Key : null,
      voiceLines: checklistType === 'closing' ? voiceLines.trim() : undefined,
      mim: checklistType === 'closing' ? mim.trim() : undefined,
      homeInternet: checklistType === 'closing' ? homeInternet.trim() : undefined,
      comment: comment.trim() || null,
      items: items.map(item => ({
        item_number: item.item_number,
        label: item.label,
        completed: true,
      })),
    }

    try {
      const res = await fetch('/api/checklist/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        setSubmitError(d.error ?? 'Submission failed. Please try again.')
        return
      }
      setFormView('success')
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const items = checklistType === 'opening' ? OPENING_ITEMS : CLOSING_ITEMS
  const allChecked = items.every(item => checked.has(item.item_number))
  const photoRequired = checklistType === 'opening'
  const closingPhotosReady = checklistType !== 'closing' || (!!salesFloorPhotoKey && !!cashDrawerPhotoKey)
  const closingMetricsReady = checklistType !== 'closing' || (!!voiceLines.trim() && !!mim.trim() && !!homeInternet.trim())
  const canSubmit = allChecked && !!storeId && !uploading && !submitting &&
    (!photoRequired || !!photoKey) && closingPhotosReady && closingMetricsReady

  // Dashboard: group stores by DM
  const storesByDm = stores.reduce<Record<string, { dmName: string; stores: Store[] }>>((acc, store) => {
    const key = store.dm_id ?? 'unassigned'
    const name = store.dm_name ?? 'Unassigned'
    if (!acc[key]) acc[key] = { dmName: name, stores: [] }
    acc[key].stores.push(store)
    return acc
  }, {})

  function getLatestSubmission(sid: string, type: 'opening' | 'closing'): Submission | null {
    const matches = dashSubmissions.filter(s => s.store_id === sid && s.checklist_type === type)
    if (!matches.length) return null
    return matches.reduce((a, b) =>
      new Date(a.submitted_at) > new Date(b.submitted_at) ? a : b
    )
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500'

  if (!session) return <div className="min-h-screen bg-gray-950" />

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      {/* Tab bar — managers+ only */}
      {canViewDashboard(session.role) && (
        <div className="flex border-b border-gray-800 bg-gray-950 sticky top-14 z-30">
          {(['submit', 'dashboard'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setFormView('landing') }}
              className={`px-5 py-3 text-sm font-semibold transition-colors border-b-2 ${
                tab === t
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t === 'submit' ? 'Submit Checklist' : 'Dashboard'}
            </button>
          ))}
        </div>
      )}

      {/* ── SUBMIT TAB ── */}
      {tab === 'submit' && (
        <div className="max-w-xl mx-auto px-4">

          {/* Landing */}
          {formView === 'landing' && (
            <div className="py-8 space-y-4">
              <div className="text-center mb-6">
                <h1 className="text-xl font-bold text-white">Opening / Closing Checklist</h1>
                <p className="text-gray-500 text-sm mt-1">Select the checklist you need to complete.</p>
              </div>

              {/* Opening button */}
              <button
                onClick={() => openForm('opening')}
                className="w-full bg-gray-900 border border-gray-800 hover:border-green-500/50 hover:bg-green-500/5 rounded-2xl p-6 text-left transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center shrink-0 group-hover:bg-green-500/30 transition-colors">
                    <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.7.7M5.63 18.37l-.7.7M18.37 18.37l-.7-.7M5.63 5.63l-.7-.7" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold text-white text-base">Opening Checklist</p>
                    <p className="text-green-400 text-sm mt-0.5">{OPENING_ITEMS.length} items</p>
                  </div>
                </div>
              </button>

              {/* Closing button */}
              <button
                onClick={() => openForm('closing')}
                className="w-full bg-gray-900 border border-gray-800 hover:border-amber-500/50 hover:bg-amber-500/5 rounded-2xl p-6 text-left transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0 group-hover:bg-amber-500/30 transition-colors">
                    <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold text-white text-base">Closing Checklist</p>
                    <p className="text-amber-400 text-sm mt-0.5">{CLOSING_ITEMS.length} items</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Form */}
          {formView === 'form' && checklistType && (
            <div className="py-6 space-y-5">
              {/* Header */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setFormView('landing')}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div>
                  <h2 className="font-bold text-white text-lg capitalize">{checklistType} Checklist</h2>
                  <p className="text-xs text-gray-500">Check all items to enable submission</p>
                </div>
              </div>

              {/* Store selection */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Store Location <span className="text-red-400">*</span>
                </label>
                <select
                  value={storeId}
                  onChange={e => setStoreId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select a store</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id}>{s.address}</option>
                  ))}
                </select>
                {stores.length === 0 && (
                  <p className="text-xs text-amber-400 mt-1">No stores are assigned to your account yet.</p>
                )}
              </div>

              {/* Checklist items */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {/* Hidden file inputs */}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={makeFileHandler(setPhotoPreview, setPhotoKey)} />
                <input ref={inventoryPhoto2Ref} type="file" accept="image/*" className="hidden" onChange={makeFileHandler(setInventoryPhoto2Preview, setInventoryPhoto2Key)} />
                <input ref={posPhotoRef} type="file" accept="image/*" className="hidden" onChange={makeFileHandler(setPosPhotoPreview, setPosPhotoKey)} />
                <input ref={aframePhotoRef} type="file" accept="image/*" className="hidden" onChange={makeFileHandler(setAframePhotoPreview, setAframePhotoKey)} />
                <input ref={salesFloorFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={makeFileHandler(setSalesFloorPhotoPreview, setSalesFloorPhotoKey)} />
                <input ref={cashDrawerFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={makeFileHandler(setCashDrawerPhotoPreview, setCashDrawerPhotoKey)} />
                <input ref={reconciliationPhotoRef} type="file" accept="image/*" className="hidden" onChange={makeFileHandler(setReconciliationPhotoPreview, setReconciliationPhotoKey)} />
                <input ref={reconciliationPhoto2Ref} type="file" accept="image/*" className="hidden" onChange={makeFileHandler(setReconciliationPhoto2Preview, setReconciliationPhoto2Key)} />
                {items.map((item, idx) => (
                  <div
                    key={item.item_number}
                    className={idx < items.length - 1 ? 'border-b border-gray-800/60' : ''}
                  >
                    {/* Checkbox row */}
                    <div
                      onClick={() => toggleItem(item.item_number)}
                      className={`flex items-start gap-3 px-4 py-3.5 cursor-pointer transition-colors ${
                        checked.has(item.item_number) ? 'bg-violet-600/5' : 'hover:bg-gray-800/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(item.item_number)}
                        onChange={() => toggleItem(item.item_number)}
                        onClick={e => e.stopPropagation()}
                        className="accent-violet-500 w-5 h-5 mt-0.5 shrink-0"
                      />
                      <span className={`text-sm leading-snug ${
                        checked.has(item.item_number) ? 'text-gray-400 line-through' : 'text-white'
                      }`}>
                        {item.item_number}. {item.label}
                      </span>
                    </div>

                    {/* Primary inventory photo (required) + additional photo (optional) — opening item #2 */}
                    {item.requiresPhoto && checklistType === 'opening' && (
                      <div className="px-4 pb-3 space-y-2">
                        {/* Primary */}
                        {photoPreview ? (
                          <div>
                            <img src={photoPreview} alt="Inventory" className="w-full max-h-40 object-contain rounded-xl bg-gray-800 border border-gray-700" />
                            <div className="flex items-center gap-3 mt-1.5">
                              {uploading && <span className="text-xs text-violet-400">Uploading...</span>}
                              {photoKey && !uploading && <span className="text-xs text-green-400">Photo uploaded ✓</span>}
                              <button type="button" onClick={() => { setPhotoKey(null); setPhotoPreview(null); if (fileRef.current) fileRef.current.value = '' }} className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto">Remove</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => fileRef.current?.click()} className="w-full border border-dashed border-gray-600 hover:border-violet-500 rounded-xl py-3 text-center text-gray-500 hover:text-violet-400 transition-colors text-xs">
                            Tap to attach inventory photo
                          </button>
                        )}
                        {/* Additional photo */}
                        {item.additionalPhoto && (
                          inventoryPhoto2Preview ? (
                            <div>
                              <img src={inventoryPhoto2Preview} alt="Additional" className="w-full max-h-40 object-contain rounded-xl bg-gray-800 border border-gray-700" />
                              <div className="flex items-center gap-3 mt-1.5">
                                {uploading && <span className="text-xs text-violet-400">Uploading...</span>}
                                {inventoryPhoto2Key && !uploading && <span className="text-xs text-green-400">Additional photo uploaded ✓</span>}
                                <button type="button" onClick={() => { setInventoryPhoto2Key(null); setInventoryPhoto2Preview(null); if (inventoryPhoto2Ref.current) inventoryPhoto2Ref.current.value = '' }} className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto">Remove</button>
                              </div>
                            </div>
                          ) : (
                            <button type="button" onClick={() => inventoryPhoto2Ref.current?.click()} className="w-full border border-dashed border-gray-600/60 hover:border-violet-500/60 rounded-xl py-2 text-center text-gray-600 hover:text-violet-400 transition-colors text-xs">
                              + Add additional photo (optional)
                            </button>
                          )
                        )}
                      </div>
                    )}

                    {/* Optional POS photo — opening item #4 */}
                    {item.optionalPhoto && checklistType === 'opening' && item.item_number === 4 && (
                      <div className="px-4 pb-3">
                        {posPhotoPreview ? (
                          <div>
                            <img src={posPhotoPreview} alt="POS" className="w-full max-h-40 object-contain rounded-xl bg-gray-800 border border-gray-700" />
                            <div className="flex items-center gap-3 mt-1.5">
                              {uploading && <span className="text-xs text-violet-400">Uploading...</span>}
                              {posPhotoKey && !uploading && <span className="text-xs text-green-400">Photo uploaded ✓</span>}
                              <button type="button" onClick={() => { setPosPhotoKey(null); setPosPhotoPreview(null); if (posPhotoRef.current) posPhotoRef.current.value = '' }} className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto">Remove</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => posPhotoRef.current?.click()} className="w-full border border-dashed border-gray-600/60 hover:border-violet-500/60 rounded-xl py-2 text-center text-gray-600 hover:text-violet-400 transition-colors text-xs">
                            + Attach photo (optional)
                          </button>
                        )}
                      </div>
                    )}

                    {/* Optional A-frame photo — opening item #10 */}
                    {item.optionalPhoto && checklistType === 'opening' && item.item_number === 10 && (
                      <div className="px-4 pb-3">
                        {aframePhotoPreview ? (
                          <div>
                            <img src={aframePhotoPreview} alt="A-frame" className="w-full max-h-40 object-contain rounded-xl bg-gray-800 border border-gray-700" />
                            <div className="flex items-center gap-3 mt-1.5">
                              {uploading && <span className="text-xs text-violet-400">Uploading...</span>}
                              {aframePhotoKey && !uploading && <span className="text-xs text-green-400">Photo uploaded ✓</span>}
                              <button type="button" onClick={() => { setAframePhotoKey(null); setAframePhotoPreview(null); if (aframePhotoRef.current) aframePhotoRef.current.value = '' }} className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto">Remove</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => aframePhotoRef.current?.click()} className="w-full border border-dashed border-gray-600/60 hover:border-violet-500/60 rounded-xl py-2 text-center text-gray-600 hover:text-violet-400 transition-colors text-xs">
                            + Attach photo (optional)
                          </button>
                        )}
                      </div>
                    )}

                    {/* Multiple photos — closing reconciliation item #6 */}
                    {item.multiplePhotos && checklistType === 'closing' && (
                      <div className="px-4 pb-3 space-y-2">
                        {reconciliationPhotoPreview ? (
                          <div>
                            <img src={reconciliationPhotoPreview} alt="Reconciliation" className="w-full max-h-40 object-contain rounded-xl bg-gray-800 border border-gray-700" />
                            <div className="flex items-center gap-3 mt-1.5">
                              {uploading && <span className="text-xs text-violet-400">Uploading...</span>}
                              {reconciliationPhotoKey && !uploading && <span className="text-xs text-green-400">Photo 1 uploaded ✓</span>}
                              <button type="button" onClick={() => { setReconciliationPhotoKey(null); setReconciliationPhotoPreview(null); if (reconciliationPhotoRef.current) reconciliationPhotoRef.current.value = '' }} className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto">Remove</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => reconciliationPhotoRef.current?.click()} className="w-full border border-dashed border-gray-600/60 hover:border-violet-500/60 rounded-xl py-2 text-center text-gray-600 hover:text-violet-400 transition-colors text-xs">
                            + Attach photo (optional)
                          </button>
                        )}
                        {reconciliationPhoto2Preview ? (
                          <div>
                            <img src={reconciliationPhoto2Preview} alt="Reconciliation 2" className="w-full max-h-40 object-contain rounded-xl bg-gray-800 border border-gray-700" />
                            <div className="flex items-center gap-3 mt-1.5">
                              {uploading && <span className="text-xs text-violet-400">Uploading...</span>}
                              {reconciliationPhoto2Key && !uploading && <span className="text-xs text-green-400">Photo 2 uploaded ✓</span>}
                              <button type="button" onClick={() => { setReconciliationPhoto2Key(null); setReconciliationPhoto2Preview(null); if (reconciliationPhoto2Ref.current) reconciliationPhoto2Ref.current.value = '' }} className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto">Remove</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => reconciliationPhoto2Ref.current?.click()} className="w-full border border-dashed border-gray-600/60 hover:border-violet-500/60 rounded-xl py-2 text-center text-gray-600 hover:text-violet-400 transition-colors text-xs">
                            + Attach second photo (optional)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* End-of-day metrics — closing only, mandatory */}
              {checklistType === 'closing' && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800">
                    <p className="text-sm font-semibold text-white">End of Day Numbers <span className="text-red-400">*</span></p>
                    <p className="text-xs text-gray-500 mt-0.5">All fields required</p>
                  </div>
                  <div className="divide-y divide-gray-800/60">
                    <div className="px-4 py-3">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Voice Lines</label>
                      <input
                        type="text"
                        value={voiceLines}
                        onChange={e => setVoiceLines(e.target.value)}
                        placeholder="Enter number"
                        className={inputCls}
                      />
                    </div>
                    <div className="px-4 py-3">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">MIM (Magenta In Metro)</label>
                      <input
                        type="text"
                        value={mim}
                        onChange={e => setMim(e.target.value)}
                        placeholder="Enter number"
                        className={inputCls}
                      />
                    </div>
                    <div className="px-4 py-3">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Home Internet</label>
                      <input
                        type="text"
                        value={homeInternet}
                        onChange={e => setHomeInternet(e.target.value)}
                        placeholder="Enter number"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Closing photos — required */}
              {checklistType === 'closing' && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800">
                    <p className="text-sm font-semibold text-white">Required Closing Photos <span className="text-red-400">*</span></p>
                    <p className="text-xs text-gray-500 mt-0.5">Take photos of the sales floor and cash drawers before leaving</p>
                  </div>
                  {/* Sales floor */}
                  <div className="px-4 py-3 border-b border-gray-800/60">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sales Floor</p>
                    {salesFloorPhotoPreview ? (
                      <div>
                        <img src={salesFloorPhotoPreview} alt="Sales Floor" className="w-full max-h-40 object-contain rounded-xl bg-gray-800 border border-gray-700" />
                        <div className="flex items-center gap-3 mt-1.5">
                          {uploading && !salesFloorPhotoKey && <span className="text-xs text-violet-400">Uploading...</span>}
                          {salesFloorPhotoKey && <span className="text-xs text-green-400">Photo uploaded ✓</span>}
                          <button type="button" onClick={() => { setSalesFloorPhotoKey(null); setSalesFloorPhotoPreview(null); if (salesFloorFileRef.current) salesFloorFileRef.current.value = '' }} className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto">Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => salesFloorFileRef.current?.click()} className="w-full border border-dashed border-gray-600 hover:border-violet-500 rounded-xl py-3 text-center text-gray-500 hover:text-violet-400 transition-colors text-xs">
                        Tap to take / attach sales floor photo
                      </button>
                    )}
                  </div>
                  {/* Cash drawers */}
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Cash Drawers</p>
                    {cashDrawerPhotoPreview ? (
                      <div>
                        <img src={cashDrawerPhotoPreview} alt="Cash Drawers" className="w-full max-h-40 object-contain rounded-xl bg-gray-800 border border-gray-700" />
                        <div className="flex items-center gap-3 mt-1.5">
                          {uploading && !cashDrawerPhotoKey && <span className="text-xs text-violet-400">Uploading...</span>}
                          {cashDrawerPhotoKey && <span className="text-xs text-green-400">Photo uploaded ✓</span>}
                          <button type="button" onClick={() => { setCashDrawerPhotoKey(null); setCashDrawerPhotoPreview(null); if (cashDrawerFileRef.current) cashDrawerFileRef.current.value = '' }} className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto">Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => cashDrawerFileRef.current?.click()} className="w-full border border-dashed border-gray-600 hover:border-violet-500 rounded-xl py-3 text-center text-gray-500 hover:text-violet-400 transition-colors text-xs">
                        Tap to take / attach cash drawer photo
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Optional comment */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Comment <span className="text-gray-600 normal-case font-normal">(optional)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Any notes for your DM — e.g. issues noticed, items out of stock, anything unusual…"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                />
              </div>

              {/* Progress */}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{checked.size} of {items.length} items completed</span>
                {photoRequired && !photoKey && (
                  <span className="text-amber-400">Inventory photo required</span>
                )}
                {checklistType === 'closing' && !closingPhotosReady && (
                  <span className="text-amber-400">Closing photos required</span>
                )}
                {checklistType === 'closing' && !closingMetricsReady && (
                  <span className="text-amber-400">End of day numbers required</span>
                )}
              </div>

              {submitError && (
                <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-xl px-4 py-3">
                  {submitError}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors text-sm"
              >
                {submitting ? 'Submitting...' : 'Submit Checklist'}
              </button>
            </div>
          )}

          {/* Success */}
          {formView === 'success' && (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Checklist Submitted</h2>
              <p className="text-gray-400 text-sm mb-2">
                Your {checklistType} checklist has been saved and your DM has been notified.
              </p>
              <button
                onClick={() => setFormView('landing')}
                className="mt-6 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
              >
                Submit Another
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── DASHBOARD TAB ── */}
      {tab === 'dashboard' && canViewDashboard(session.role) && (
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          {/* Date picker */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Date</label>
              <input
                type="date"
                value={dashDate}
                onChange={e => setDashDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {dashLoading ? (
            <div className="text-center text-gray-500 py-10 text-sm">Loading...</div>
          ) : stores.length === 0 ? (
            <div className="text-center text-gray-500 py-10 text-sm">No stores found.</div>
          ) : session.role === 'manager' ? (
            // DMs see their own stores without DM grouping
            <div className="space-y-3">
              {stores.map(store => {
                const opening = getLatestSubmission(store.id, 'opening')
                const closing = getLatestSubmission(store.id, 'closing')
                return (
                  <div key={store.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800">
                      <p className="font-semibold text-white text-sm">{store.address}</p>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-gray-800">
                      <StatusCell label="Opening" submission={opening} onView={loadDetail} />
                      <StatusCell label="Closing" submission={closing} onView={loadDetail} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            // Ops/SD/Owner/Dev: group by DM
            <div className="space-y-4">
              {Object.entries(storesByDm).map(([dmKey, { dmName, stores: dmStores }]) => (
                <div key={dmKey}>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-1">{dmName}</p>
                  <div className="space-y-2">
                    {dmStores.map(store => {
                      const opening = getLatestSubmission(store.id, 'opening')
                      const closing = getLatestSubmission(store.id, 'closing')
                      return (
                        <div key={store.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                          <div className="px-4 py-3 border-b border-gray-800">
                            <p className="font-semibold text-white text-sm">{store.address}</p>
                          </div>
                          <div className="grid grid-cols-2 divide-x divide-gray-800">
                            <StatusCell label="Opening" submission={opening} onView={loadDetail} />
                            <StatusCell label="Closing" submission={closing} onView={loadDetail} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {detailId && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => { setDetailId(null); setDetail(null) }}
        >
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h2 className="font-bold text-lg text-white">Checklist Detail</h2>
              <button
                onClick={() => { setDetailId(null); setDetail(null) }}
                className="text-gray-500 hover:text-white text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-5">
              {detailLoading || !detail ? (
                <div className="text-center text-gray-500 py-10 text-sm">Loading...</div>
              ) : (
                <div className="space-y-4">
                  {/* Meta */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-800 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-1">Store</p>
                      <p className="text-sm text-white font-medium">{detail.store_address}</p>
                    </div>
                    <div className="bg-gray-800 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-1">Type</p>
                      <p className="text-sm text-white font-medium capitalize">{detail.checklist_type}</p>
                    </div>
                    <div className="bg-gray-800 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-1">Submitted By</p>
                      <p className="text-sm text-white font-medium">{detail.submitted_by_name}</p>
                    </div>
                    <div className="bg-gray-800 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-1">Time</p>
                      <p className="text-sm text-white font-medium">{formatDateTime(detail.submitted_at)}</p>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="bg-gray-800 rounded-xl overflow-hidden">
                    {(detail.items_completed as Array<{ item_number: number; label: string }>).map((item, idx, arr) => (
                      <div
                        key={item.item_number}
                        className={`px-4 py-2.5 flex items-center gap-3 ${idx < arr.length - 1 ? 'border-b border-gray-700/50' : ''}`}
                      >
                        <span className="text-green-400 text-base">✅</span>
                        <span className="text-sm text-white">{item.item_number}. {item.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Photos — opening */}
                  {(detail.inventory_photo_url || detail.inventory_photo_2_url || detail.pos_photo_url || detail.aframe_photo_url) && (
                    <div className="space-y-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Opening Photos</p>
                      {detail.inventory_photo_url && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Inventory</p>
                          <img src={detail.inventory_photo_url} alt="Inventory" className="w-full rounded-xl object-contain max-h-72 bg-gray-800 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <a href={detail.inventory_photo_url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2">Open full size</a>
                        </div>
                      )}
                      {detail.inventory_photo_2_url && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Inventory (Additional)</p>
                          <img src={detail.inventory_photo_2_url} alt="Inventory 2" className="w-full rounded-xl object-contain max-h-72 bg-gray-800 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <a href={detail.inventory_photo_2_url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2">Open full size</a>
                        </div>
                      )}
                      {detail.pos_photo_url && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">POS Cash Drawers</p>
                          <img src={detail.pos_photo_url} alt="POS" className="w-full rounded-xl object-contain max-h-72 bg-gray-800 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <a href={detail.pos_photo_url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2">Open full size</a>
                        </div>
                      )}
                      {detail.aframe_photo_url && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">A-Frame / Signage</p>
                          <img src={detail.aframe_photo_url} alt="A-Frame" className="w-full rounded-xl object-contain max-h-72 bg-gray-800 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <a href={detail.aframe_photo_url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2">Open full size</a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Photos — closing */}
                  {(detail.sales_floor_photo_url || detail.cash_drawer_photo_url || detail.reconciliation_photo_url || detail.reconciliation_photo_2_url) && (
                    <div className="space-y-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Closing Photos</p>
                      {detail.sales_floor_photo_url && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Sales Floor</p>
                          <img src={detail.sales_floor_photo_url} alt="Sales Floor" className="w-full rounded-xl object-contain max-h-72 bg-gray-800 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <a href={detail.sales_floor_photo_url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2">Open full size</a>
                        </div>
                      )}
                      {detail.cash_drawer_photo_url && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Cash Drawers</p>
                          <img src={detail.cash_drawer_photo_url} alt="Cash Drawers" className="w-full rounded-xl object-contain max-h-72 bg-gray-800 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <a href={detail.cash_drawer_photo_url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2">Open full size</a>
                        </div>
                      )}
                      {detail.reconciliation_photo_url && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Reconciliation Photo 1</p>
                          <img src={detail.reconciliation_photo_url} alt="Reconciliation" className="w-full rounded-xl object-contain max-h-72 bg-gray-800 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <a href={detail.reconciliation_photo_url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2">Open full size</a>
                        </div>
                      )}
                      {detail.reconciliation_photo_2_url && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Reconciliation Photo 2</p>
                          <img src={detail.reconciliation_photo_2_url} alt="Reconciliation 2" className="w-full rounded-xl object-contain max-h-72 bg-gray-800 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <a href={detail.reconciliation_photo_2_url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2">Open full size</a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* End of day metrics */}
                  {(detail.voice_lines || detail.mim || detail.home_internet) && (
                    <div className="bg-gray-800 rounded-xl overflow-hidden">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 pt-3 pb-2">End of Day Numbers</p>
                      {detail.voice_lines && (
                        <div className="px-4 py-2 flex justify-between border-t border-gray-700/50">
                          <span className="text-xs text-gray-400">Voice Lines</span>
                          <span className="text-xs font-semibold text-white">{detail.voice_lines}</span>
                        </div>
                      )}
                      {detail.mim && (
                        <div className="px-4 py-2 flex justify-between border-t border-gray-700/50">
                          <span className="text-xs text-gray-400">MIM (Magenta In Metro)</span>
                          <span className="text-xs font-semibold text-white">{detail.mim}</span>
                        </div>
                      )}
                      {detail.home_internet && (
                        <div className="px-4 py-2 flex justify-between border-t border-gray-700/50">
                          <span className="text-xs text-gray-400">Home Internet</span>
                          <span className="text-xs font-semibold text-white">{detail.home_internet}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Comment */}
                  {detail.comment && (
                    <div className="border-l-4 border-violet-600 bg-gray-800 rounded-r-xl px-4 py-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Comment</p>
                      <p className="text-sm text-gray-200">{detail.comment}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Sub-component for status cell in dashboard
function StatusCell({
  label,
  submission,
  onView,
}: {
  label: string
  submission: Submission | null
  onView: (id: string) => void
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-gray-500 mb-1.5">{label}</p>
      {submission ? (
        <button
          onClick={() => onView(submission.id)}
          className="flex items-center gap-1.5 text-left group"
        >
          <span className="text-green-400 text-base leading-none">✅</span>
          <div>
            <p className="text-xs font-semibold text-green-400 group-hover:text-green-300 transition-colors">
              Submitted
            </p>
            <p className="text-xs text-gray-500">{formatTime(submission.submitted_at)}</p>
          </div>
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          <p className="text-xs font-semibold text-red-400">Not Submitted</p>
        </div>
      )}
    </div>
  )
}
