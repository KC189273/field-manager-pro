'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MODULE_GROUPS, type ModuleGroup } from '@/lib/modules'

interface Org {
  id: string; name: string; industry: string; status: string
  notes: string | null; contact_name: string | null; contact_email: string | null
  created_at: string; enabled_modules: number; user_count: number
}

interface OrgModule {
  slug: string; label: string; description: string; group: string; enabled: boolean
}

interface Template {
  id: string; name: string; description: string | null; industry: string | null; modules: string[]
}

interface OrgUser {
  id: string; username: string; full_name: string; email: string
  role: string; is_active: boolean; created_at: string
}

const ROLE_OPTIONS = [
  { value: 'shop_owner', label: 'Shop Owner' },
  { value: 'barber', label: 'Barber' },
  { value: 'owner', label: 'Owner' },
  { value: 'sales_director', label: 'Sales Director' },
  { value: 'ops_manager', label: 'Ops Manager' },
  { value: 'manager', label: 'Manager' },
  { value: 'employee', label: 'Employee' },
]

const INDUSTRIES = ['wireless_retail', 'barbershop', 'field_services', 'healthcare', 'hospitality', 'logistics', 'restaurant_qsr', 'property_management', 'other']
const INDUSTRY_LABELS: Record<string, string> = {
  wireless_retail: 'Wireless Retail', barbershop: 'Barbershop', field_services: 'Field Services', healthcare: 'Healthcare',
  hospitality: 'Hospitality', logistics: 'Logistics', restaurant_qsr: 'Restaurant/QSR',
  property_management: 'Property Mgmt', other: 'Other',
}
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-900/40 text-green-400', demo: 'bg-blue-900/40 text-blue-400', suspended: 'bg-red-900/40 text-red-400',
}

const EMPTY_FORM = { name: '', industry: 'wireless_retail', status: 'active', notes: '', contact_name: '', contact_email: '', template_id: '', clone_from_org_id: '' }

