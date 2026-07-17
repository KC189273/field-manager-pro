'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
type ResourceType = 'announcement' | 'document' | 'link' | 'contact'

interface Session {
  id: string
  fullName: string
  role: Role
}

interface Resource {
  id: string
  type: ResourceType
  title: string
  body: string | null
  url: string | null
  s3_key: string | null
  filename: string | null
  contact_name: string | null
  contact_role: string | null
  contact_phone: string | null
  contact_email: string | null
  contact_avatar_url: string | null
  created_by: string | null
  created_by_name: string | null
  sort_order: number
  is_pinned: boolean
  created_at: string
}

const CAN_MANAGE: Role[] = ['owner', 'ops_manager', 'developer', 'sales_director']

const TYPE_OPTS: { key: ResourceType; label: string; icon: string }[] = [
  { key: 'announcement', label: 'Announcement', icon: '📢' },
  { key: 'document',     label: 'Document',     icon: '📄' },
  { key: 'link',         label: 'Link',         icon: '🔗' },
  { key: 'contact',      label: 'Key Contact',  icon: '👤' },
]

const SECTION_TABS: { type: ResourceType; label: string }[] = [
  { type: 'announcement', label: 'Announcements' },
  { type: 'document',     label: 'Documents' },
  { type: 'link',         label: 'Links' },
  { type: 'contact',      label: 'Key Contacts' },
]

