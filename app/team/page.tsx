'use client'

import { useState, useEffect, useRef, FormEvent, ChangeEvent } from 'react'
import NavBar from '@/components/NavBar'

interface Org { id: string; name: string }

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface User {
  id: string
  username: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  is_floater: boolean
  is_ops_collab: boolean
  manager_id: string | null
  approval_status: string | null
  created_by: string | null
  avatar_url: string | null
  temp_password: string | null
  must_change_password: boolean | null
  pay_type: 'salary' | 'hourly'
}

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  manager: 'DM',
  ops_manager: 'Ops Manager',
  owner: 'Owner',
  sales_director: 'Sales Director',
  developer: 'Developer',
}

const emptyForm = { username: '', email: '', fullName: '', password: '', role: 'employee', managerId: '' }
const emptyEdit = { password: '', requirePasswordChange: true, fullName: '', email: '', isActive: true, managerId: '', role: '', orgId: '', payType: 'hourly' as 'salary' | 'hourly', isFloater: false, isOpsCollab: false }

export default function TeamPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [orgs, setOrgs] = useState<Org[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [createFor, setCreateFor] = useState<'employee' | 'manager'>('employee')
  const [editUser, setEditUser] = useState<User | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editForm, setEditForm] = useState(emptyEdit)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' }>({ text: '', type: 'success' })
  const [storePanel, setStorePanel] = useState<string | null>(null) // manager id whose panel is open
  const [allLocations, setAllLocations] = useState<{ id: string; address: string; active: boolean }[]>([])
  const [assignedStoreIds, setAssignedStoreIds] = useState<Set<string>>(new Set())
  const [savingStores, setSavingStores] = useState(false)

  // Bulk import state
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [bulkOrgId, setBulkOrgId] = useState('')
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResults, setBulkResults] = useState<{ created: number; errors: number; results: { row: number; username: string; fullName: string; status: 'created' | 'error'; reason?: string }[] } | null>(null)
  const bulkFileRef = useRef<HTMLInputElement>(null)

  const [terminateUser, setTerminateUser] = useState<User | null>(null)
  const [terminateReasons, setTerminateReasons] = useState('')
  const [terminateSaving, setTerminateSaving] = useState(false)
  const [terminateError, setTerminateError] = useState('')

  const [roleFilter, setRoleFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list')
  const [treeSelected, setTreeSelected] = useState<User | null>(null)
  const [showCreatePw, setShowCreatePw] = useState(false)
  const [showTempPw, setShowTempPw] = useState(false)

  const isDev = session?.role === 'developer'
  const isOwner = session?.role === 'owner' || session?.role === 'sales_director'
  const isDevOrOwner = isDev || isOwner
  const canManageAll = isDevOrOwner || session?.role === 'ops_manager'
  const canBulkImport = isDev || isOwner || session?.role === 'ops_manager'
  const managers = users.filter(u => u.role === 'manager' || u.role === 'ops_manager' || u.role === 'owner' || u.role === 'sales_director')
  const employees = users.filter(u => u.role === 'employee')

  const pendingUsers = users.filter(u => u.approval_status === 'pending')
  const activeUsers = users.filter(u => u.approval_status !== 'pending')
  const activeMgrs = activeUsers.filter(u => u.role === 'manager' || u.role === 'ops_manager' || u.role === 'owner' || u.role === 'sales_director')
  const activeEmps = activeUsers.filter(u => u.role === 'employee')
  const allUsersOrdered = [...activeMgrs, ...activeEmps]
  const presentRoles = Array.from(new Set(allUsersOrdered.map(u => u.role)))
  const searchFiltered = searchQuery.trim()
    ? allUsersOrdered.filter(u =>
        u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.username.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allUsersOrdered
  const filteredUsers = roleFilter === 'all' ? searchFiltered : searchFiltered.filter(u => u.role === roleFilter)

  async function loadUsers() {
    const res = await fetch('/api/team/users')
    if (res.ok) {
      const data = await res.json()
      setUsers(data.users)
    }
  }

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      setSession(s)
      if (s?.role === 'developer') {
        fetch('/api/orgs').then(r => r.json()).then(d => setOrgs(d.orgs ?? []))
      }
    })
    loadUsers()
  }, [])

  function showMsg(text: string, type: 'success' | 'error' = 'success') {
    setMessage({ text, type })
    setTimeout(() => setMessage({ text: '', type: 'success' }), 4000)
  }

  function fullName(role: string) { return ROLE_LABELS[role] ?? 'User' }

  async function approveUser(userId: string, action: 'approve' | 'reject') {
    const res = await fetch('/api/team/users/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action }),
    })
    const data = await res.json()
    if (res.ok) {
      showMsg(action === 'approve'
        ? 'Employee approved — welcome email sent with login credentials.'
        : 'Employee rejected and removed.')
      await loadUsers()
    } else {
      showMsg(data.error || 'Action failed', 'error')
    }
  }

  function openCreate(type: 'employee' | 'manager') {
    setCreateFor(type)
    setForm({ ...emptyForm, role: type === 'manager' ? 'manager' : 'employee' })
    setShowCreate(true)
    setEditUser(null)
  }

  function openEdit(user: User) {
    setEditUser(user)
    setEditForm({ password: '', requirePasswordChange: true, fullName: user.full_name, email: user.email, isActive: user.is_active, managerId: user.manager_id ?? '', role: user.role, orgId: (user as User & { org_id?: string }).org_id ?? '', payType: user.pay_type ?? 'hourly', isFloater: user.is_floater ?? false, isOpsCollab: user.is_ops_collab ?? false })
    setShowCreate(false)
    setShowTempPw(false)
  }

  async function createUser(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/team/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, managerId: form.managerId || undefined }),
    })
    const data = await res.json()
    setLoading(false)
    if (res.ok) {
      showMsg(data.pending
        ? `${fullName(form.role)} submitted for approval — they'll receive login details once approved.`
        : `${fullName(form.role)} created successfully`)
      setShowCreate(false)
      setForm(emptyForm)
      await loadUsers()
    } else {
      showMsg(data.error || 'Failed to create user', 'error')
    }
  }

  async function updateUser(e: FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setLoading(true)
    const body: Record<string, unknown> = { userId: editUser.id, isActive: editForm.isActive }
    if (editForm.password) {
      body.password = editForm.password
      body.mustChangePassword = editForm.requirePasswordChange
    }
    if (editForm.fullName !== editUser.full_name) body.fullName = editForm.fullName
    if (editForm.email !== editUser.email) body.email = editForm.email
    if (editForm.role !== editUser.role) body.role = editForm.role
    if (editForm.role !== 'developer' && editForm.role !== 'owner') body.managerId = editForm.managerId || null
    if (isDev) body.orgId = editForm.orgId || null
    if (editForm.payType !== (editUser.pay_type ?? 'hourly')) body.payType = editForm.payType
    if (editUser.role === 'employee' && editForm.isFloater !== (editUser.is_floater ?? false)) body.isFloater = editForm.isFloater
    if (editUser.role === 'manager' && editForm.isOpsCollab !== (editUser.is_ops_collab ?? false)) body.isOpsCollab = editForm.isOpsCollab

    const res = await fetch('/api/team/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setLoading(false)
    if (res.ok) {
      showMsg('User updated')
      setEditUser(null)
      await loadUsers()
    } else {
      const data = await res.json()
      showMsg(data.error || 'Update failed', 'error')
    }
  }

  async function toggleActive(user: User) {
    await fetch('/api/team/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, isActive: !user.is_active }),
    })
    showMsg(user.is_active ? `${user.full_name} deactivated` : `${user.full_name} reactivated`)
    await loadUsers()
  }

  async function deleteUser(user: User) {
    setLoading(true)
    const res = await fetch('/api/team/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    })
    setLoading(false)
    setConfirmDelete(null)
    if (res.ok) {
      showMsg(`${user.full_name} permanently deleted`)
      await loadUsers()
    } else {
      const data = await res.json()
      showMsg(data.error || 'Delete failed', 'error')
    }
  }

  async function handleTerminate() {
    if (!terminateUser || !terminateReasons.trim()) {
      setTerminateError('Please enter the reasons for termination.')
      return
    }
    setTerminateSaving(true)
    setTerminateError('')
    const res = await fetch('/api/accountability/termination', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: terminateUser.id, reasons: terminateReasons.trim() }),
    })
    setTerminateSaving(false)
    if (res.ok) {
      setTerminateUser(null)
      setTerminateReasons('')
      showMsg(`Termination request submitted for ${terminateUser.full_name}. Awaiting SD/Owner approval.`)
    } else {
      const d = await res.json()
      setTerminateError(d.error ?? 'Failed to submit termination request.')
    }
  }

  async function openStorePanel(managerId: string) {
    if (storePanel === managerId) { setStorePanel(null); return }
    setStorePanel(managerId)
    // Load all locations + current assignments in parallel
    const [locRes, assignRes] = await Promise.all([
      fetch('/api/dm-store-locations').then(r => r.json()),
      fetch(`/api/dm-manager-stores?managerId=${managerId}`).then(r => r.json()),
    ])
    setAllLocations(locRes.locations ?? [])
    setAssignedStoreIds(new Set(assignRes.storeIds ?? []))
  }

  function toggleStoreAssignment(storeId: string) {
    setAssignedStoreIds(prev => {
      const next = new Set(prev)
      if (next.has(storeId)) next.delete(storeId)
      else next.add(storeId)
      return next
    })
  }

  async function saveStoreAssignments() {
    if (!storePanel) return
    setSavingStores(true)
    await fetch('/api/dm-manager-stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId: storePanel, storeIds: [...assignedStoreIds] }),
    })
    setSavingStores(false)
    showMsg('Store assignments saved')
    setStorePanel(null)
  }

  function getManagerName(managerId: string | null): string {
    if (!managerId) return 'Unassigned'
    const mgr = users.find(u => u.id === managerId)
    return mgr?.full_name ?? 'Unknown'
  }

  async function submitBulkImport() {
    if (!bulkFile) return
    setBulkLoading(true)
    setBulkResults(null)
    const fd = new FormData()
    fd.append('file', bulkFile)
    if (bulkOrgId) fd.append('orgId', bulkOrgId)
    const res = await fetch('/api/team/bulk-import', { method: 'POST', body: fd })
    const data = await res.json()
    setBulkLoading(false)
    if (res.ok) {
      setBulkResults(data)
      await loadUsers()
    } else {
      showMsg(data.error || 'Import failed', 'error')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className={`px-4 pt-6 ${viewMode === 'tree' ? '' : 'max-w-lg mx-auto'}`}>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Team</h1>
          {canBulkImport && (
            <button
              onClick={() => { setShowBulkImport(true); setBulkResults(null); setBulkFile(null) }}
              className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors"
            >
              Bulk Import
            </button>
          )}
        </div>

        {/* Toast message */}
        {message.text && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
            message.type === 'error'
              ? 'bg-red-900/40 border border-red-700 text-red-300'
              : 'bg-green-900/40 border border-green-700 text-green-300'
          }`}>
            {message.text}
          </div>
        )}

        {/* Bulk import modal */}
        {showBulkImport && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">Bulk Import Employees</h2>
              <button onClick={() => setShowBulkImport(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕ Close</button>
            </div>

            <div className="bg-gray-800/60 rounded-xl px-4 py-3 text-xs text-gray-400 space-y-1">
              <p className="font-semibold text-gray-300 mb-1">Excel format (columns in order):</p>
              <p><span className="text-white font-medium">A</span> — Full Name (required)</p>
              <p><span className="text-white font-medium">B</span> — Username (required)</p>
              <p><span className="text-white font-medium">C</span> — Password (optional, defaults to <span className="text-violet-300 font-medium">Metro</span>)</p>
              <p><span className="text-white font-medium">D</span> — Manager Name (optional, must match a manager in this org)</p>
              <p className="text-gray-500 mt-1">Row 1 is treated as a header and skipped automatically.</p>
            </div>

            {isDev && orgs.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Organization</label>
                <select value={bulkOrgId} onChange={e => setBulkOrgId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="">No org (unassigned)</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Excel File (.xlsx)</label>
              <input
                ref={bulkFileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={e => { setBulkFile(e.target.files?.[0] ?? null); setBulkResults(null) }}
                className="w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-violet-600 file:text-white hover:file:bg-violet-500 file:cursor-pointer cursor-pointer"
              />
            </div>

            {!bulkResults && (
              <div className="flex gap-2">
                <button
                  onClick={submitBulkImport}
                  disabled={bulkLoading || !bulkFile}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {bulkLoading ? 'Importing…' : 'Import'}
                </button>
                <button onClick={() => setShowBulkImport(false)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                  Cancel
                </button>
              </div>
            )}

            {bulkResults && (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1 bg-green-900/30 border border-green-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-2xl font-bold text-green-400">{bulkResults.created}</p>
                    <p className="text-xs text-green-600">Created</p>
                  </div>
                  <div className="flex-1 bg-red-900/30 border border-red-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-2xl font-bold text-red-400">{bulkResults.errors}</p>
                    <p className="text-xs text-red-600">Errors</p>
                  </div>
                </div>

                {bulkResults.errors > 0 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Failed rows</p>
                    {bulkResults.results.filter(r => r.status === 'error').map(r => (
                      <div key={r.row} className="bg-red-950/40 border border-red-900/50 rounded-xl px-3 py-2">
                        <p className="text-xs text-white font-medium">{r.fullName || r.username} <span className="text-gray-500">(@{r.username})</span></p>
                        <p className="text-xs text-red-400 mt-0.5">{r.reason}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => { setBulkResults(null); setBulkFile(null); if (bulkFileRef.current) bulkFileRef.current.value = '' }}
                    className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                  >
                    Import Another File
                  </button>
                  <button onClick={() => setShowBulkImport(false)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <form onSubmit={createUser} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-5 space-y-3">
            <h2 className="font-semibold text-white">Add User</h2>
            <input required placeholder="Full name" value={form.fullName}
              onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input required placeholder="Username" value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input required placeholder="Email" type="email" value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <div className="relative">
              <input required placeholder="Temporary password" type={showCreatePw ? 'text' : 'password'} value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 pr-16 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <button type="button" onClick={() => setShowCreatePw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400 hover:text-gray-200 transition-colors">
                {showCreatePw ? 'Hide' : 'Show'}
              </button>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                <option value="employee">Employee</option>
                <option value="manager">DM</option>
                {(isDev || isOwner) && <option value="ops_manager">Ops Manager</option>}
                {(isDev || isOwner) && <option value="sales_director">Sales Director</option>}
                {isDev && <option value="owner">Owner</option>}
              </select>
            </div>
            {canManageAll && managers.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Assigned Manager</label>
                <select value={form.managerId} onChange={e => setForm(p => ({ ...p, managerId: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="">No manager assigned</option>
                  {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={loading}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {loading ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Edit form — modal overlay */}
        {editUser && (
          <div className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end" onClick={() => setEditUser(null)}>
            <div className="bg-gray-900 rounded-t-3xl border-t border-gray-800 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-gray-700 rounded-full" />
              </div>
              <form onSubmit={updateUser} className="px-5 pb-8 pt-3 space-y-3">
                <h2 className="font-semibold text-white mb-1">Edit — {editUser.full_name}</h2>
                <input placeholder="Full name" value={editForm.fullName}
                  onChange={e => setEditForm(p => ({ ...p, fullName: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                <input placeholder="Email" type="email" value={editForm.email}
                  onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                {editUser.temp_password && (
                  <div className="bg-amber-950/30 border border-amber-700/50 rounded-xl px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-amber-400">Temporary Password</p>
                      <button type="button" onClick={() => setShowTempPw(p => !p)}
                        className="text-xs font-semibold text-gray-400 hover:text-gray-200 transition-colors">
                        {showTempPw ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p className="text-sm font-mono text-white tracking-wide">
                      {showTempPw ? editUser.temp_password : '••••••••••••'}
                    </p>
                    <p className="text-xs text-amber-600">Employee must change this on first login</p>
                  </div>
                )}
                <div className="space-y-2">
                  <input placeholder="Reset password (leave blank to keep)" type="password" value={editForm.password}
                    onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  {editForm.password && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={editForm.requirePasswordChange}
                        onChange={e => setEditForm(p => ({ ...p, requirePasswordChange: e.target.checked }))}
                        className="w-4 h-4 rounded accent-violet-500"
                      />
                      <span className="text-xs text-gray-400">Require password change on next login</span>
                    </label>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Role</label>
                  <select value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="employee">Employee</option>
                    <option value="manager">DM</option>
                    <option value="ops_manager">Ops Manager</option>
                    {(isDev || isOwner) && <option value="sales_director">Sales Director</option>}
                    {isDev && <option value="owner">Owner</option>}
                  </select>
                  {editForm.role !== editUser.role && (editForm.role === 'manager' || editForm.role === 'ops_manager') && (
                    <p className="text-xs text-amber-400 mt-1">This user will need to sign out and back in to see their new access.</p>
                  )}
                </div>
                {editUser.role === 'employee' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Floater Status</label>
                    <button
                      type="button"
                      onClick={() => setEditForm(p => ({ ...p, isFloater: !p.isFloater }))}
                      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border transition-colors ${
                        editForm.isFloater
                          ? 'bg-sky-600/15 border-sky-500'
                          : 'bg-gray-800 border-gray-700'
                      }`}
                    >
                      <div className={`w-10 h-5 rounded-full relative flex-shrink-0 transition-colors ${editForm.isFloater ? 'bg-sky-500' : 'bg-gray-600'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${editForm.isFloater ? 'left-5' : 'left-0.5'}`} />
                      </div>
                      <span className={`text-sm font-medium ${editForm.isFloater ? 'text-sky-400' : 'text-gray-400'}`}>
                        {editForm.isFloater ? 'Floater — available across districts' : 'Not a floater'}
                      </span>
                    </button>
                    {editForm.isFloater && (
                      <p className="text-xs text-gray-500 mt-1">This employee can be scheduled and assigned tasks by any DM in the org.</p>
                    )}
                  </div>
                )}
                {editUser.role === 'manager' && canManageAll && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Ops Collaborator</label>
                    <button
                      type="button"
                      onClick={() => setEditForm(p => ({ ...p, isOpsCollab: !p.isOpsCollab }))}
                      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border transition-colors ${
                        editForm.isOpsCollab
                          ? 'bg-violet-600/15 border-violet-500'
                          : 'bg-gray-800 border-gray-700'
                      }`}
                    >
                      <div className={`w-10 h-5 rounded-full relative flex-shrink-0 transition-colors ${editForm.isOpsCollab ? 'bg-violet-500' : 'bg-gray-600'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${editForm.isOpsCollab ? 'left-5' : 'left-0.5'}`} />
                      </div>
                      <span className={`text-sm font-medium ${editForm.isOpsCollab ? 'text-violet-400' : 'text-gray-400'}`}>
                        {editForm.isOpsCollab ? 'Ops Collaborator — sees all org tickets' : 'Standard DM visibility'}
                      </span>
                    </button>
                    {editForm.isOpsCollab && (
                      <p className="text-xs text-gray-500 mt-1">This DM will see all facility, supply, and merch requests org-wide and receive submission notifications.</p>
                    )}
                  </div>
                )}
                {canManageAll && editForm.role !== 'developer' && editForm.role !== 'owner' && managers.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Assigned Manager</label>
                    <select value={editForm.managerId}
                      onChange={e => setEditForm(p => ({ ...p, managerId: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                      <option value="">Unassigned</option>
                      {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                  </div>
                )}
                {isDev && orgs.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Organization</label>
                    <select value={editForm.orgId}
                      onChange={e => setEditForm(p => ({ ...p, orgId: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                      <option value="">Unassigned</option>
                      {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Pay Type</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditForm(p => ({ ...p, payType: 'hourly' }))}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${editForm.payType === 'hourly' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      Hourly
                    </button>
                    <button type="button" onClick={() => setEditForm(p => ({ ...p, payType: 'salary' }))}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${editForm.payType === 'salary' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      Salary
                    </button>
                  </div>
                  {editForm.payType === 'salary' && (
                    <p className="text-xs text-gray-500 mt-1">Salary employees won&apos;t be flagged for overtime or scheduling hour limits.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={loading}
                    className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                    {loading ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button type="button" onClick={() => setEditUser(null)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {/* Terminate modal */}
        {terminateUser && (
          <div className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end" onClick={() => setTerminateUser(null)}>
            <div className="bg-gray-900 rounded-t-3xl border-t border-gray-800 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-gray-700 rounded-full" />
              </div>
              <div className="px-5 pb-8 pt-3">
                <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-0.5">Initiate Termination</p>
                <p className="font-semibold text-white mb-1">{terminateUser.full_name}</p>
                <p className="text-xs text-gray-500 mb-4">
                  This will submit a termination request requiring approval from a Sales Director or Owner before any action is taken. If denied, it will be logged on record.
                </p>
                {terminateError && <p className="text-sm text-red-400 mb-3">{terminateError}</p>}
                <label className="block text-xs text-gray-500 mb-1.5">Reason(s) for Termination</label>
                <textarea
                  value={terminateReasons}
                  onChange={e => setTerminateReasons(e.target.value)}
                  rows={5}
                  placeholder="Describe the reasons for termination…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none mb-4"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleTerminate}
                    disabled={terminateSaving || !terminateReasons.trim()}
                    className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                  >
                    {terminateSaving ? 'Submitting…' : 'Submit for Approval'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTerminateUser(null)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {confirmDelete && (
          <div className="bg-red-950 border border-red-800 rounded-2xl p-5 mb-5">
            <p className="text-white font-semibold mb-1">Permanently delete {confirmDelete.full_name}?</p>
            <p className="text-red-400 text-sm mb-4">This cannot be undone. All shifts and history will be deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => deleteUser(confirmDelete)} disabled={loading}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {loading ? 'Deleting…' : 'Yes, Delete'}
              </button>
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* PENDING APPROVAL SECTION — visible to approvers */}
        {canManageAll && pendingUsers.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Pending Approval</p>
              <span className="bg-amber-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">{pendingUsers.length}</span>
            </div>
            <div className="space-y-2">
              {pendingUsers.map(user => {
                const addedBy = users.find(u => u.id === user.created_by)
                return (
                  <div key={user.id} className="bg-amber-950/30 border border-amber-800/50 rounded-2xl px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium">{user.full_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">@{user.username} · {user.email}</p>
                        {addedBy && (
                          <p className="text-xs text-amber-500/80 mt-1">Added by {addedBy.full_name}</p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-shrink-0 mt-0.5">
                        <button
                          onClick={() => approveUser(user.id, 'approve')}
                          className="bg-green-700 hover:bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => approveUser(user.id, 'reject')}
                          className="bg-gray-800 hover:bg-red-900 text-red-400 hover:text-red-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* DEVELOPER / OWNER / OPS MANAGER VIEW */}
        {canManageAll && (
          <>
            {/* Search */}
            <div className="mb-3">
              <input
                type="search"
                placeholder="Search by name or username…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-violet-600"
              />
            </div>

            <div className="flex items-center justify-between mb-4 gap-2">
              {viewMode === 'list' ? (
                /* Role filter pills */
                <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                  <button
                    onClick={() => setRoleFilter('all')}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      roleFilter === 'all'
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                  >
                    All
                  </button>
                  {presentRoles.map(role => (
                    <button
                      key={role}
                      onClick={() => setRoleFilter(role)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                        roleFilter === role
                          ? 'bg-violet-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                      }`}
                    >
                      {ROLE_LABELS[role] ?? role}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-1">Org Chart</p>
              )}
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* View toggle */}
                <div className="flex bg-gray-800 rounded-lg p-0.5">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                      viewMode === 'list' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    List
                  </button>
                  <button
                    onClick={() => setViewMode('tree')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                      viewMode === 'tree' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    Org Chart
                  </button>
                </div>
                <button onClick={() => { setForm({ ...emptyForm, role: 'employee' }); setShowCreate(true); setEditUser(null) }}
                  className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors">
                  + Add User
                </button>
              </div>
            </div>

            {viewMode === 'list' ? (
              filteredUsers.length === 0 ? (
                <p className="text-gray-600 text-sm py-3">No users found</p>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map(user => (
                    <div key={user.id}>
                      <UserCard
                        user={user}
                        subtitle={user.role === 'employee'
                          ? `Employee · Under: ${getManagerName(user.manager_id)} · ${user.pay_type === 'salary' ? 'Salary · ' : ''}${user.email}`
                          : `${ROLE_LABELS[user.role]}${user.pay_type === 'salary' ? ' · Salary' : ''} · ${user.email}`}
                        onEdit={() => openEdit(user)}
                        onToggle={() => toggleActive(user)}
                        onDelete={() => setConfirmDelete(user)}
                        onTerminate={
                          user.is_active && !['owner','developer','sales_director'].includes(user.role) && user.id !== session?.id
                            ? () => { setTerminateUser(user); setTerminateReasons(''); setTerminateError('') }
                            : undefined
                        }
                        onStores={user.role === 'manager' ? () => openStorePanel(user.id) : undefined}
                        storesPanelOpen={storePanel === user.id}
                      />
                      {/* Store assignment panel */}
                      {storePanel === user.id && (
                        <div className="bg-gray-900 border border-gray-700 border-t-0 rounded-b-2xl px-4 pb-4 -mt-2 pt-4">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                            Assign Stores — {user.full_name}
                            <span className="ml-2 text-gray-600 normal-case font-normal">({assignedStoreIds.size} selected)</span>
                          </p>
                          {allLocations.length === 0 ? (
                            <p className="text-gray-600 text-sm">No store locations found. Add stores in DM Store Visit → Manage Stores.</p>
                          ) : (
                            <>
                              <div className="flex items-center gap-3 mb-2">
                                <button
                                  onClick={() => {
                                    const activeIds = allLocations.filter(l => l.active).map(l => l.id)
                                    const allSelected = activeIds.every(id => assignedStoreIds.has(id))
                                    setAssignedStoreIds(allSelected ? new Set() : new Set(activeIds))
                                  }}
                                  className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors"
                                >
                                  {allLocations.filter(l => l.active).every(l => assignedStoreIds.has(l.id))
                                    ? 'Deselect All'
                                    : 'Select All'}
                                </button>
                                <span className="text-xs text-gray-600">
                                  {assignedStoreIds.size} of {allLocations.filter(l => l.active).length} selected
                                </span>
                              </div>
                              <div className="max-h-64 overflow-y-auto space-y-1 mb-3 pr-1">
                                {allLocations.map(loc => (
                                  <label key={loc.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                                    assignedStoreIds.has(loc.id) ? 'bg-violet-600/15' : 'hover:bg-gray-800'
                                  } ${!loc.active ? 'opacity-40' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={assignedStoreIds.has(loc.id)}
                                      onChange={() => toggleStoreAssignment(loc.id)}
                                      className="accent-violet-500 w-4 h-4 flex-shrink-0"
                                    />
                                    <span className="text-sm text-gray-200">{loc.address}</span>
                                    {!loc.active && <span className="text-xs text-gray-600 ml-auto">Inactive</span>}
                                  </label>
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <button onClick={saveStoreAssignments} disabled={savingStores}
                                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-xl transition-colors">
                                  {savingStores ? 'Saving…' : 'Save Assignments'}
                                </button>
                                <button onClick={() => setStorePanel(null)}
                                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold py-2 rounded-xl transition-colors">
                                  Cancel
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              /* Org chart horizontal tree */
              <OrgChart users={allUsersOrdered} onSelect={setTreeSelected} />
            )}
          </>
        )}

        {/* Node detail sheet */}
        {treeSelected && (
          <NodeDetailSheet
            user={treeSelected}
            allUsers={allUsersOrdered}
            onClose={() => setTreeSelected(null)}
            onEdit={u => { openEdit(u); setTreeSelected(null) }}
            onToggle={u => { toggleActive(u); setTreeSelected(null) }}
            onDelete={u => { setConfirmDelete(u); setTreeSelected(null) }}
            canManage={canManageAll}
            onRefresh={() => { loadUsers(); setTreeSelected(null) }}
          />
        )}

        {/* MANAGER VIEW */}
        {!canManageAll && session && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">My Team</p>
              <button onClick={() => openCreate('employee')}
                className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors">
                + Add Employee
              </button>
            </div>
            <div className="mb-3">
              <input
                type="search"
                placeholder="Search by name or username…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-violet-600"
              />
            </div>
            {users.length === 0 ? (
              <p className="text-gray-600 text-sm py-3">No employees assigned yet</p>
            ) : (
              <div className="space-y-2">
                {users.filter(u =>
                  !searchQuery.trim() ||
                  u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  u.username.toLowerCase().includes(searchQuery.toLowerCase())
                ).map(user => (
                  user.approval_status === 'pending' ? (
                    <div key={user.id} className="bg-gray-900 border border-amber-800/40 rounded-2xl px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-white text-sm font-medium">{user.full_name}</p>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400">Pending Approval</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">@{user.username} · {user.email}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <UserCard
                      key={user.id}
                      user={user}
                      subtitle={`${user.is_floater ? 'Floater · ' : ''}${user.pay_type === 'salary' ? 'Salary · ' : ''}${user.email}`}
                      onEdit={() => openEdit(user)}
                      onToggle={() => toggleActive(user)}
                      onDelete={() => setConfirmDelete(user)}
                      onTerminate={
                        user.is_active && !['owner','developer','sales_director'].includes(user.role) && user.id !== session?.id
                          ? () => { setTerminateUser(user); setTerminateReasons(''); setTerminateError('') }
                          : undefined
                      }
                    />
                  )
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const ROLE_COLORS: Record<string, string> = {
  developer: 'text-red-400 bg-red-900/30',
  owner: 'text-amber-400 bg-amber-900/30',
  sales_director: 'text-orange-400 bg-orange-900/30',
  ops_manager: 'text-blue-400 bg-blue-900/30',
  manager: 'text-violet-400 bg-violet-900/30',
  employee: 'text-gray-400 bg-gray-800',
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const SIBLING_GAP = 12 // px — gap between sibling subtrees (gap-3)
const SIBLING_GAP_HALF = SIBLING_GAP / 2

function OrgChart({ users, onSelect }: { users: User[]; onSelect: (u: User) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggleCollapse(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Developers are platform admins — exclude from the field team hierarchy
  const chartUsers = users.filter(u => u.role !== 'developer')
  const userIds = new Set(chartUsers.map(u => u.id))
  const roleOrder: Record<string, number> = { owner: 0, sales_director: 1, ops_manager: 2, manager: 3, employee: 4 }
  const roots = chartUsers
    .filter(u => !u.manager_id || !userIds.has(u.manager_id))
    .sort((a, b) => (roleOrder[a.role] ?? 5) - (roleOrder[b.role] ?? 5) || a.full_name.localeCompare(b.full_name))

  return (
    <div
      className="overflow-x-auto pb-6"
      style={{ scrollbarWidth: 'thin', scrollbarColor: '#4B5563 #111827' }}
    >
      <div className="flex gap-3 min-w-max px-6 pt-6 pb-4 justify-center">
        {roots.map(root => (
          <OrgNodeGroup
            key={root.id}
            user={root}
            allUsers={chartUsers}
            collapsed={collapsed}
            toggleCollapse={toggleCollapse}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

function OrgNodeGroup({
  user,
  allUsers,
  collapsed,
  toggleCollapse,
  onSelect,
}: {
  user: User
  allUsers: User[]
  collapsed: Set<string>
  toggleCollapse: (id: string) => void
  onSelect: (u: User) => void
}) {
  const children = allUsers.filter(u => u.manager_id === user.id)
  const isCollapsed = collapsed.has(user.id)
  const hasChildren = children.length > 0
  const colorClass = ROLE_COLORS[user.role] ?? ROLE_COLORS.employee

  return (
    <div className="flex flex-col items-center">
      {/* Node card */}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => onSelect(user)}
          className={`w-24 bg-gray-900 border rounded-xl px-2 py-2 flex flex-col items-center gap-1 transition-all hover:border-gray-600 active:scale-[0.98] ${
            user.is_active ? 'border-gray-800' : 'border-gray-700/50 opacity-60'
          }`}
        >
          {user.avatar_url ? (
            <img src={user.avatar_url} alt={user.full_name} className="w-7 h-7 rounded-lg object-cover" />
          ) : (
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold ${colorClass}`}>
              {initials(user.full_name)}
            </div>
          )}
          <p className={`text-[10px] font-semibold text-center leading-tight w-full truncate ${user.is_active ? 'text-white' : 'text-gray-500 line-through'}`}>
            {user.full_name}
          </p>
          <span className={`text-[9px] font-semibold px-1 py-0.5 rounded-full ${colorClass}`}>
            {ROLE_LABELS[user.role] ?? user.role}
          </span>
        </button>

        {hasChildren && (
          <button
            onClick={e => { e.stopPropagation(); toggleCollapse(user.id) }}
            className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-5 h-5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-full text-[10px] font-bold text-gray-400 flex items-center justify-center z-10 shadow-md transition-colors"
          >
            {isCollapsed ? '+' : '−'}
          </button>
        )}
      </div>

      {hasChildren && !isCollapsed && (
        <div className="flex flex-col items-center">
          {/* Vertical stem from card down to branch */}
          <div className="w-px bg-gray-700" style={{ height: children.length === 1 ? 14 : 20 }} />

          {children.length === 1 ? (
            <OrgNodeGroup
              user={children[0]}
              allUsers={allUsers}
              collapsed={collapsed}
              toggleCollapse={toggleCollapse}
              onSelect={onSelect}
            />
          ) : (
            /* Each child gets left/right arm connectors that together form
               a horizontal bar running exactly between sibling node centers */
            <div className="flex items-start" style={{ gap: SIBLING_GAP }}>
              {children.map((child, i) => (
                <div key={child.id} className="relative flex flex-col items-center">
                  {/* Left arm — reaches left to meet right arm of previous sibling */}
                  {i > 0 && (
                    <div
                      className="absolute h-px bg-gray-700"
                      style={{ top: 0, right: '50%', left: -SIBLING_GAP_HALF }}
                    />
                  )}
                  {/* Right arm — reaches right to meet left arm of next sibling */}
                  {i < children.length - 1 && (
                    <div
                      className="absolute h-px bg-gray-700"
                      style={{ top: 0, left: '50%', right: -SIBLING_GAP_HALF }}
                    />
                  )}
                  {/* Vertical drop from arm to child card */}
                  <div className="w-px bg-gray-700" style={{ height: 12 }} />
                  <OrgNodeGroup
                    user={child}
                    allUsers={allUsers}
                    collapsed={collapsed}
                    toggleCollapse={toggleCollapse}
                    onSelect={onSelect}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NodeDetailSheet({
  user,
  allUsers,
  onClose,
  onEdit,
  onToggle,
  onDelete,
  canManage,
  onRefresh,
}: {
  user: User
  allUsers: User[]
  onClose: () => void
  onEdit: (u: User) => void
  onToggle: (u: User) => void
  onDelete: (u: User) => void
  canManage: boolean
  onRefresh: () => void
}) {
  const manager = allUsers.find(u => u.id === user.manager_id)
  const reports = allUsers.filter(u => u.manager_id === user.id)
  const colorClass = ROLE_COLORS[user.role] ?? ROLE_COLORS.employee
  const ini = initials(user.full_name)
  const avatarFileRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'jpg'
      const res = await fetch(`/api/team/users/avatar?userId=${user.id}&ext=${ext}`)
      const { uploadUrl, avatarKey } = await res.json()
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      await fetch('/api/team/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, avatarKey }),
      })
      onRefresh()
    } finally {
      setAvatarUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-t-3xl border-t border-gray-800 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-700 rounded-full" />
        </div>

        <div className="px-6 pb-8 pt-4">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-shrink-0">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name}
                  className="w-16 h-16 rounded-2xl object-cover"
                />
              ) : (
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold ${colorClass}`}>
                  {ini}
                </div>
              )}
              {canManage && (
                <button
                  onClick={() => avatarFileRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute -bottom-1.5 -right-1.5 w-7 h-7 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-full flex items-center justify-center text-gray-300 text-xs transition-colors disabled:opacity-50"
                  title="Change photo"
                >
                  {avatarUploading ? '…' : '📷'}
                </button>
              )}
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-lg leading-tight">{user.full_name}</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mt-1 inline-block ${colorClass}`}>
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
              {user.is_floater && (
                <span className="text-xs bg-sky-900/40 text-sky-400 px-2 py-0.5 rounded-full ml-1.5 font-semibold">Floater</span>
              )}
              {!user.is_active && (
                <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full ml-1.5">Inactive</span>
              )}
            </div>
          </div>

          {/* Info rows */}
          <div className="bg-gray-800/50 rounded-2xl divide-y divide-gray-700/50 mb-5">
            <InfoRow label="Username" value={`@${user.username}`} />
            <InfoRow label="Email" value={user.email} />
            {manager && <InfoRow label="Reports to" value={`${manager.full_name} (${ROLE_LABELS[manager.role] ?? manager.role})`} />}
            {reports.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-xs text-gray-500 mb-2">Direct Reports ({reports.length})</p>
                <div className="space-y-1">
                  {reports.map(r => (
                    <div key={r.id} className="flex items-center gap-2">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt={r.full_name} className="w-5 h-5 rounded-md object-cover flex-shrink-0" />
                      ) : (
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${ROLE_COLORS[r.role] ?? ROLE_COLORS.employee}`}>
                          {initials(r.full_name)}
                        </div>
                      )}
                      <p className="text-sm text-gray-300">{r.full_name}</p>
                      <span className="text-xs text-gray-600">{ROLE_LABELS[r.role] ?? r.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          {canManage && (
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(user)}
                className="flex-1 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl text-sm font-semibold transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => onToggle(user)}
                className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-2xl text-sm font-semibold transition-colors"
              >
                {user.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
              <button
                onClick={() => onDelete(user)}
                className="px-4 py-3 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-2xl text-sm font-semibold border border-red-800/40 transition-colors"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="text-xs text-gray-500 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-200 text-right break-all">{value}</span>
    </div>
  )
}

function UserCard({
  user,
  subtitle,
  onEdit,
  onToggle,
  onDelete,
  onTerminate,
  onStores,
  storesPanelOpen,
}: {
  user: User
  subtitle: string
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onTerminate?: () => void
  onStores?: () => void
  storesPanelOpen?: boolean
}) {
  const colorClass = ROLE_COLORS[user.role] ?? ROLE_COLORS.employee

  return (
    <div className={`bg-gray-900 border px-4 py-3 ${storesPanelOpen ? 'rounded-t-2xl border-gray-700' : 'rounded-2xl'} ${user.is_active ? 'border-gray-800' : 'border-gray-700 opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt={user.full_name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${colorClass}`}>
              {initials(user.full_name)}
            </div>
          )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-medium text-sm ${user.is_active ? 'text-white' : 'text-gray-400 line-through'}`}>
              {user.full_name}
            </p>
            {user.is_floater && (
              <span className="text-xs bg-sky-900/40 text-sky-400 px-2 py-0.5 rounded-full font-semibold">Floater</span>
            )}
            {!user.is_active && (
              <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">Inactive</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">@{user.username} · {subtitle}</p>
        </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <button onClick={onEdit}
            className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors">
            Edit
          </button>
          {onStores && (
            <>
              <span className="text-gray-700">·</span>
              <button onClick={onStores}
                className={`text-xs font-semibold transition-colors ${storesPanelOpen ? 'text-violet-300' : 'text-blue-400 hover:text-blue-300'}`}>
                Stores
              </button>
            </>
          )}
          <span className="text-gray-700">·</span>
          <button onClick={onToggle}
            className={`text-xs font-semibold transition-colors ${user.is_active ? 'text-amber-400 hover:text-amber-300' : 'text-green-400 hover:text-green-300'}`}>
            {user.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
          {onTerminate && (
            <>
              <span className="text-gray-700">·</span>
              <button onClick={onTerminate}
                className="text-red-400 hover:text-red-300 text-xs font-semibold transition-colors">
                Terminate
              </button>
            </>
          )}
          <span className="text-gray-700">·</span>
          <button onClick={onDelete}
            className="text-red-500 hover:text-red-400 text-xs font-semibold transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