export default function SuperAdminPage() {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [modules, setModules] = useState<OrgModule[]>([])
  const [savingModule, setSavingModule] = useState<string | null>(null)

  // Users
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [userForm, setUserForm] = useState({ username: '', full_name: '', email: '', password: '', role: 'shop_owner' })
  const [userSaving, setUserSaving] = useState(false)
  const [userError, setUserError] = useState('')

  // Form
  const [showForm, setShowForm] = useState(false)
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Auth check
  useEffect(() => {
    fetch('/api/super-admin/orgs').then(r => {
      if (r.status === 404) { router.replace('/404'); return }
      if (!r.ok) { router.replace('/404'); return }
      setAuthorized(true)
    })
  }, [router])

  const loadOrgs = useCallback(async () => {
    const res = await fetch('/api/super-admin/orgs')
    if (res.ok) {
      const d = await res.json()
      setOrgs(d.orgs ?? [])
    }
  }, [])

  const loadTemplates = useCallback(async () => {
    const res = await fetch('/api/super-admin/templates')
    if (res.ok) {
      const d = await res.json()
      setTemplates(d.templates ?? [])
    }
  }, [])

  useEffect(() => {
    if (authorized) { loadOrgs(); loadTemplates() }
  }, [authorized, loadOrgs, loadTemplates])

  async function loadUsers(orgId: string) {
    const res = await fetch(`/api/super-admin/orgs/${orgId}/users`)
    if (res.ok) {
      const d = await res.json()
      setOrgUsers(d.users ?? [])
    }
  }

  async function selectOrg(orgId: string) {
    setSelectedOrgId(orgId)
    const res = await fetch(`/api/super-admin/orgs/${orgId}/modules`)
    if (res.ok) {
      const d = await res.json()
      setModules(d.modules ?? [])
    }
    loadUsers(orgId)
  }

  async function toggleModule(slug: string, enabled: boolean) {
    if (!selectedOrgId) return
    setSavingModule(slug)
    await fetch(`/api/super-admin/orgs/${selectedOrgId}/modules`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module_slug: slug, enabled }),
    })
    setModules(prev => prev.map(m => m.slug === slug ? { ...m, enabled } : m))
    // Update org list count
    setOrgs(prev => prev.map(o => o.id === selectedOrgId ? { ...o, enabled_modules: o.enabled_modules + (enabled ? 1 : -1) } : o))
    setTimeout(() => setSavingModule(null), 800)
  }

  async function applyTemplate(templateId: string) {
    if (!selectedOrgId) return
    const template = templates.find(t => t.id === templateId)
    if (!template) return
    if (!confirm(`Apply "${template.name}" to this org? This will overwrite all module toggles.`)) return

    const bulk = modules.map(m => ({ slug: m.slug, enabled: template.modules.includes(m.slug) }))
    await fetch(`/api/super-admin/orgs/${selectedOrgId}/modules`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules: bulk }),
    })
    await selectOrg(selectedOrgId)
    await loadOrgs()
  }

  function openAdd() {
    setEditingOrgId(null)
    setForm({ ...EMPTY_FORM })
    setFormError('')
    setShowForm(true)
  }

  function openEdit(org: Org) {
    setEditingOrgId(org.id)
    setForm({ name: org.name, industry: org.industry, status: org.status, notes: org.notes ?? '', contact_name: org.contact_name ?? '', contact_email: org.contact_email ?? '', template_id: '', clone_from_org_id: '' })
    setFormError('')
    setShowForm(true)
  }

  async function saveOrg() {
    if (!form.name.trim()) { setFormError('Name is required'); return }
    setSaving(true)
    setFormError('')
    try {
      if (editingOrgId) {
        await fetch(`/api/super-admin/orgs/${editingOrgId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      } else {
        await fetch('/api/super-admin/orgs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      setShowForm(false)
      await loadOrgs()
    } catch {
      setFormError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function suspendOrg(orgId: string) {
    if (!confirm('Suspend this organization? Users will retain data but the org will be marked inactive.')) return
    await fetch(`/api/super-admin/orgs/${orgId}`, { method: 'DELETE' })
    await loadOrgs()
  }

  async function createUser() {
    if (!selectedOrgId) return
    if (!userForm.username.trim() || !userForm.full_name.trim() || !userForm.password) {
      setUserError('Username, full name, and password are required')
      return
    }
    setUserSaving(true)
    setUserError('')
    try {
      const res = await fetch(`/api/super-admin/orgs/${selectedOrgId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setUserError(d.error ?? 'Failed to create user')
        return
      }
      setShowUserForm(false)
      setUserForm({ username: '', full_name: '', email: '', password: '', role: 'shop_owner' })
      loadUsers(selectedOrgId)
      loadOrgs()
    } catch {
      setUserError('Network error')
    } finally {
      setUserSaving(false)
    }
  }

  if (!authorized) return <div className="min-h-screen bg-gray-950" />

  const selectedOrg = orgs.find(o => o.id === selectedOrgId)
  const enabledCount = modules.filter(m => m.enabled).length

  const inputCls = 'w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500'

  return (
    <div className="flex flex-col lg:flex-row gap-0 min-h-[calc(100vh-49px)]">
      {/* Left: Org List */}
      <div className="lg:w-96 border-r border-slate-800 bg-slate-950 overflow-y-auto">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Organizations ({orgs.length})</h2>
          <button onClick={openAdd} className="text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-900/30 px-3 py-1.5 rounded-lg">+ Add New</button>
        </div>
        <div className="divide-y divide-slate-800">
          {orgs.map(org => (
            <div key={org.id} className={`px-4 py-3 cursor-pointer transition-colors ${selectedOrgId === org.id ? 'bg-slate-800' : 'hover:bg-slate-900'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-white">{org.name}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[org.status] ?? 'bg-gray-700 text-gray-400'}`}>{org.status.toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                <span>{INDUSTRY_LABELS[org.industry] ?? org.industry}</span>
                <span>·</span>
                <span>{org.enabled_modules}/28 modules</span>
                <span>·</span>
                <span>{org.user_count} users</span>
              </div>
              {org.contact_email && <p className="text-xs text-slate-600 truncate">{org.contact_email}</p>}
              <div className="flex gap-2 mt-2">
                <button onClick={() => selectOrg(org.id)} className="text-xs text-amber-400 hover:text-amber-300 font-semibold">Select</button>
                <button onClick={() => openEdit(org)} className="text-xs text-slate-400 hover:text-white font-semibold">Edit</button>
                {org.status !== 'suspended' && (
                  <button onClick={() => suspendOrg(org.id)} className="text-xs text-red-400 hover:text-red-300 font-semibold">Suspend</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Module Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedOrg ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-600 text-sm">Select an organization to manage modules</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-white">{selectedOrg.name}</h2>
                <p className="text-xs text-slate-500">{enabledCount} of {modules.length} modules enabled · {orgUsers.length} users</p>
              </div>
            </div>

            {/* Users Section */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">Users ({orgUsers.length})</h3>
                <button onClick={() => { setShowUserForm(true); setUserError(''); setUserForm({ username: '', full_name: '', email: '', password: '', role: selectedOrg.industry === 'barbershop' ? 'shop_owner' : 'owner' }) }}
                  className="text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-900/30 px-3 py-1.5 rounded-lg">+ Create User</button>
              </div>
              {orgUsers.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden mb-4">
                  {orgUsers.map(u => (
                    <div key={u.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-800/50 last:border-0">
                      <div>
                        <p className="text-sm text-white font-medium">{u.full_name}</p>
                        <p className="text-xs text-slate-500">{u.username} {u.email ? `· ${u.email}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
                          {u.role.replace('_', ' ').toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modules Section */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Modules</h3>
              <select onChange={e => { if (e.target.value) applyTemplate(e.target.value); e.target.value = '' }}
                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">Apply Template...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(MODULE_GROUPS as readonly string[]).map(group => {
                const groupModules = modules.filter(m => m.group === group)
                if (groupModules.length === 0) return null
                return (
                  <div key={group} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-800">
                      <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">{group}</p>
                    </div>
                    {groupModules.map(mod => (
                      <div key={mod.slug} className="flex items-center justify-between px-4 py-3 border-b border-slate-800/50 last:border-0">
                        <div className="flex-1 min-w-0 mr-3">
                          <p className="text-sm text-white font-medium">{mod.label}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{mod.description}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {savingModule === mod.slug && <span className="text-[10px] text-green-400 font-semibold">Saved</span>}
                          <button onClick={() => toggleModule(mod.slug, !mod.enabled)}
                            className={`w-11 h-6 rounded-full relative transition-colors ${mod.enabled ? 'bg-amber-500' : 'bg-slate-600'}`}>
                            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${mod.enabled ? 'left-5.5' : 'left-0.5'}`}
                              style={{ left: mod.enabled ? '22px' : '2px' }} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Create User Modal */}
      {showUserForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setShowUserForm(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white mb-4">Create User</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Username *</label>
                <input value={userForm.username} onChange={e => setUserForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') }))}
                  placeholder="e.g. john.doe" className={inputCls} autoFocus />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Full Name *</label>
                <input value={userForm.full_name} onChange={e => setUserForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="John Doe" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Email</label>
                <input type="email" value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="john@example.com" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Temporary Password *</label>
                <input value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="They'll change this on first login" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Role</label>
                <select value={userForm.role} onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))} className={inputCls}>
                  {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              {userError && <p className="text-sm text-red-400">{userError}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowUserForm(false)} className="flex-1 py-2.5 rounded-lg border border-slate-600 text-sm text-slate-400 hover:text-white">Cancel</button>
                <button onClick={createUser} disabled={userSaving} className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold text-sm">
                  {userSaving ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setShowForm(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white mb-4">{editingOrgId ? 'Edit Organization' : 'New Organization'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Organization Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Industry</label>
                  <select value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} className={inputCls}>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{INDUSTRY_LABELS[i]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inputCls}>
                    <option value="active">Active</option>
                    <option value="demo">Demo</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Contact Name</label>
                  <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Contact Email</label>
                  <input type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className={inputCls + ' resize-none'} />
              </div>
              {!editingOrgId && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Start from Template</label>
                    <select value={form.template_id} onChange={e => setForm(f => ({ ...f, template_id: e.target.value, clone_from_org_id: '' }))} className={inputCls}>
                      <option value="">None</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Clone From Org</label>
                    <select value={form.clone_from_org_id} onChange={e => setForm(f => ({ ...f, clone_from_org_id: e.target.value, template_id: '' }))} className={inputCls}>
                      <option value="">None</option>
                      {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {formError && <p className="text-sm text-red-400">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-lg border border-slate-600 text-sm text-slate-400 hover:text-white">Cancel</button>
                <button onClick={saveOrg} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold text-sm">
                  {saving ? 'Saving...' : editingOrgId ? 'Save Changes' : 'Create Organization'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
