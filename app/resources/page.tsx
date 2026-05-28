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

const TYPE_SECTIONS: { type: ResourceType; heading: string; description: string }[] = [
  { type: 'announcement', heading: 'Announcements',      description: 'Company-wide updates and news' },
  { type: 'document',     heading: 'Documents',          description: 'Handbooks, SOPs, and training files' },
  { type: 'link',         heading: 'Links & Resources',  description: 'Important URLs and reference links' },
  { type: 'contact',      heading: 'Key Contacts',       description: 'Important people and numbers' },
]

export default function ResourcesPage() {
  const [session, setSession]     = useState<Session | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

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
      const res = await fetch('/api/resources')
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

  const canManage = session ? CAN_MANAGE.includes(session.role) : false

  // ── File upload ──
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

  // ── Open doc ──
  async function openDocument(resource: Resource) {
    if (!resource.s3_key) return
    // Use calendar attachment-url pattern for view URL — but resources has own key prefix
    // We'll fetch a signed URL from a generic approach via resources API
    const res = await fetch(`/api/resources/view-url?key=${encodeURIComponent(resource.s3_key)}`)
    if (res.ok) {
      const { url } = await res.json()
      window.open(url, '_blank')
    }
  }

  // ── Modal helpers ──
  function openAdd(type: ResourceType = 'announcement') {
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
        type: form.type,
        title: form.title.trim(),
        body: form.body.trim() || null,
        url: form.url.trim() || null,
        s3Key: form.s3Key || null,
        filename: form.filename || null,
        contactName: form.contactName.trim() || null,
        contactRole: form.contactRole.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
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

  // ── Drag-and-drop reorder ──
  function handleDrop(droppedOnId: string, type: ResourceType) {
    if (!draggedId || draggedId === droppedOnId) { setDraggedId(null); setDragOverId(null); return }
    const sectionItems = resources.filter(r => r.type === type)
    const draggedIdx   = sectionItems.findIndex(r => r.id === draggedId)
    const targetIdx    = sectionItems.findIndex(r => r.id === droppedOnId)
    if (draggedIdx === -1 || targetIdx === -1) { setDraggedId(null); setDragOverId(null); return }

    const reordered = [...sectionItems]
    const [moved] = reordered.splice(draggedIdx, 1)
    reordered.splice(targetIdx, 0, moved)

    // Apply new sort_orders optimistically
    const updated = reordered.map((r, i) => ({ ...r, sort_order: i }))
    setResources(prev => prev.map(r => updated.find(u => u.id === r.id) ?? r))
    setDraggedId(null)
    setDragOverId(null)

    // Persist
    fetch('/api/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reorder: updated.map(r => ({ id: r.id, sort_order: r.sort_order })) }),
    }).catch(() => loadResources())
  }

  async function togglePin(resource: Resource) {
    const action = resource.is_pinned ? 'unpin' : 'pin'
    if (!resource.is_pinned) {
      const pinned = resources.filter(r => r.is_pinned)
      if (pinned.length >= 4) {
        alert('Maximum 4 items can be pinned. Unpin one first.')
        return
      }
    }
    // Optimistic update
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
            <button
              onClick={() => openAdd()}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shrink-0"
            >
              <span className="text-base leading-none">+</span>
              <span>Add</span>
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search resources…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-2xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-600"
          />
        </div>

        {/* ── Pinned section ── */}
        {!loading && !search && resources.some(r => r.is_pinned) && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 4v6l2 2v2h-5v6l-1 1-1-1v-6H6v-2l2-2V4h-1V2h10v2h-1z"/>
              </svg>
              <h2 className="text-sm font-bold text-white">Pinned</h2>
            </div>
            <div className="space-y-2">
              {resources.filter(r => r.is_pinned).map(r => (
                <ResourceCard
                  key={`pin-${r.id}`}
                  resource={r}
                  canManage={canManage}
                  canReorder={false}
                  onEdit={() => openEdit(r)}
                  onOpen={() => openDocument(r)}
                  fmtDate={fmtDate}
                  onTogglePin={canManage ? () => togglePin(r) : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-gray-800 rounded w-40 mb-2" />
                <div className="h-3 bg-gray-800 rounded w-64" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 && search ? (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No results for &quot;{search}&quot;</p>
          </div>
        ) : (
          <div className="space-y-6">
            {TYPE_SECTIONS.map(section => {
              const items = byType(section.type)
              if (items.length === 0 && !canManage) return null

              return (
                <div key={section.type}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h2 className="text-sm font-bold text-white">{section.heading}</h2>
                      <p className="text-xs text-gray-600">{section.description}</p>
                    </div>
                    {canManage && (
                      <button
                        onClick={() => openAdd(section.type)}
                        className="text-xs text-violet-400 hover:text-violet-300 font-medium border border-violet-800/40 hover:border-violet-600/60 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        + Add
                      </button>
                    )}
                  </div>

                  {items.length === 0 ? (
                    <div className="bg-gray-900/50 border border-dashed border-gray-800 rounded-2xl px-4 py-6 text-center">
                      <p className="text-sm text-gray-600">No {section.heading.toLowerCase()} yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {items.map(r => (
                        <ResourceCard
                          key={r.id}
                          resource={r}
                          canManage={canManage}
                          canReorder={canManage && !search}
                          isDragging={draggedId === r.id}
                          isDragOver={dragOverId === r.id}
                          onEdit={() => openEdit(r)}
                          onOpen={() => openDocument(r)}
                          fmtDate={fmtDate}
                          onTogglePin={canManage ? () => togglePin(r) : undefined}
                          onDragStart={() => setDraggedId(r.id)}
                          onDragOver={e => { e.preventDefault(); setDragOverId(r.id) }}
                          onDragLeave={() => setDragOverId(null)}
                          onDrop={() => handleDrop(r.id, section.type)}
                          onDragEnd={() => { setDraggedId(null); setDragOverId(null) }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 p-5 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">
                {modal === 'edit' ? 'Edit Resource' : 'New Resource'}
              </h2>
              <button onClick={() => setModal(null)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Type selector */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {TYPE_OPTS.map(t => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, type: t.key }))}
                      className={`flex items-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl border transition-colors ${
                        form.type === t.key
                          ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder={
                    form.type === 'announcement' ? 'e.g. Q2 Policy Update' :
                    form.type === 'document' ? 'e.g. Employee Handbook' :
                    form.type === 'link' ? 'e.g. Payroll Portal' :
                    'e.g. HR Contact'
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
                  autoFocus
                />
              </div>

              {/* Body / description */}
              {(form.type === 'announcement' || form.type === 'link') && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">
                    {form.type === 'announcement' ? 'Message' : 'Description'}{' '}
                    <span className="text-gray-600 font-normal">— optional</span>
                  </label>
                  <textarea
                    rows={form.type === 'announcement' ? 4 : 2}
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    placeholder={form.type === 'announcement' ? 'Write your announcement…' : 'Brief description of this link'}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
                  />
                </div>
              )}

              {/* URL */}
              {form.type === 'link' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">URL</label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                    placeholder="https://…"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
                  />
                </div>
              )}

              {/* Document upload */}
              {form.type === 'document' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">File</label>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleDocFile} />
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
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingDoc}
                      className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 rounded-xl px-4 py-3 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 w-full justify-center"
                    >
                      {uploadingDoc ? 'Uploading…' : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          Upload document
                        </>
                      )}
                    </button>
                  )}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5 mt-3">Description <span className="text-gray-600 font-normal">— optional</span></label>
                    <input
                      type="text"
                      value={form.body}
                      onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                      placeholder="Brief description of this document"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              )}

              {/* Contact fields */}
              {form.type === 'contact' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Full Name</label>
                    <input type="text" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
                      placeholder="e.g. Jane Smith"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Role / Department</label>
                    <input type="text" value={form.contactRole} onChange={e => setForm(f => ({ ...f, contactRole: e.target.value }))}
                      placeholder="e.g. HR Director"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Phone <span className="text-gray-600 font-normal">— optional</span></label>
                      <input type="tel" value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
                        placeholder="(555) 000-0000"
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Email <span className="text-gray-600 font-normal">— optional</span></label>
                      <input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
                        placeholder="jane@company.com"
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
                  <button
                    onClick={deleteResource}
                    disabled={deleting || saving}
                    className="px-4 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/40 disabled:opacity-50 text-red-400 font-medium text-sm border border-red-600/30 transition-colors"
                  >
                    {deleting ? '…' : 'Delete'}
                  </button>
                )}
                <button onClick={() => setModal(null)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button
                  onClick={saveResource}
                  disabled={saving || uploadingDoc}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
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

// ── Resource card ──────────────────────────────────────────────────────────────

function ResourceCard({
  resource, canManage, canReorder, isDragging, isDragOver,
  onEdit, onOpen, fmtDate, onTogglePin,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}: {
  resource: Resource
  canManage: boolean
  canReorder?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onEdit: () => void
  onOpen: () => void
  fmtDate: (ts: string) => string
  onTogglePin?: () => void
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: () => void
  onDrop?: () => void
  onDragEnd?: () => void
}) {
  const { type, title, body, url, filename, contact_name, contact_role, contact_phone, contact_email, created_by_name, created_at } = resource

  return (
    <div
      draggable={canReorder}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`bg-gray-900 border rounded-2xl p-4 transition-all ${
        isDragOver ? 'border-violet-500 bg-gray-800/80' :
        isDragging  ? 'border-gray-700 opacity-40' :
        'border-gray-800'
      }`}
    >
      <div className="flex items-start gap-3">
        {canReorder && (
          <div className="text-gray-600 shrink-0 mt-1 cursor-grab active:cursor-grabbing touch-none select-none">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
            </svg>
          </div>
        )}
        <div className="text-xl shrink-0 mt-0.5">
          {type === 'announcement' ? '📢' : type === 'document' ? '📄' : type === 'link' ? '🔗' : '👤'}
        </div>
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
                  <button
                    onClick={onTogglePin}
                    title={resource.is_pinned ? 'Unpin' : 'Pin to top'}
                    className={`transition-colors ${resource.is_pinned ? 'text-amber-400 hover:text-amber-300' : 'text-gray-600 hover:text-amber-400'}`}
                  >
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

          {/* Announcement / doc description */}
          {body && <p className="text-sm text-gray-400 mt-1 leading-relaxed whitespace-pre-wrap">{body}</p>}

          {/* Link */}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 mt-1.5 transition-colors">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {url.replace(/^https?:\/\//, '').split('/')[0]}
            </a>
          )}

          {/* Document download */}
          {filename && resource.s3_key && (
            <button onClick={onOpen}
              className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 mt-1.5 transition-colors">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {filename}
            </button>
          )}

          {/* Contact */}
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
            {created_by_name ? `Added by ${created_by_name} · ` : ''}{fmtDate(created_at)}
          </p>
        </div>
      </div>
    </div>
  )
}