export default function ResourcesPage() {
  const [session, setSession]     = useState<Session | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [activeTab, setActiveTab] = useState<ResourceType>('announcement')

  // Modal
  const [modal, setModal]               = useState<'add' | 'edit' | null>(null)
  const [editingResource, setEditingResource] = useState<Resource | null>(null)
  const [saving, setSaving]             = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [modalError, setModalError]     = useState('')
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    type: 'announcement' as ResourceType,
    title: '', body: '', url: '',
    s3Key: '', filename: '',
    contactName: '', contactRole: '', contactPhone: '', contactEmail: '',
  })

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  const loadResources = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/resources', { cache: 'no-store' })
      if (res.ok) {
        const d = await res.json()
        setResources(d.resources ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) loadResources()
  }, [session, loadResources])

  useEffect(() => {
    if (!session) return
    const onVisible = () => { if (document.visibilityState === 'visible') loadResources() }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(loadResources, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [session, loadResources])

  const canManage = session ? CAN_MANAGE.includes(session.role) : false

  async function handleDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingDoc(true)
    try {
      const res = await fetch('/api/resources/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      const { url, key } = await res.json()
      await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      setForm(f => ({ ...f, s3Key: key, filename: file.name }))
    } catch {
      setModalError('File upload failed. Please try again.')
    } finally {
      setUploadingDoc(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function openDocument(resource: Resource) {
    if (!resource.s3_key) return
    const res = await fetch(`/api/resources/view-url?key=${encodeURIComponent(resource.s3_key)}`)
    if (res.ok) {
      const { url } = await res.json()
      window.open(url, '_blank')
    }
  }

  function openAdd(type: ResourceType = activeTab) {
    setEditingResource(null)
    setModalError('')
    setForm({ type, title: '', body: '', url: '', s3Key: '', filename: '', contactName: '', contactRole: '', contactPhone: '', contactEmail: '' })
    setModal('add')
  }

  function openEdit(r: Resource) {
    setEditingResource(r)
    setModalError('')
    setForm({
      type: r.type,
      title: r.title,
      body: r.body ?? '',
      url: r.url ?? '',
      s3Key: r.s3_key ?? '',
      filename: r.filename ?? '',
      contactName: r.contact_name ?? '',
      contactRole: r.contact_role ?? '',
      contactPhone: r.contact_phone ?? '',
      contactEmail: r.contact_email ?? '',
    })
    setModal('edit')
  }

  async function saveResource() {
    setModalError('')
    if (!form.title.trim()) { setModalError('Title is required.'); return }
    setSaving(true)
    try {
      const payload = {
        type: form.type, title: form.title.trim(),
        body: form.body.trim() || null, url: form.url.trim() || null,
        s3Key: form.s3Key || null, filename: form.filename || null,
        contactName: form.contactName.trim() || null, contactRole: form.contactRole.trim() || null,
        contactPhone: form.contactPhone.trim() || null, contactEmail: form.contactEmail.trim() || null,
        ...(modal === 'edit' ? { id: editingResource?.id } : {}),
      }
      const res = await fetch('/api/resources', {
        method: modal === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setModalError(d.error ?? 'Save failed.')
        return
      }
      setModal(null)
      await loadResources()
    } catch {
      setModalError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteResource() {
    if (!editingResource) return
    setDeleting(true)
    try {
      const res = await fetch('/api/resources', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingResource.id }),
      })
      if (!res.ok) { setModalError('Failed to delete.'); return }
      setModal(null)
      await loadResources()
    } catch {
      setModalError('Network error.')
    } finally {
      setDeleting(false)
    }
  }

  async function togglePin(resource: Resource) {
    const action = resource.is_pinned ? 'unpin' : 'pin'
    if (!resource.is_pinned) {
      const pinned = resources.filter(r => r.is_pinned)
      if (pinned.length >= 4) { alert('Maximum 4 items can be pinned. Unpin one first.'); return }
    }
    setResources(prev => prev.map(r => r.id === resource.id ? { ...r, is_pinned: !r.is_pinned } : r))
    const res = await fetch('/api/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [action]: resource.id }),
    })
    if (!res.ok) {
      setResources(prev => prev.map(r => r.id === resource.id ? { ...r, is_pinned: resource.is_pinned } : r))
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const filtered = resources.filter(r =>
    !search || r.title.toLowerCase().includes(search.toLowerCase()) ||
    r.body?.toLowerCase().includes(search.toLowerCase()) ||
    r.contact_name?.toLowerCase().includes(search.toLowerCase())
  )

  function byType(t: ResourceType) { return filtered.filter(r => r.type === t) }

  function fmtDate(ts: string) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
  }

  const activeItems = byType(activeTab)
  const pinnedItems = resources.filter(r => r.is_pinned)

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-4 pb-6 max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-white">Resources</h1>
            <p className="text-xs text-gray-500 mt-0.5">Company reference hub</p>
          </div>
          {canManage && (
            <button onClick={() => openAdd()}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shrink-0">
              <span className="text-base leading-none">+</span>
              <span>Add</span>
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Search resources…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-2xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-600" />
        </div>

        {/* Pinned */}
        {!loading && !search && pinnedItems.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 4v6l2 2v2h-5v6l-1 1-1-1v-6H6v-2l2-2V4h-1V2h10v2h-1z"/>
              </svg>
              <h2 className="text-sm font-bold text-white">Pinned</h2>
            </div>
            <div className="space-y-2">
              {pinnedItems.map(r => (
                <ResourceCard key={`pin-${r.id}`} resource={r} canManage={canManage}
                  onEdit={() => openEdit(r)} onOpen={() => openDocument(r)} fmtDate={fmtDate}
                  onTogglePin={canManage ? () => togglePin(r) : undefined} />
              ))}
            </div>
          </div>
        )}

        {/* Section Tabs */}
        <div className="flex border-b border-gray-800 mb-4 overflow-x-auto">
          {SECTION_TABS.map(t => {
            const count = byType(t.type).length
            return (
              <button key={t.type} onClick={() => setActiveTab(t.type)}
                className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === t.type ? 'border-violet-500 text-violet-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}>
                {t.label}
                {count > 0 && <span className="ml-1.5 text-xs text-gray-600">({count})</span>}
              </button>
            )
          })}
        </div>

        {/* Active Tab Content */}
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-gray-800 rounded w-40 mb-2" />
                <div className="h-3 bg-gray-800 rounded w-64" />
              </div>
            ))}
          </div>
        ) : activeItems.length === 0 ? (
          <div className="bg-gray-900/50 border border-dashed border-gray-800 rounded-2xl px-4 py-12 text-center">
            <p className="text-sm text-gray-600 mb-3">No {SECTION_TABS.find(t => t.type === activeTab)?.label.toLowerCase()} yet</p>
            {canManage && (
              <button onClick={() => openAdd(activeTab)}
                className="text-xs text-violet-400 hover:text-violet-300 font-semibold border border-violet-800/40 hover:border-violet-600/60 px-4 py-2 rounded-lg transition-colors">
                + Add {SECTION_TABS.find(t => t.type === activeTab)?.label.slice(0, -1)}
              </button>
            )}
          </div>
        ) : activeTab === 'contact' ? (
          /* Contact cards — grid layout with avatars */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeItems.map(r => (
              <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center shrink-0 overflow-hidden">
                    {r.contact_avatar_url ? (
                      <img src={r.contact_avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <span className="text-gray-500 text-sm font-bold">
                        {(r.contact_name || r.title).charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-white truncate">{r.contact_name || r.title}</p>
                      {canManage && (
                        <button onClick={() => openEdit(r)} className="text-gray-600 hover:text-gray-300 transition-colors shrink-0">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {r.contact_role && <p className="text-xs text-gray-500 mt-0.5">{r.contact_role}</p>}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                      {r.contact_phone && (
                        <a href={`tel:${r.contact_phone}`} className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          {r.contact_phone}
                        </a>
                      )}
                      {r.contact_email && (
                        <a href={`mailto:${r.contact_email}`} className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors truncate">
                          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {r.contact_email}
                        </a>
                      )}
                    </div>
                    {r.body && <p className="text-xs text-gray-500 mt-2">{r.body}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Standard vertical list for announcements, documents, links */
          <div className="space-y-2">
            {activeItems.map(r => (
              <ResourceCard key={r.id} resource={r} canManage={canManage}
                onEdit={() => openEdit(r)} onOpen={() => openDocument(r)} fmtDate={fmtDate}
                onTogglePin={canManage ? () => togglePin(r) : undefined} />
            ))}
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ── */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">{modal === 'edit' ? 'Edit Resource' : 'New Resource'}</h2>
              <button onClick={() => setModal(null)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {TYPE_OPTS.map(t => (
                    <button key={t.key} type="button" onClick={() => setForm(f => ({ ...f, type: t.key }))}
                      className={`flex items-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl border transition-colors ${
                        form.type === t.key ? 'bg-violet-600/20 border-violet-500 text-violet-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                      }`}>
                      <span>{t.icon}</span><span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Title</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder={form.type === 'announcement' ? 'e.g. Q2 Policy Update' : form.type === 'document' ? 'e.g. Employee Handbook' : form.type === 'link' ? 'e.g. Payroll Portal' : 'e.g. HR Contact'}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" autoFocus />
              </div>

              {(form.type === 'announcement' || form.type === 'link') && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">{form.type === 'announcement' ? 'Message' : 'Description'} <span className="text-gray-600 font-normal">— optional</span></label>
                  <textarea rows={form.type === 'announcement' ? 4 : 2} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    placeholder={form.type === 'announcement' ? 'Write your announcement…' : 'Brief description of this link'}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none" />
                </div>
              )}

              {form.type === 'link' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">URL</label>
                  <input type="url" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://…"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                </div>
              )}

              {form.type === 'document' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">File</label>
                  {form.filename ? (
                    <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2.5 mb-2">
                      <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-gray-300 flex-1 truncate">{form.filename}</span>
                      <button onClick={() => setForm(f => ({ ...f, s3Key: '', filename: '' }))} className="text-gray-600 hover:text-red-400">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className={`relative flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 rounded-xl px-4 py-3 text-sm text-gray-400 hover:text-gray-200 transition-colors w-full justify-center ${uploadingDoc ? 'opacity-50 pointer-events-none' : ''}`}>
                      <input ref={fileInputRef} type="file" onChange={handleDocFile} disabled={uploadingDoc}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                      {uploadingDoc ? 'Uploading…' : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          Upload document
                        </>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5 mt-3">Description <span className="text-gray-600 font-normal">— optional</span></label>
                    <input type="text" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Brief description of this document"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  </div>
                </div>
              )}

              {form.type === 'contact' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Full Name</label>
                    <input type="text" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder="e.g. Jane Smith"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Role / Department</label>
                    <input type="text" value={form.contactRole} onChange={e => setForm(f => ({ ...f, contactRole: e.target.value }))} placeholder="e.g. HR Director"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Phone <span className="text-gray-600 font-normal">— optional</span></label>
                      <input type="tel" value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="(555) 000-0000"
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Email <span className="text-gray-600 font-normal">— optional</span></label>
                      <input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="jane@company.com"
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                    </div>
                  </div>
                </div>
              )}

              {modalError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400">{modalError}</div>
              )}

              <div className="flex gap-3 pt-1">
                {modal === 'edit' && (
                  <button onClick={deleteResource} disabled={deleting || saving}
                    className="px-4 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/40 disabled:opacity-50 text-red-400 font-medium text-sm border border-red-600/30 transition-colors">
                    {deleting ? '…' : 'Delete'}
                  </button>
                )}
                <button onClick={() => setModal(null)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={saveResource} disabled={saving || uploadingDoc}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
                  {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Resource'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Resource card (for non-contact items + pinned) ──────────────────────────

function ResourceCard({
  resource, canManage, onEdit, onOpen, fmtDate, onTogglePin,
}: {
  resource: Resource
  canManage: boolean
  onEdit: () => void
  onOpen: () => void
  fmtDate: (ts: string) => string
  onTogglePin?: () => void
}) {
  const { type, title, body, url, filename, contact_name, contact_role, contact_phone, contact_email, contact_avatar_url, created_by_name, created_at } = resource

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 transition-all">
      <div className="flex items-start gap-3">
        {type === 'contact' && (
          <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center shrink-0 overflow-hidden mt-0.5">
            {contact_avatar_url ? (
              <img src={contact_avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <span className="text-gray-500 text-xs font-bold">{(contact_name || title).charAt(0).toUpperCase()}</span>
            )}
          </div>
        )}
        {type !== 'contact' && (
          <div className="text-xl shrink-0 mt-0.5">
            {type === 'announcement' ? '📢' : type === 'document' ? '📄' : '🔗'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {resource.is_pinned && (
                <svg className="w-3 h-3 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 4v6l2 2v2h-5v6l-1 1-1-1v-6H6v-2l2-2V4h-1V2h10v2h-1z"/>
                </svg>
              )}
              <p className="text-sm font-semibold text-white">{title}</p>
            </div>
            {canManage && (
              <div className="flex items-center gap-1.5 shrink-0">
                {onTogglePin && (
                  <button onClick={onTogglePin} title={resource.is_pinned ? 'Unpin' : 'Pin to top'}
                    className={`transition-colors ${resource.is_pinned ? 'text-amber-400 hover:text-amber-300' : 'text-gray-600 hover:text-amber-400'}`}>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16 4v6l2 2v2h-5v6l-1 1-1-1v-6H6v-2l2-2V4h-1V2h10v2h-1z"/>
                    </svg>
                  </button>
                )}
                <button onClick={onEdit} className="text-gray-600 hover:text-gray-300 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {body && <p className="text-sm text-gray-400 mt-1 leading-relaxed whitespace-pre-wrap">{body}</p>}

          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 mt-1.5 transition-colors">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {url.replace(/^https?:\/\//, '').split('/')[0]}
            </a>
          )}

          {filename && resource.s3_key && (
            <button onClick={onOpen}
              className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 mt-1.5 transition-colors">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {filename}
            </button>
          )}

          {contact_name && (
            <div className="mt-1.5 space-y-1">
              {contact_role && <p className="text-xs text-gray-500">{contact_role}</p>}
              <div className="flex flex-wrap gap-3">
                {contact_phone && (
                  <a href={`tel:${contact_phone}`} className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {contact_phone}
                  </a>
                )}
                {contact_email && (
                  <a href={`mailto:${contact_email}`} className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {contact_email}
                  </a>
                )}
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-700 mt-2">
            {created_by_name && <span>Added by {created_by_name} · </span>}{fmtDate(created_at)}
          </p>
        </div>
      </div>
    </div>
  )
}
