'use client'

import { useState, useEffect, FormEvent } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'developer'
}

interface User {
  id: string
  username: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  manager_id: string | null
}

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  ops_manager: 'Ops Manager',
  developer: 'Developer',
}

const emptyForm = { username: '', email: '', fullName: '', password: '', role: 'employee', managerId: '' }
const emptyEdit = { password: '', fullName: '', email: '', isActive: true, managerId: '', role: '' }

export default function TeamPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [createFor, setCreateFor] = useState<'employee' | 'manager'>('employee')
  const [editUser, setEditUser] = useState<User | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editForm, setEditForm] = useState(emptyEdit)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' }>({ text: '', type: 'success' })

  const isDev = session?.role === 'developer'
  const managers = users.filter(u => u.role === 'manager' || u.role === 'ops_manager')
  const employees = users.filter(u => u.role === 'employee')

  async function loadUsers() {
    const res = await fetch('/api/team/users')
    if (res.ok) {
      const data = await res.json()
      setUsers(data.users)
    }
  }

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
    loadUsers()
  }, [])

  function showMsg(text: string, type: 'success' | 'error' = 'success') {
    setMessage({ text, type })
    setTimeout(() => setMessage({ text: '', type: 'success' }), 3000)
  }

  function openCreate(type: 'employee' | 'manager') {
    setCreateFor(type)
    setForm({ ...emptyForm, role: type === 'manager' ? 'manager' : 'employee' })
    setShowCreate(true)
    setEditUser(null)
  }

  function openEdit(user: User) {
    setEditUser(user)
    setEditForm({ password: '', fullName: user.full_name, email: user.email, isActive: user.is_active, managerId: user.manager_id ?? '', role: user.role })
    setShowCreate(false)
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
      showMsg(`${ROLE_LABELS[form.role]} created successfully`)
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
    if (editForm.password) body.password = editForm.password
    if (editForm.fullName !== editUser.full_name) body.fullName = editForm.fullName
    if (editForm.email !== editUser.email) body.email = editForm.email
    if (editForm.role !== editUser.role) body.role = editForm.role
    if (isDev) body.managerId = editForm.managerId || null

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

  function getManagerName(managerId: string | null): string {
    if (!managerId) return 'Unassigned'
    const mgr = users.find(u => u.id === managerId)
    return mgr?.full_name ?? 'Unknown'
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Team</h1>

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

        {/* Create form */}
        {showCreate && (
          <form onSubmit={createUser} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-5 space-y-3">
            <h2 className="font-semibold text-white">
              {createFor === 'manager' ? 'Add Manager' : 'Add Employee'}
            </h2>
            <input required placeholder="Full name" value={form.fullName}
              onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input required placeholder="Username" value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input required placeholder="Email" type="email" value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input required placeholder="Temporary password" type="password" value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            {createFor === 'manager' && (
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                <option value="manager">Manager</option>
                <option value="ops_manager">Ops Manager</option>
              </select>
            )}
            {createFor === 'employee' && isDev && managers.length > 0 && (
              <select value={form.managerId} onChange={e => setForm(p => ({ ...p, managerId: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                <option value="">No manager assigned</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
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

        {/* Edit form */}
        {editUser && (
          <form onSubmit={updateUser} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-5 space-y-3">
            <h2 className="font-semibold text-white">Edit — {editUser.full_name}</h2>
            <input placeholder="Full name" value={editForm.fullName}
              onChange={e => setEditForm(p => ({ ...p, fullName: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input placeholder="Email" type="email" value={editForm.email}
              onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input placeholder="New password (leave blank to keep)" type="password" value={editForm.password}
              onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role</label>
              <select value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="ops_manager">Ops Manager</option>
              </select>
              {editForm.role !== editUser.role && (editForm.role === 'manager' || editForm.role === 'ops_manager') && (
                <p className="text-xs text-amber-400 mt-1">This user will need to sign out and back in to see their new access.</p>
              )}
            </div>
            {isDev && editForm.role === 'employee' && managers.length > 0 && (
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
        )}

        {/* Delete confirmation */}
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

        {/* DEVELOPER VIEW */}
        {isDev && (
          <>
            {/* Managers section */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Managers</p>
                <button onClick={() => openCreate('manager')}
                  className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors">
                  + Add Manager
                </button>
              </div>
              {managers.length === 0 ? (
                <p className="text-gray-600 text-sm py-3">No managers yet</p>
              ) : (
                <div className="space-y-2">
                  {managers.map(user => (
                    <UserCard
                      key={user.id}
                      user={user}
                      subtitle={`${ROLE_LABELS[user.role]} · ${user.email}`}
                      onEdit={() => openEdit(user)}
                      onToggle={() => toggleActive(user)}
                      onDelete={() => setConfirmDelete(user)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Employees section — grouped by manager */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Employees</p>
                <button onClick={() => openCreate('employee')}
                  className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors">
                  + Add Employee
                </button>
              </div>
              {employees.length === 0 ? (
                <p className="text-gray-600 text-sm py-3">No employees yet</p>
              ) : (
                <div className="space-y-2">
                  {employees.map(user => (
                    <UserCard
                      key={user.id}
                      user={user}
                      subtitle={`Under: ${getManagerName(user.manager_id)} · ${user.email}`}
                      onEdit={() => openEdit(user)}
                      onToggle={() => toggleActive(user)}
                      onDelete={() => setConfirmDelete(user)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* MANAGER VIEW */}
        {!isDev && session && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">My Team</p>
              <button onClick={() => openCreate('employee')}
                className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors">
                + Add Employee
              </button>
            </div>
            {users.length === 0 ? (
              <p className="text-gray-600 text-sm py-3">No employees assigned yet</p>
            ) : (
              <div className="space-y-2">
                {users.map(user => (
                  <UserCard
                    key={user.id}
                    user={user}
                    subtitle={user.email}
                    onEdit={() => openEdit(user)}
                    onToggle={() => toggleActive(user)}
                    onDelete={() => setConfirmDelete(user)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function UserCard({
  user,
  subtitle,
  onEdit,
  onToggle,
  onDelete,
}: {
  user: User
  subtitle: string
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className={`bg-gray-900 border rounded-2xl px-4 py-3 ${user.is_active ? 'border-gray-800' : 'border-gray-700 opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`font-medium text-sm ${user.is_active ? 'text-white' : 'text-gray-400 line-through'}`}>
              {user.full_name}
            </p>
            {!user.is_active && (
              <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">Inactive</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">@{user.username} · {subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onEdit}
            className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors">
            Edit
          </button>
          <span className="text-gray-700">·</span>
          <button onClick={onToggle}
            className={`text-xs font-semibold transition-colors ${user.is_active ? 'text-amber-400 hover:text-amber-300' : 'text-green-400 hover:text-green-300'}`}>
            {user.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
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
