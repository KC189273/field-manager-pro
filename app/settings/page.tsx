'use client'

import { useEffect, useState } from 'react'
import NavBar from '@/components/NavBar'
import { registerForPushNotifications } from '@/lib/push-client'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface Prefs {
  email_enabled: boolean
  push_enabled: boolean
  task_assigned: boolean
  task_completed: boolean
  checklist_submitted: boolean
  flag_created: boolean
  expense_submitted: boolean
  schedule_published: boolean
  time_off_request: boolean
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
    roles: ['employee', 'manager', 'ops_manager', 'owner', 'sales_director', 'developer'],
  },
  {
    key: 'task_completed',
    label: 'Task completed',
    description: 'Notify me when someone completes a task I assigned.',
    roles: ['manager', 'ops_manager', 'owner', 'sales_director', 'developer'],
  },
  {
    key: 'time_off_request',
    label: 'Time off requests',
    description: 'Notify me when someone submits a time off request for my approval, or when my request is decided.',
    roles: ['employee', 'manager', 'ops_manager', 'owner', 'sales_director', 'developer'],
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

function Toggle({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-60 ${on ? 'bg-violet-600' : 'bg-gray-700'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

export default function SettingsPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [saving, setSaving] = useState<keyof Prefs | null>(null)
  const [registerStatus, setRegisterStatus] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
    fetch('/api/push/preferences').then(r => r.json()).then(d => setPrefs(d.prefs))
  }, [])

  async function registerPush() {
    setRegistering(true)
    setRegisterStatus(null)
    const result = await registerForPushNotifications(true)
    setRegisterStatus(result)
    setRegistering(false)
  }

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
      setPrefs(p => p ? { ...p, [key]: !newVal } : p)
    } finally {
      setSaving(null)
    }
  }

  const visibleEventPrefs = session
    ? PREF_DEFS.filter(p => p.roles.includes(session.role))
    : []

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="max-w-lg mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-white mb-1">Settings</h1>
        <p className="text-gray-500 text-sm mb-6">Manage your notification preferences.</p>

        {!prefs && <div className="text-gray-500 text-sm">Loading…</div>}

        {prefs && (
          <div className="space-y-4">
            {/* Notification Channels — visible to everyone */}
            <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800">
              <div className="px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Notification Channels</p>
              </div>
              <div className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">Email notifications</p>
                  <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">Receive notifications via email.</p>
                </div>
                <Toggle on={prefs.email_enabled} disabled={saving === 'email_enabled'} onToggle={() => toggle('email_enabled')} />
              </div>
              <div className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">Push notifications</p>
                  <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">Receive push notifications on your device.</p>
                  <button
                    onClick={registerPush}
                    disabled={registering}
                    className="mt-2 text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50 transition-colors"
                  >
                    {registering ? 'Registering…' : 'Re-register this device'}
                  </button>
                  {registerStatus && (
                    <p className="text-[11px] mt-1 text-gray-500">{registerStatus}</p>
                  )}
                </div>
                <Toggle on={prefs.push_enabled} disabled={saving === 'push_enabled'} onToggle={() => toggle('push_enabled')} />
              </div>
            </div>

            {/* Per-event prefs */}
            {visibleEventPrefs.length > 0 && (
              <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800">
                <div className="px-5 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Alert Types</p>
                </div>
                {visibleEventPrefs.map(def => (
                  <div key={def.key} className="flex items-start justify-between gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{def.label}</p>
                      <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{def.description}</p>
                    </div>
                    <Toggle on={prefs[def.key]} disabled={saving === def.key} onToggle={() => toggle(def.key)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-gray-600 text-xs mt-4 text-center">
          You can also manage push notifications in your phone&apos;s Settings app.
        </p>

        <div className="mt-6 flex justify-center gap-5 text-xs text-gray-700">
          <a href="/terms" className="hover:text-gray-400 transition-colors">Terms of Service</a>
          <a href="/privacy" className="hover:text-gray-400 transition-colors">Privacy Policy</a>
        </div>
      </div>
    </div>
  )
}
