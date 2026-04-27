'use client'

import { useEffect, useState } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface Prefs {
  task_assigned: boolean
  checklist_submitted: boolean
  flag_created: boolean
  expense_submitted: boolean
  schedule_published: boolean
}

interface PrefDef {
  key: keyof Prefs
  label: string
  description: string
  roles: Session['role'][]
}

const PREF_DEFS: PrefDef[] = [
  {
    key: 'task_assigned',
    label: 'Task assigned to me',
    description: 'Notify me when a new task is assigned to me.',
    roles: ['manager', 'ops_manager', 'owner', 'sales_director', 'developer'],
  },
  {
    key: 'checklist_submitted',
    label: 'Checklist submitted',
    description: 'Notify me when an employee submits an opening or closing checklist for my store.',
    roles: ['manager'],
  },
  {
    key: 'flag_created',
    label: 'Overtime flag raised',
    description: 'Notify me when an employee hits overtime (40+ hours).',
    roles: ['manager', 'ops_manager', 'owner', 'sales_director', 'developer'],
  },
  {
    key: 'expense_submitted',
    label: 'Expense submitted',
    description: 'Notify me when a new expense is submitted for approval.',
    roles: ['owner', 'sales_director', 'ops_manager'],
  },
  {
    key: 'schedule_published',
    label: 'Schedule published',
    description: 'Notify me when my schedule for the week is published.',
    roles: ['employee', 'manager'],
  },
]

export default function SettingsPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [saving, setSaving] = useState<keyof Prefs | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
    fetch('/api/push/preferences').then(r => r.json()).then(d => setPrefs(d.prefs))
  }, [])

  async function toggle(key: keyof Prefs) {
    if (!prefs) return
    const newVal = !prefs[key]
    setPrefs(p => p ? { ...p, [key]: newVal } : p)
    setSaving(key)
    try {
      await fetch('/api/push/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newVal }),
      })
    } catch {
      // Revert on error
      setPrefs(p => p ? { ...p, [key]: !newVal } : p)
    } finally {
      setSaving(null)
    }
  }

  const visiblePrefs = session
    ? PREF_DEFS.filter(p => p.roles.includes(session.role))
    : []

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="max-w-lg mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-white mb-1">Settings</h1>
        <p className="text-gray-500 text-sm mb-6">Manage your notification preferences.</p>

        {!prefs && (
          <div className="text-gray-500 text-sm">Loading…</div>
        )}

        {prefs && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800">
            <div className="px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Push Notifications</p>
            </div>

            {visiblePrefs.length === 0 && (
              <div className="px-5 py-4 text-gray-500 text-sm">
                No notification settings available for your role.
              </div>
            )}

            {visiblePrefs.map(def => (
              <div key={def.key} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{def.label}</p>
                  <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{def.description}</p>
                </div>
                <button
                  onClick={() => toggle(def.key)}
                  disabled={saving === def.key}
                  className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-60 ${
                    prefs[def.key] ? 'bg-violet-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                      prefs[def.key] ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-gray-600 text-xs mt-4 text-center">
          You can also manage notifications in your phone's Settings app.
        </p>
      </div>
    </div>
  )
}
