'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'
import { downloadBlob } from '@/lib/download'

interface Session {
  id: string
  fullName: string
  email: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
  org_id?: string | null
}

interface StoreLocation {
  id: string
  address: string
  active: boolean
  org_id: string | null
  org_name: string | null
  employee_capacity: number
}

interface Org {
  id: string
  name: string
}

interface DashRow {
  dm_name: string
  submitted_by_id: string
  store_address: string
  count: string
}

interface DmUser {
  id: string
  full_name: string
  role: string
}

interface HoursRow {
  day_of_week: number // 0=Sun … 6=Sat
  open_time: string   // HH:MM
  close_time: string
  is_closed: boolean
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Tab = 'new' | 'quick' | 'dashboard' | 'report' | 'stores'

const DRAFT_KEY = 'dm-visit-draft'

const RDM_OPTIONS = ['Kalee Heinzman', 'Don Woods', 'Jeff Goodman', 'Gary Meier', 'Zac Okerstrom', 'Curt Hauk']
const VISIT_REASONS = ['Scheduled Visit', 'Performance Coaching', 'Recognition Visit', 'Training Support', 'Compliance Review', 'Other']
const GRADES = ['A', 'B', 'D', 'F']

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const canViewAll = (role: string) =>
  role === 'ops_manager' || role === 'owner' || role === 'sales_director' || role === 'developer'

const canManageStores = (role: string) =>
  role === 'owner' || role === 'sales_director' || role === 'developer'

const EMPTY_FORM = {
  store_location_id: '',
  store_address: '',
  employees_working: '',
  dm_name: '',
  assigned_rdm: '',
  reason_for_visit: '',
  additional_comments: '',
  pre_visit_1: '',
  pre_visit_2: '',
  pre_visit_3: '',
  scorecard_grade: '',
  scorecard_1: '',
  scorecard_2: '',
  scorecard_3: '',
  live_interaction_observed: '',
  heart_hello: '',
  heart_engage: '',
  heart_assess: '',
  heart_recommend: '',
  heart_thank: '',
  sales_process_1: '',
  sales_process_2: '',
  sales_process_3: '',
  sales_evaluation_comments: '',
  ops_check_1: '',
  ops_check_2: '',
  ops_check_3: '',
  ops_check_4: '',
  ops_check_5: '',
  ops_notes: '',
  coaching_1: '',
  coaching_2: '',
  coaching_3: '',
  impact_1: '',
  impact_2: '',
  impact_3: '',
  impact_4: '',
  cc_emails: '',
}

export default function DmVisitPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [tab, setTab] = useState<Tab>('new')
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)

  // Quick Visit
  const [quickForm, setQuickForm] = useState({ store_location_id: '', store_address: '', quick_interaction_notes: '', quick_takeaways: '', quick_actions: '', quick_impact: '' })
  const [quickSubmitting, setQuickSubmitting] = useState(false)
  const [quickSubmitted, setQuickSubmitted] = useState(false)
  const [quickError, setQuickError] = useState('')

  // Dashboard
  const [dashRows, setDashRows] = useState<DashRow[]>([])
  const [typeCounts, setTypeCounts] = useState<{ visit_type: string; count: string }[]>([])
  const [dashViewMode, setDashViewMode] = useState<'monthly' | 'range'>('monthly')
  const [dashMonth, setDashMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [dashFrom, setDashFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [dashTo, setDashTo] = useState(todayLocal)
  const [dashDmId, setDashDmId] = useState('')
  const [dmUsers, setDmUsers] = useState<DmUser[]>([])

  // Report download
  const [repFrom, setRepFrom] = useState('')
  const [repTo, setRepTo] = useState('')
  const [repDmId, setRepDmId] = useState('')
  const [repRdm, setRepRdm] = useState('')
  const [downloading, setDownloading] = useState(false)

  // Manage stores
  const [newAddress, setNewAddress] = useState('')
  const [addingStore, setAddingStore] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  // Org assignment
  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgAssignTarget, setOrgAssignTarget] = useState('')
  const [orgAssignStores, setOrgAssignStores] = useState<Set<string>>(new Set())
  const [orgAssigning, setOrgAssigning] = useState(false)
  const [orgAssignResult, setOrgAssignResult] = useState<string | null>(null)
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null)
  const [editingAddress, setEditingAddress] = useState('')
  const [editingCapacity, setEditingCapacity] = useState<1 | 2>(1)
  const [storeSaving, setStoreSaving] = useState(false)
  const [dmAssignTarget, setDmAssignTarget] = useState('')
  const [dmAssignOrgFilter, setDmAssignOrgFilter] = useState('')
  const [dmAssignStores, setDmAssignStores] = useState<Set<string>>(new Set())
  const [dmAssigning, setDmAssigning] = useState(false)
  const [dmAssignResult, setDmAssignResult] = useState<string | null>(null)
  const [bulkCapStores, setBulkCapStores] = useState<Set<string>>(new Set())
  const [bulkCapValue, setBulkCapValue] = useState<1 | 2>(2)
  const [bulkCapOrgFilter, setBulkCapOrgFilter] = useState('')
  const [bulkCapSaving, setBulkCapSaving] = useState(false)
  const [bulkCapResult, setBulkCapResult] = useState<string | null>(null)
  // Operating hours
  const [hoursPanel, setHoursPanel] = useState<string | null>(null)
  const [editingHours, setEditingHours] = useState<HoursRow[]>([])
  const [hoursSaving, setHoursSaving] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d) return
      if (d.role === 'employee') { router.replace('/dashboard'); return }
      setSession(d)
      setForm(f => ({ ...f, dm_name: d.fullName }))
      if (d.role === 'developer') {
        fetch('/api/orgs').then(r => r.json()).then(o => { if (o.orgs) setOrgs(o.orgs) })
      }
    })
  }, [router])

  const loadLocations = useCallback(() => {
    fetch('/api/dm-store-locations').then(r => r.json()).then(d => {
      if (d.locations) setLocations(d.locations)
    })
  }, [])

  useEffect(() => {
    if (session) loadLocations()
  }, [session, loadLocations])

  // Restore saved draft when session loads
  useEffect(() => {
    if (!session) return
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) {
        const draft = JSON.parse(saved)
        setForm(f => ({ ...EMPTY_FORM, ...draft, dm_name: session.fullName }))
        setHasDraft(true)
      }
    } catch { /* ignore */ }
  }, [session])

  // Auto-save form to localStorage on every change
  useEffect(() => {
    if (!session) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch { /* ignore */ }
  }, [form, session])

  // Keepalive ping every 4 minutes to prevent session expiry
  useEffect(() => {
    const id = setInterval(() => { fetch('/api/auth/me').catch(() => {}) }, 4 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // Load DM users for ops+ filters
  useEffect(() => {
    if (!session || !canViewAll(session.role)) return
    fetch('/api/team/users').then(r => r.json()).then(d => {
      if (d.users) setDmUsers(d.users.filter((u: DmUser) => u.role !== 'employee'))
    })
  }, [session])

  const loadDashboard = useCallback(() => {
    const p = new URLSearchParams({ dashboard: 'true' })
    if (dashFrom) p.set('from', dashFrom)
    if (dashTo) p.set('to', dashTo)
    if (dashDmId) p.set('dmId', dashDmId)
    fetch(`/api/dm-store-visits?${p}`).then(r => r.json()).then(d => {
      if (d.rows) setDashRows(d.rows)
      if (d.typeCounts) setTypeCounts(d.typeCounts)
    })
  }, [dashFrom, dashTo, dashDmId])

  // Sync monthly picker → dashFrom/dashTo
  useEffect(() => {
    if (dashViewMode !== 'monthly') return
    const [y, m] = dashMonth.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    setDashFrom(`${dashMonth}-01`)
    setDashTo(`${dashMonth}-${String(lastDay).padStart(2, '0')}`)
  }, [dashViewMode, dashMonth])

  useEffect(() => {
    if (session && tab === 'dashboard') loadDashboard()
  }, [session, tab, loadDashboard])

  function setField(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function handleStoreChange(id: string) {
    const loc = locations.find(l => l.id === id)
    setForm(f => ({ ...f, store_location_id: id, store_address: loc?.address ?? '' }))
  }

  function handleQuickStoreChange(id: string) {
    const loc = locations.find(l => l.id === id)
    setQuickForm(f => ({ ...f, store_location_id: id, store_address: loc?.address ?? '' }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    const live = form.live_interaction_observed === 'Yes'
    const payload = {
      ...form,
      live_interaction_observed: live,
      heart_hello: live ? form.heart_hello === 'Yes' : null,
      heart_engage: live ? form.heart_engage === 'Yes' : null,
      heart_assess: live ? form.heart_assess === 'Yes' : null,
      heart_recommend: live ? form.heart_recommend === 'Yes' : null,
      heart_thank: live ? form.heart_thank === 'Yes' : null,
      sales_process_1: live ? form.sales_process_1 === 'Yes' : null,
      sales_process_2: live ? form.sales_process_2 === 'Yes' : null,
      sales_process_3: live ? form.sales_process_3 === 'Yes' : null,
      sales_evaluation_comments: live ? form.sales_evaluation_comments : null,
      ops_check_1: form.ops_check_1 === 'Yes',
      ops_check_2: form.ops_check_2 === 'Yes',
      ops_check_3: form.ops_check_3 === 'Yes',
      ops_check_4: form.ops_check_4 === 'Yes',
      ops_check_5: form.ops_check_5 === 'Yes',
    }

    try {
      const res = await fetch('/api/dm-store-visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      setHasDraft(false)
      setSubmitted(true)
      setForm({ ...EMPTY_FORM, dm_name: session?.fullName ?? '' })
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Something went wrong. Please try again.'}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleQuickSubmit(e: React.FormEvent) {
    e.preventDefault()
    setQuickError('')
    if (!quickForm.store_address) { setQuickError('Please select a store.'); return }
    if (!quickForm.quick_takeaways.trim()) { setQuickError('Key Visit Takeaways is required.'); return }
    if (!quickForm.quick_actions.trim()) { setQuickError('Actions/Commitments is required.'); return }
    if (!quickForm.quick_impact.trim()) { setQuickError('DM Visit Impact Made is required.'); return }
    setQuickSubmitting(true)
    try {
      const res = await fetch('/api/dm-store-visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visit_type: 'quick', ...quickForm }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setQuickError(d.error ?? 'Submission failed.')
        return
      }
      setQuickSubmitted(true)
      setQuickForm({ store_location_id: '', store_address: '', quick_interaction_notes: '', quick_takeaways: '', quick_actions: '', quick_impact: '' })
    } catch {
      setQuickError('Network error. Please try again.')
    } finally {
      setQuickSubmitting(false)
    }
  }

  async function addStore() {
    if (!newAddress.trim()) return
    setAddingStore(true)
    await fetch('/api/dm-store-locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: newAddress.trim() }),
    })
    setNewAddress('')
    loadLocations()
    setAddingStore(false)
  }

  async function addBulk() {
    const addresses = bulkText.split('\n').map(a => a.trim()).filter(Boolean)
    if (addresses.length === 0) return
    setBulkAdding(true)
    setBulkResult(null)
    try {
      const res = await fetch('/api/dm-store-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Server error')
      setBulkText('')
      setBulkResult(`Added ${data.count} store${data.count !== 1 ? 's' : ''} successfully.`)
      loadLocations()
    } catch (err) {
      setBulkResult(`Error: ${err instanceof Error ? err.message : 'Something went wrong. Try a smaller batch.'}`)
    } finally {
      setBulkAdding(false)
    }
  }

  async function toggleStore(id: string, active: boolean) {
    await fetch('/api/dm-store-locations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
    })
    loadLocations()
  }

  async function saveCapacity(id: string, capacity: 1 | 2) {
    await fetch('/api/dm-store-locations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, employee_capacity: capacity }),
    })
    loadLocations()
  }

  async function saveStoreEdit(id: string) {
    if (!editingAddress.trim()) return
    setStoreSaving(true)
    await fetch('/api/dm-store-locations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, address: editingAddress.trim(), employee_capacity: editingCapacity }),
    })
    setStoreSaving(false)
    setEditingStoreId(null)
    setEditingAddress('')
    loadLocations()
  }

  async function saveBulkCapacity() {
    if (bulkCapStores.size === 0) return
    setBulkCapSaving(true)
    setBulkCapResult(null)
    try {
      const res = await fetch('/api/dm-store-locations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...bulkCapStores], employee_capacity: bulkCapValue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Server error')
      setBulkCapResult(`Updated ${bulkCapStores.size} store${bulkCapStores.size !== 1 ? 's' : ''} to ${bulkCapValue}-employee capacity.`)
      setBulkCapStores(new Set())
      loadLocations()
    } catch (err) {
      setBulkCapResult(`Error: ${err instanceof Error ? err.message : 'Something went wrong'}`)
    } finally {
      setBulkCapSaving(false)
    }
  }

  async function loadDmAssignments(managerId: string) {
    const res = await fetch(`/api/dm-manager-stores?managerId=${managerId}`)
    const data = await res.json()
    setDmAssignStores(new Set(data.storeIds || []))
  }

  async function saveDmAssign() {
    if (!dmAssignTarget) return
    setDmAssigning(true)
    setDmAssignResult(null)
    try {
      const res = await fetch('/api/dm-manager-stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerId: dmAssignTarget, storeIds: [...dmAssignStores] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Server error')
      setDmAssignResult(`Saved — ${dmAssignStores.size} store${dmAssignStores.size !== 1 ? 's' : ''} assigned.`)
    } catch (err) {
      setDmAssignResult(`Error: ${err instanceof Error ? err.message : 'Something went wrong'}`)
    } finally {
      setDmAssigning(false)
    }
  }

  async function openHoursPanel(storeId: string) {
    if (hoursPanel === storeId) { setHoursPanel(null); return }
    const res = await fetch(`/api/dm-store-hours?storeId=${storeId}`)
    const data = await res.json()
    setEditingHours(data.hours ?? [])
    setHoursPanel(storeId)
  }

  async function saveHours() {
    if (!hoursPanel) return
    setHoursSaving(true)
    await fetch('/api/dm-store-hours', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: hoursPanel, hours: editingHours }),
    })
    setHoursSaving(false)
    setHoursPanel(null)
  }

  async function assignOrg(removeOrg = false) {
    if (orgAssignStores.size === 0) return
    setOrgAssigning(true)
    setOrgAssignResult(null)
    try {
      const res = await fetch('/api/dm-store-locations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [...orgAssignStores],
          org_id: removeOrg ? null : orgAssignTarget || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setOrgAssignResult(removeOrg
        ? `Removed org from ${data.count} store${data.count !== 1 ? 's' : ''}.`
        : `Assigned ${data.count} store${data.count !== 1 ? 's' : ''} to ${orgs.find(o => o.id === orgAssignTarget)?.name ?? 'org'}.`
      )
      setOrgAssignStores(new Set())
      loadLocations()
    } catch (err) {
      setOrgAssignResult(`Error: ${err instanceof Error ? err.message : 'Something went wrong'}`)
    } finally {
      setOrgAssigning(false)
    }
  }

  async function downloadReport() {
    setDownloading(true)
    const p = new URLSearchParams()
    if (repFrom) p.set('from', repFrom)
    if (repTo) p.set('to', repTo)
    if (repDmId) p.set('dmId', repDmId)
    if (repRdm) p.set('rdm', repRdm)
    const res = await fetch(`/api/dm-store-visits/report?${p}`)
    if (res.ok) {
      const blob = await res.blob()
      await downloadBlob(blob, `dm-visits${repFrom ? `-${repFrom}` : ''}${repTo ? `-to-${repTo}` : ''}.xlsx`)
    } else {
      const err = await res.json().catch(() => ({ error: 'Download failed' }))
      alert(err.error ?? 'Download failed — please try again')
    }
    setDownloading(false)
  }

  if (!session) return null

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500'
  const labelCls = 'block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1'
  const sectionHeaderCls = 'bg-gray-800/60 px-4 py-2.5 border-y border-gray-800 text-xs font-bold uppercase tracking-widest text-violet-400'
  const fieldWrap = 'px-4 py-3'

  const yesNoSelect = (key: string, required = true) => (
    <select value={form[key as keyof typeof form]} onChange={e => setField(key, e.target.value)} required={required} className={inputCls}>
      <option value="">Select</option>
      <option>Yes</option>
      <option>No</option>
    </select>
  )

  const textArea = (key: string, placeholder?: string, required = true) => (
    <textarea value={form[key as keyof typeof form]} onChange={e => setField(key, e.target.value)} required={required} rows={3}
      placeholder={placeholder} className={inputCls + ' resize-none'} />
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'new', label: 'New Checklist' },
    { id: 'quick', label: 'Quick Visit' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'report', label: 'Download Report' },
    ...(canManageStores(session.role) || session.role === 'manager' ? [{ id: 'stores' as Tab, label: 'Manage Stores' }] : []),
  ]

  // Dashboard: group by DM, then by store
  const dashByDm = dashRows.reduce<Record<string, { stores: DashRow[]; total: number }>>((acc, r) => {
    if (!acc[r.dm_name]) acc[r.dm_name] = { stores: [], total: 0 }
    acc[r.dm_name].stores.push(r)
    acc[r.dm_name].total += Number(r.count)
    return acc
  }, {})
  const totalVisits = dashRows.reduce((s, r) => s + Number(r.count), 0)

  const live = form.live_interaction_observed === 'Yes'

  const locationOrgs = [...new Map(
    locations.filter(l => l.org_id).map(l => [l.org_id, { id: l.org_id!, name: l.org_name! }])
  ).values()]
  const dmFilteredLocations = dmAssignOrgFilter
    ? locations.filter(l => l.org_id === dmAssignOrgFilter)
    : locations
  const dmManagers = dmUsers.filter(u => u.role === 'manager')
  const bulkCapFilteredLocations = bulkCapOrgFilter
    ? locations.filter(l => l.org_id === bulkCapOrgFilter)
    : locations

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 bg-gray-950 sticky top-14 z-30 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSubmitted(false) }}
            className={`px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 ${
              tab === t.id ? 'border-violet-500 text-violet-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── NEW CHECKLIST ── */}
      {tab === 'new' && (
        <div className="max-w-xl mx-auto">
          {submitted ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Visit Submitted</h2>
              <p className="text-gray-400 text-sm mb-6">Your report has been saved and emailed to the RDM.</p>
              <button onClick={() => setSubmitted(false)} className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors">
                Submit Another
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="divide-y divide-gray-800/50">
              {/* Draft restored banner */}
              {hasDraft && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-900/30 border-b border-amber-700/40">
                  <div className="flex items-center gap-2 text-amber-300 text-sm">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Draft restored — your progress was saved automatically.
                  </div>
                  <button type="button" onClick={() => {
                    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
                    setForm({ ...EMPTY_FORM, dm_name: session?.fullName ?? '' })
                    setHasDraft(false)
                  }} className="text-xs text-amber-400 hover:text-amber-200 underline shrink-0">
                    Discard draft
                  </button>
                </div>
              )}

              {/* Visit Details */}
              <div className={sectionHeaderCls}>Visit Details</div>

              <div className={fieldWrap}>
                <label className={labelCls}>Store Address</label>
                <select value={form.store_location_id} onChange={e => handleStoreChange(e.target.value)} required className={inputCls}>
                  <option value="">Select a store</option>
                  {locations.filter(l => l.active).map(l => (
                    <option key={l.id} value={l.id}>{l.address}</option>
                  ))}
                </select>
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Employee(s) Working</label>
                <input type="text" value={form.employees_working} onChange={e => setField('employees_working', e.target.value)} required placeholder="Names of employees on shift" className={inputCls} />
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>DM Name</label>
                <input type="text" value={form.dm_name} readOnly className={inputCls + ' opacity-60 cursor-not-allowed'} />
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Assigned RDM</label>
                <select value={form.assigned_rdm} onChange={e => setField('assigned_rdm', e.target.value)} required className={inputCls}>
                  <option value="">Select RDM</option>
                  {RDM_OPTIONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Reason for Visit</label>
                <select value={form.reason_for_visit} onChange={e => setField('reason_for_visit', e.target.value)} required className={inputCls}>
                  <option value="">Select reason</option>
                  {VISIT_REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Additional Comments <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                {textArea('additional_comments', 'Any additional context for this visit…', false)}
              </div>

              {/* Pre-Visit Planning */}
              <div className={sectionHeaderCls}>Pre-Visit Planning</div>

              <div className={fieldWrap}>
                <label className={labelCls}>Current Store Metrics / Scorecard Highlights</label>
                {textArea('pre_visit_1', 'Summarize current performance data…')}
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Key Development Areas Identified Pre-Visit</label>
                {textArea('pre_visit_2', 'What gaps or opportunities were noted before arriving?')}
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Primary Objective for This Visit</label>
                {textArea('pre_visit_3', 'What is the main goal you want to accomplish?')}
              </div>

              {/* Scorecard Review */}
              <div className={sectionHeaderCls}>Scorecard Review</div>

              <div className={fieldWrap}>
                <label className={labelCls}>Letter Grade (Quartile-Based)</label>
                <select value={form.scorecard_grade} onChange={e => setField('scorecard_grade', e.target.value)} required className={inputCls}>
                  <option value="">Select grade</option>
                  {GRADES.map(g => <option key={g}>{g}</option>)}
                </select>
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Scorecard Strengths to Acknowledge</label>
                {textArea('scorecard_1', 'What is the store doing well?')}
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Areas Requiring Immediate Focus</label>
                {textArea('scorecard_2', 'What needs the most attention?')}
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Progress Since Last Review</label>
                {textArea('scorecard_3', 'What has improved or changed since your last visit?')}
              </div>

              {/* Sales Interaction */}
              <div className={sectionHeaderCls}>Sales Interaction</div>

              <div className={fieldWrap}>
                <label className={labelCls}>Was a Live Customer Interaction Observed?</label>
                {yesNoSelect('live_interaction_observed')}
              </div>

              {/* HEART — only shown if live = Yes */}
              {live && (
                <>
                  <div className={sectionHeaderCls}>HEART Sales Model</div>

                  {[
                    ['heart_hello', 'Hello — Associate greeted customer within 10 seconds'],
                    ['heart_engage', 'Engage — Associate connected authentically with the customer'],
                    ['heart_assess', 'Assess — Associate identified needs through discovery questions'],
                    ['heart_recommend', 'Recommend — Associate made a specific product / plan recommendation'],
                    ['heart_thank', 'Thank — Associate expressed genuine appreciation'],
                  ].map(([key, label]) => (
                    <div key={key} className={fieldWrap}>
                      <label className={labelCls}>{label}</label>
                      {yesNoSelect(key)}
                    </div>
                  ))}

                  <div className={sectionHeaderCls}>Sales Process Execution</div>

                  {[
                    ['sales_process_1', 'Demonstrated value and features of recommended solution'],
                    ['sales_process_2', 'Handled objections with confidence and accuracy'],
                    ['sales_process_3', 'Attempted to close and asked for the sale'],
                  ].map(([key, label]) => (
                    <div key={key} className={fieldWrap}>
                      <label className={labelCls}>{label}</label>
                      {yesNoSelect(key)}
                    </div>
                  ))}

                  <div className={fieldWrap}>
                    <label className={labelCls}>Evaluation Comments <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                    {textArea('sales_evaluation_comments', 'Additional notes on the sales interaction…', false)}
                  </div>
                </>
              )}

              {/* Operations Quick Check */}
              <div className={sectionHeaderCls}>Operations Quick Check</div>

              {[
                ['ops_check_1', 'Store is clean, organized, and visually presentable'],
                ['ops_check_2', 'Demo devices are charged and fully functional'],
                ['ops_check_3', 'Current marketing materials and pricing are properly displayed'],
                ['ops_check_4', 'Team members are in compliance with dress code / appearance standards'],
                ['ops_check_5', 'Required compliance documentation is current and accessible'],
              ].map(([key, label]) => (
                <div key={key} className={fieldWrap}>
                  <label className={labelCls}>{label}</label>
                  {yesNoSelect(key)}
                </div>
              ))}

              <div className={fieldWrap}>
                <label className={labelCls}>Operational Notes <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                {textArea('ops_notes', 'Any operational observations or action items…', false)}
              </div>

              {/* Coaching */}
              <div className={sectionHeaderCls}>Coaching</div>

              <div className={fieldWrap}>
                <label className={labelCls}>Specific Behaviors or Skills Coached</label>
                {textArea('coaching_1', 'What did you coach on during this visit?')}
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Follow-Up Plan and Accountability Measures</label>
                {textArea('coaching_3', 'How will you follow up and hold them accountable?')}
              </div>

              {/* Impact & Commitments */}
              <div className={sectionHeaderCls}>Impact & Commitments</div>

              <div className={fieldWrap}>
                <label className={labelCls}>Summary of Visit Impact / Key Observations</label>
                {textArea('impact_1', 'Overall takeaways from this visit…')}
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Employee Commitments Made During This Visit</label>
                {textArea('impact_2', 'What did the employee commit to before you left?')}
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Follow-Up / Check-In Date</label>
                <input type="text" value={form.impact_3} onChange={e => setField('impact_3', e.target.value)} required placeholder="e.g. April 14, 2026" className={inputCls} />
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Next Scheduled Store Visit Date</label>
                <input type="text" value={form.impact_4} onChange={e => setField('impact_4', e.target.value)} required placeholder="e.g. April 28, 2026" className={inputCls} />
              </div>

              {/* CC Emails */}
              <div className={sectionHeaderCls}>Additional Recipients</div>

              <div className={fieldWrap}>
                <label className={labelCls}>CC Emails <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                <input type="text" value={form.cc_emails} onChange={e => setField('cc_emails', e.target.value)} placeholder="email1@example.com, email2@example.com" className={inputCls} />
                <p className="text-xs text-gray-600 mt-1">Comma-separated. Copies will be sent in addition to the DM and RDM.</p>
              </div>

              <div className="px-4 py-5">
                <button type="submit" disabled={submitting}
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                  {submitting ? 'Submitting…' : 'Submit Visit Report'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── QUICK VISIT ── */}
      {tab === 'quick' && (
        <div className="max-w-xl mx-auto">
          {quickSubmitted ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Quick Visit Saved</h2>
              <p className="text-gray-400 text-sm mb-6">Your quick visit has been recorded.</p>
              <button onClick={() => setQuickSubmitted(false)} className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors">
                Submit Another
              </button>
            </div>
          ) : (
            <form onSubmit={handleQuickSubmit} className="divide-y divide-gray-800/50">
              <div className={sectionHeaderCls}>Quick Visit</div>

              <div className={fieldWrap}>
                <label className={labelCls}>Store Address</label>
                <select value={quickForm.store_location_id} onChange={e => handleQuickStoreChange(e.target.value)} required className={inputCls}>
                  <option value="">Select a store</option>
                  {locations.filter(l => l.active).map(l => (
                    <option key={l.id} value={l.id}>{l.address}</option>
                  ))}
                </select>
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Observed Customer Interaction Notes <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                <textarea
                  value={quickForm.quick_interaction_notes}
                  onChange={e => setQuickForm(f => ({ ...f, quick_interaction_notes: e.target.value }))}
                  rows={3}
                  placeholder="Notes on any customer interactions observed…"
                  className={inputCls + ' resize-none'}
                />
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Key Visit Takeaways <span className="text-red-500">*</span></label>
                <textarea
                  value={quickForm.quick_takeaways}
                  onChange={e => setQuickForm(f => ({ ...f, quick_takeaways: e.target.value }))}
                  required
                  rows={3}
                  placeholder="What were the main observations from this visit?"
                  className={inputCls + ' resize-none'}
                />
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>Actions / Commitments <span className="text-red-500">*</span></label>
                <textarea
                  value={quickForm.quick_actions}
                  onChange={e => setQuickForm(f => ({ ...f, quick_actions: e.target.value }))}
                  required
                  rows={3}
                  placeholder="What actions or commitments were made?"
                  className={inputCls + ' resize-none'}
                />
              </div>

              <div className={fieldWrap}>
                <label className={labelCls}>DM Visit Impact Made <span className="text-red-500">*</span></label>
                <textarea
                  value={quickForm.quick_impact}
                  onChange={e => setQuickForm(f => ({ ...f, quick_impact: e.target.value }))}
                  required
                  rows={3}
                  placeholder="What impact did your visit make?"
                  className={inputCls + ' resize-none'}
                />
              </div>

              {quickError && (
                <div className="px-4 py-3 bg-red-900/30 border-b border-red-700/40">
                  <p className="text-sm text-red-400">{quickError}</p>
                </div>
              )}

              <div className="px-4 py-5">
                <button type="submit" disabled={quickSubmitting}
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                  {quickSubmitting ? 'Submitting…' : 'Submit Quick Visit'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {tab === 'dashboard' && (() => {
        const normalCount = Number(typeCounts.find(t => t.visit_type === 'normal')?.count ?? 0)
        const quickCount = Number(typeCounts.find(t => t.visit_type === 'quick')?.count ?? 0)
        const typeTotal = normalCount + quickCount
        const normalPct = typeTotal > 0 ? Math.round(normalCount / typeTotal * 100) : 0
        const quickPct = typeTotal > 0 ? 100 - normalPct : 0

        return (
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {/* View mode toggle */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl overflow-hidden border border-gray-800">
              <button
                onClick={() => setDashViewMode('monthly')}
                className={`px-4 py-2 text-xs font-semibold transition-colors ${dashViewMode === 'monthly' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setDashViewMode('range')}
                className={`px-4 py-2 text-xs font-semibold transition-colors ${dashViewMode === 'range' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Custom Range
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-end">
            {canViewAll(session.role) && (
              <select value={dashDmId} onChange={e => setDashDmId(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                <option value="">All DMs</option>
                {dmUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            )}
            {dashViewMode === 'monthly' ? (
              <input
                type="month"
                value={dashMonth}
                onChange={e => setDashMonth(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            ) : (
              <>
                <input type="date" value={dashFrom} onChange={e => setDashFrom(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                <input type="date" value={dashTo} onChange={e => setDashTo(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                <button onClick={loadDashboard}
                  className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
                  Filter
                </button>
              </>
            )}
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4 flex items-center justify-between">
              <span className="text-gray-400 text-sm font-medium">Total Visits</span>
              <span className="text-2xl font-bold text-white">{totalVisits}</span>
            </div>
            {typeTotal > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Visit Types</p>
                {/* Stacked bar */}
                <div className="h-2 rounded-full overflow-hidden bg-gray-700 mb-2 flex">
                  {normalPct > 0 && <div className="bg-violet-500 h-full transition-all" style={{ width: `${normalPct}%` }} />}
                  {quickPct > 0 && <div className="bg-amber-500 h-full transition-all" style={{ width: `${quickPct}%` }} />}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                    <span className="text-gray-300">{normalPct}% Normal</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-gray-300">{quickPct}% Quick</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* By DM / Store */}
          {Object.entries(dashByDm).length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-10">No submissions found.</p>
          ) : (
            Object.entries(dashByDm).map(([dmName, { stores, total }]) => (
              <div key={dmName} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                  <span className="font-semibold text-white text-sm">{dmName}</span>
                  <span className="text-xs text-gray-400">{total} visit{total !== 1 ? 's' : ''}</span>
                </div>
                {stores.map(s => (
                  <div key={s.store_address} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/50 last:border-0">
                    <span className="text-sm text-gray-300">{s.store_address}</span>
                    <span className="text-sm font-semibold text-violet-400">{s.count}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        )
      })()}

      {/* ── DOWNLOAD REPORT ── */}
      {tab === 'report' && (
        <div className="max-w-md mx-auto px-4 py-6 space-y-4">
          <p className="text-gray-400 text-sm">Download a formatted Excel report with one tab per store visit. All fields are included.</p>

          <div className="space-y-3">
            <div>
              <label className={labelCls}>From Date</label>
              <input type="date" value={repFrom} onChange={e => setRepFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>To Date</label>
              <input type="date" value={repTo} onChange={e => setRepTo(e.target.value)} className={inputCls} />
            </div>

            {canViewAll(session.role) && (
              <div>
                <label className={labelCls}>Filter by DM</label>
                <select value={repDmId} onChange={e => setRepDmId(e.target.value)} className={inputCls}>
                  <option value="">All DMs</option>
                  {dmUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className={labelCls}>Filter by RDM</label>
              <select value={repRdm} onChange={e => setRepRdm(e.target.value)} className={inputCls}>
                <option value="">All RDMs</option>
                {RDM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <button onClick={downloadReport} disabled={downloading}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
            {downloading ? 'Preparing…' : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Excel Report
              </>
            )}
          </button>
        </div>
      )}

      {/* ── MANAGE STORES ── */}
      {tab === 'stores' && (canManageStores(session.role) || session.role === 'manager') && (
        <div className="max-w-xl mx-auto px-4 py-4 space-y-4">
          {/* Admin-only sections: Add/Bulk/Assign — hidden from DMs */}
          {canManageStores(session.role) && <>
          {/* Add store */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white">Add Store Location</h3>
            <input type="text" value={newAddress} onChange={e => setNewAddress(e.target.value)}
              placeholder="Full store address" className={inputCls} />
            <button onClick={addStore} disabled={addingStore || !newAddress.trim()}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
              {addingStore ? 'Adding…' : 'Add Location'}
            </button>
          </div>

          {/* Bulk add */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white">Bulk Add Stores</h3>
            <p className="text-xs text-gray-500">Paste one address per line — all will be added at once.</p>
            <textarea
              value={bulkText}
              onChange={e => { setBulkText(e.target.value); setBulkResult(null) }}
              rows={8}
              placeholder={"123 Main St, Springfield, IL\n456 Oak Ave, Chicago, IL\n..."}
              className={inputCls + ' resize-none font-mono text-xs'}
            />
            {bulkResult && (
              <p className={`text-xs font-medium ${bulkResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{bulkResult}</p>
            )}
            <button onClick={addBulk} disabled={bulkAdding || !bulkText.trim()}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
              {bulkAdding
                ? 'Adding…'
                : `Add ${bulkText.split('\n').filter(l => l.trim()).length || 0} Store${bulkText.split('\n').filter(l => l.trim()).length !== 1 ? 's' : ''}`}
            </button>
          </div>

          {/* Org assignment — developer only */}
          {session.role === 'developer' && orgs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-white">Assign Stores to Organization</h3>
              <p className="text-xs text-gray-500">Select stores below, choose an org, and assign them. Users in that org will only see their org&apos;s stores.</p>
              <select value={orgAssignTarget} onChange={e => { setOrgAssignTarget(e.target.value); setOrgAssignResult(null) }} className={inputCls}>
                <option value="">— Select organization —</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>

              {/* Store checkbox list */}
              <div className="border border-gray-700 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
                  <span className="text-xs text-gray-400">{orgAssignStores.size} of {locations.length} selected</span>
                  <button
                    onClick={() => setOrgAssignStores(
                      orgAssignStores.size === locations.length
                        ? new Set()
                        : new Set(locations.map(l => l.id))
                    )}
                    className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors">
                    {orgAssignStores.size === locations.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {locations.map(loc => (
                    <label key={loc.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b border-gray-800/50 last:border-0 ${
                      orgAssignStores.has(loc.id) ? 'bg-violet-600/10' : 'hover:bg-gray-800'
                    }`}>
                      <input type="checkbox" checked={orgAssignStores.has(loc.id)}
                        onChange={() => setOrgAssignStores(prev => {
                          const next = new Set(prev)
                          next.has(loc.id) ? next.delete(loc.id) : next.add(loc.id)
                          return next
                        })}
                        className="accent-violet-500 w-4 h-4 flex-shrink-0" />
                      <span className="text-sm text-gray-200 flex-1 min-w-0 truncate">{loc.address}</span>
                      {loc.org_name && (
                        <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded-full flex-shrink-0">{loc.org_name}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {orgAssignResult && (
                <p className={`text-xs font-medium ${orgAssignResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{orgAssignResult}</p>
              )}
              <div className="flex gap-2">
                <button onClick={() => assignOrg(false)}
                  disabled={orgAssigning || orgAssignStores.size === 0 || !orgAssignTarget}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                  {orgAssigning ? 'Saving…' : 'Assign to Org'}
                </button>
                <button onClick={() => assignOrg(true)}
                  disabled={orgAssigning || orgAssignStores.size === 0}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm font-semibold py-2.5 rounded-xl transition-colors">
                  Remove Org
                </button>
              </div>
            </div>
          )}

          {/* Bulk Employee Capacity */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white">Set Employee Capacity in Bulk</h3>
            <p className="text-xs text-gray-500">Select stores and set them all to 1 or 2-employee capacity at once.</p>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Set selected to:</span>
              <button onClick={() => setBulkCapValue(1)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${bulkCapValue === 1 ? 'bg-violet-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                1 Employee
              </button>
              <button onClick={() => setBulkCapValue(2)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${bulkCapValue === 2 ? 'bg-violet-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                2 Employees
              </button>
            </div>

            {locationOrgs.length > 0 && (
              <select value={bulkCapOrgFilter} onChange={e => setBulkCapOrgFilter(e.target.value)} className={inputCls}>
                <option value="">— All orgs —</option>
                {locationOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}

            <div className="border border-gray-700 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
                <span className="text-xs text-gray-400">{bulkCapStores.size} selected</span>
                <button
                  onClick={() => {
                    const allSelected = bulkCapFilteredLocations.every(l => bulkCapStores.has(l.id))
                    setBulkCapStores(prev => {
                      const next = new Set(prev)
                      if (allSelected) bulkCapFilteredLocations.forEach(l => next.delete(l.id))
                      else bulkCapFilteredLocations.forEach(l => next.add(l.id))
                      return next
                    })
                  }}
                  className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors">
                  {bulkCapFilteredLocations.every(l => bulkCapStores.has(l.id)) ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto">
                {bulkCapFilteredLocations.map(loc => (
                  <label key={loc.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b border-gray-800/50 last:border-0 ${
                    bulkCapStores.has(loc.id) ? 'bg-violet-600/10' : 'hover:bg-gray-800'
                  }`}>
                    <input type="checkbox"
                      checked={bulkCapStores.has(loc.id)}
                      onChange={() => setBulkCapStores(prev => {
                        const next = new Set(prev)
                        next.has(loc.id) ? next.delete(loc.id) : next.add(loc.id)
                        return next
                      })}
                      className="accent-violet-500 w-4 h-4 flex-shrink-0" />
                    <span className="text-sm text-gray-200 flex-1 min-w-0 truncate">{loc.address}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                      (loc.employee_capacity ?? 1) === 2
                        ? 'text-blue-400 bg-blue-900/30'
                        : 'text-gray-500 bg-gray-800'
                    }`}>
                      {loc.employee_capacity ?? 1} emp
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {bulkCapResult && (
              <p className={`text-xs font-medium ${bulkCapResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{bulkCapResult}</p>
            )}
            <button onClick={saveBulkCapacity}
              disabled={bulkCapSaving || bulkCapStores.size === 0}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
              {bulkCapSaving ? 'Saving…' : `Set ${bulkCapStores.size || ''} Store${bulkCapStores.size !== 1 ? 's' : ''} to ${bulkCapValue} Employee${bulkCapValue === 2 ? 's' : ''}`}
            </button>
          </div>

          {/* Assign Stores to DM */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white">Assign Stores to DM</h3>
            <p className="text-xs text-gray-500">Select a DM, optionally filter by org, then check the stores to assign. This replaces their current assignments.</p>

            <select
              value={dmAssignTarget}
              onChange={e => {
                setDmAssignTarget(e.target.value)
                setDmAssignResult(null)
                if (e.target.value) loadDmAssignments(e.target.value)
                else setDmAssignStores(new Set())
              }}
              className={inputCls}>
              <option value="">— Select DM —</option>
              {dmManagers.map(u => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>

            {locationOrgs.length > 0 && (
              <select value={dmAssignOrgFilter} onChange={e => setDmAssignOrgFilter(e.target.value)} className={inputCls}>
                <option value="">— All orgs —</option>
                {locationOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}

            <div className="border border-gray-700 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
                <span className="text-xs text-gray-400">
                  {dmAssignStores.size} assigned total &middot; {dmFilteredLocations.filter(l => dmAssignStores.has(l.id)).length} in view
                </span>
                <button
                  onClick={() => {
                    const allSelected = dmFilteredLocations.every(l => dmAssignStores.has(l.id))
                    setDmAssignStores(prev => {
                      const next = new Set(prev)
                      if (allSelected) dmFilteredLocations.forEach(l => next.delete(l.id))
                      else dmFilteredLocations.forEach(l => next.add(l.id))
                      return next
                    })
                  }}
                  className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors">
                  {dmFilteredLocations.every(l => dmAssignStores.has(l.id)) ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto">
                {dmFilteredLocations.map(loc => (
                  <label key={loc.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b border-gray-800/50 last:border-0 ${
                    dmAssignStores.has(loc.id) ? 'bg-violet-600/10' : 'hover:bg-gray-800'
                  }`}>
                    <input type="checkbox"
                      checked={dmAssignStores.has(loc.id)}
                      onChange={() => setDmAssignStores(prev => {
                        const next = new Set(prev)
                        next.has(loc.id) ? next.delete(loc.id) : next.add(loc.id)
                        return next
                      })}
                      className="accent-violet-500 w-4 h-4 flex-shrink-0" />
                    <span className="text-sm text-gray-200 flex-1 min-w-0 truncate">{loc.address}</span>
                    {loc.org_name && (
                      <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded-full flex-shrink-0">{loc.org_name}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {dmAssignResult && (
              <p className={`text-xs font-medium ${dmAssignResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{dmAssignResult}</p>
            )}
            <button onClick={saveDmAssign}
              disabled={dmAssigning || !dmAssignTarget}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
              {dmAssigning ? 'Saving…' : 'Save DM Assignments'}
            </button>
          </div>
          </>}

          {/* Store list */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <span className="text-sm font-bold text-white">All Locations ({locations.length})</span>
            </div>
            {locations.map(loc => (
              <div key={loc.id} className="border-b border-gray-800/50 last:border-0">
                {/* Store row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    {editingStoreId === loc.id ? (
                      <div className="space-y-1.5">
                        <input
                          value={editingAddress}
                          onChange={e => setEditingAddress(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveStoreEdit(loc.id); if (e.key === 'Escape') { setEditingStoreId(null); setEditingAddress('') } }}
                          className="w-full bg-gray-800 border border-gray-600 text-gray-200 text-sm rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Capacity:</span>
                          <button onClick={() => setEditingCapacity(1)}
                            className={`text-xs px-2 py-0.5 rounded-md font-semibold transition-colors ${editingCapacity === 1 ? 'bg-violet-600 text-white' : 'bg-gray-700 text-gray-400'}`}>
                            1 Employee
                          </button>
                          <button onClick={() => setEditingCapacity(2)}
                            className={`text-xs px-2 py-0.5 rounded-md font-semibold transition-colors ${editingCapacity === 2 ? 'bg-violet-600 text-white' : 'bg-gray-700 text-gray-400'}`}>
                            2 Employees
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className={`text-sm ${loc.active ? 'text-gray-200' : 'text-gray-600 line-through'}`}>
                          {loc.address}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-gray-500">{loc.employee_capacity ?? 1} emp</span>
                          {loc.org_name && (
                            <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded-full">{loc.org_name}</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {editingStoreId === loc.id ? (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => saveStoreEdit(loc.id)} disabled={storeSaving}
                        className="text-xs font-semibold px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors">
                        Save
                      </button>
                      <button onClick={() => { setEditingStoreId(null); setEditingAddress(''); setEditingCapacity(1) }}
                        className="text-xs font-semibold px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => openHoursPanel(loc.id)}
                        className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${hoursPanel === loc.id ? 'bg-amber-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
                        Hours
                      </button>
                      {session.role === 'manager' && (
                        <button
                          onClick={() => saveCapacity(loc.id, (loc.employee_capacity ?? 1) === 1 ? 2 : 1)}
                          className="text-xs font-semibold px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                          title="Toggle employee capacity"
                        >
                          {loc.employee_capacity ?? 1} emp
                        </button>
                      )}
                      {canManageStores(session.role) && <>
                      <button onClick={() => { setEditingStoreId(loc.id); setEditingAddress(loc.address); setEditingCapacity((loc.employee_capacity ?? 1) as 1 | 2) }}
                        className="text-xs font-semibold px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                        Edit
                      </button>
                      <button onClick={() => toggleStore(loc.id, loc.active)}
                        className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${
                          loc.active
                            ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60'
                            : 'bg-green-900/40 text-green-400 hover:bg-green-900/60'
                        }`}>
                        {loc.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      </>}
                    </div>
                  )}
                </div>

                {/* Hours panel */}
                {hoursPanel === loc.id && (
                  <div className="px-4 pb-4 pt-1 border-t border-gray-800 bg-gray-950/50">
                    <p className="text-xs font-semibold text-amber-400 mb-3">Operating Hours</p>
                    <div className="space-y-2">
                      {editingHours.map((h, i) => (
                        <div key={h.day_of_week} className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-24 flex-shrink-0">{DAY_NAMES[h.day_of_week]}</span>
                          <label className="flex items-center gap-1.5 flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={h.is_closed}
                              onChange={e => {
                                const next = [...editingHours]
                                next[i] = { ...h, is_closed: e.target.checked }
                                setEditingHours(next)
                              }}
                              className="accent-red-500 w-3.5 h-3.5"
                            />
                            <span className="text-xs text-gray-500">Closed</span>
                          </label>
                          {!h.is_closed && (
                            <>
                              <input
                                type="time"
                                value={h.open_time.slice(0, 5)}
                                onChange={e => {
                                  const next = [...editingHours]
                                  next[i] = { ...h, open_time: e.target.value }
                                  setEditingHours(next)
                                }}
                                className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500"
                              />
                              <span className="text-xs text-gray-600">–</span>
                              <input
                                type="time"
                                value={h.close_time.slice(0, 5)}
                                onChange={e => {
                                  const next = [...editingHours]
                                  next[i] = { ...h, close_time: e.target.value }
                                  setEditingHours(next)
                                }}
                                className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500"
                              />
                            </>
                          )}
                          {h.is_closed && (
                            <span className="text-xs text-red-400 italic">Closed</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button onClick={saveHours} disabled={hoursSaving}
                        className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-xl transition-colors">
                        {hoursSaving ? 'Saving…' : 'Save Hours'}
                      </button>
                      <button onClick={() => setHoursPanel(null)}
                        className="px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold py-2 rounded-xl transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
