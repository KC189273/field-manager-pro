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
}

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  ops_manager: 'Ops Manager',
  developer: 'Developer',
}

export default function TeamPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [form, setForm] = useState({ username: '', email: '', fullName: '', password: '', role: 'employee' })
  const [editForm, setEditForm] = useState({ password: '', fullName: '', email: '', isActive: true })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

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

  async function createUser(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const res = await fetch('/api/team/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (res.ok) {
      setMessage('User created')
      setShowCreate(false)
      setForm({ username: '', email: '', fullName: '', password: '', role: 'employee' })
      await loadUsers()
    } else {
      setMessage(data.error || 'Error')
    }
    setLoading(false)
  }

  async function updateUser(e: FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setLoading(true)
    setMessage('')
    const body: Record<string, unknown> = { userId: editUser.id }
    if (editForm.password) body.password = editForm.password
    if (editForm.fullName) body.fullName = editForm.fullName
    if (editForm.email) body.email = editForm.email
    body.isActive = editForm.isActive

    const res = await fetch('/api/team/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setMessage('Updated')
      setEditUser(null)
      await loadUsers()
    } else {
      const data = await res.json()
      setMessage(data.error || 'Error')
    }
    setLoading(false)
  }

  function openEdit(user: User) {
    setEditUser(user)
    setEditForm({ password: '', fullName: user.full_name, email: user.email, isActive: user.is_active })
    setMessage('')
  }

  const employees = users.filter(u => u.role === 'employee')
  const managers = users.filter(u => u.role !== 'employee')

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Team</h1>
          <button
            onClick={() => { setShowCreate(true); setMessage('') }}
            className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            + Add User
          </button>
        </div>

        {message && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-violet-900/30 border border-violet-700 text-violet-300 text-sm">
            {message}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <form onSubmit={createUser} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-5 space-y-3">
            <h2 className="font-semibold text-white">New User</h2>
            <input required placeholder="Full name" value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input required placeholder="Username" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input required placeholder="Email" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input required placeholder="Password" type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="ops_manager">Ops Manager</option>
            </select>
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
            <h2 className="font-semibold text-white">Edit {editUser.full_name}</h2>
            <input placeholder="New full name" value={editForm.fullName} onChange={e => setEditForm(p => ({ ...p, fullName: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input placeholder="New email" type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input placeholder="New password (leave blank to keep)" type="password" value={editForm.password} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm(p => ({ ...p, isActive: e.target.checked }))}
                className="w-4 h-4 accent-violet-500" />
              <span className="text-sm text-gray-300">Active</span>
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={loading}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {loading ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditUser(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* User lists */}
        {[{ label: 'Employees', list: employees }, { label: 'Staff', list: managers }].map(({ label, list }) =>
          list.length > 0 ? (
            <div key={label} className="mb-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</p>
              <div className="space-y-2">
                {list.map(user => (
                  <div key={user.id} className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className={`font-medium text-sm ${user.is_active ? 'text-white' : 'text-gray-500 line-through'}`}>
                        {user.full_name}
                      </p>
                      <p className="text-xs text-gray-500">@{user.username} · {ROLE_LABELS[user.role] ?? user.role}</p>
                    </div>
                    <button
                      onClick={() => openEdit(user)}
                      className="text-violet-400 hover:text-violet-300 text-xs font-semibold transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  )
}
