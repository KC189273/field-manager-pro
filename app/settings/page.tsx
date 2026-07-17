'use client'

import { useEffect, useRef, useState } from 'react'
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
  eod_recap: boolean
  weekly_coaching: boolean
  accountability_docs: boolean
  ops_alerts: boolean
  morning_digest: boolean
  weekly_report: boolean
  shift_swaps: boolean
  supply_requests: boolean
  facility_tickets: boolean
  clock_events: boolean
  schedule_changes: boolean
  payroll_alerts: boolean
  db_health_report: boolean
  payroll_report: boolean
  monthly_expense_report: boolean
  termination_docs: boolean
  dm_clockout_alerts: boolean
  dm_focus_emails: boolean
}

interface PrefDef {
  key: keyof Prefs
  label: string
  description: string
  roles: Session['role'][]
  group: string
}

const MGR_PLUS: Session['role'][] = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']
const ALL_ROLES: Session['role'][] = ['employee', ...MGR_PLUS]

const PREF_DEFS: PrefDef[] = [
  // Daily & Weekly Reports
  { key: 'eod_recap', label: 'DM End-of-Day Recaps', description: 'AI-generated daily recap when each DM clocks out.', roles: ['ops_manager', 'owner', 'sales_director', 'developer'], group: 'Reports' },
  { key: 'morning_digest', label: 'Morning Digest', description: 'Daily morning summary email.', roles: ['owner', 'sales_director', 'developer'], group: 'Reports' },
  { key: 'weekly_report', label: 'Weekly Report', description: 'End-of-week summary report.', roles: ['owner', 'sales_director', 'developer'], group: 'Reports' },
  { key: 'weekly_coaching', label: 'Weekly Coaching Insights', description: 'AI coaching insights email sent Sundays.', roles: ['ops_manager', 'owner', 'sales_director', 'developer'], group: 'Reports' },
  { key: 'ops_alerts', label: 'App Health / Ops Alerts', description: 'Daily ops check email and health push notifications.', roles: ['developer'], group: 'Reports' },
  { key: 'db_health_report', label: 'DB Health Report', description: 'Monthly database health report with cleanup actions.', roles: ['developer'], group: 'Reports' },
  { key: 'payroll_report', label: 'Payroll Report', description: 'Weekly payroll Excel spreadsheet email.', roles: ['owner', 'sales_director', 'ops_manager', 'developer'], group: 'Reports' },
  { key: 'monthly_expense_report', label: 'Monthly Expense Report', description: 'Monthly expense Excel spreadsheet email.', roles: ['owner', 'sales_director', 'developer'], group: 'Reports' },
  { key: 'dm_focus_emails', label: 'DM Tomorrow\'s Focus', description: 'Get a copy of the AI coaching suggestions sent to each DM after they clock out.', roles: ['ops_manager', 'owner', 'sales_director', 'developer'], group: 'Reports' },

  // Tasks & Assignments
  { key: 'task_assigned', label: 'Task Assigned', description: 'When a task is assigned to me.', roles: ALL_ROLES, group: 'Tasks' },
  { key: 'task_completed', label: 'Task Completed', description: 'When someone completes a task I assigned.', roles: MGR_PLUS, group: 'Tasks' },

  // Schedule & Time
  { key: 'schedule_published', label: 'Schedule Published', description: 'When my weekly schedule is published.', roles: ['employee', 'manager'], group: 'Schedule' },
  { key: 'schedule_changes', label: 'Schedule Changes', description: 'Schedule reminders, overstaffing alerts.', roles: MGR_PLUS, group: 'Schedule' },
  { key: 'time_off_request', label: 'Time Off Requests', description: 'Submissions and approval decisions.', roles: ALL_ROLES, group: 'Schedule' },
  { key: 'shift_swaps', label: 'Shift Swaps', description: 'Swap requests and approvals.', roles: ALL_ROLES, group: 'Schedule' },
  { key: 'clock_events', label: 'Clock Events', description: 'Clock reminders, auto-clockout, OT warnings.', roles: ALL_ROLES, group: 'Schedule' },
  { key: 'dm_clockout_alerts', label: 'DM Clock-Out Alerts', description: 'Push notification when a DM clocks out.', roles: ['ops_manager', 'owner', 'sales_director', 'developer'], group: 'Schedule' },

  // Operations
  { key: 'checklist_submitted', label: 'Checklists', description: 'Opening/closing checklist submissions.', roles: ['manager'], group: 'Operations' },
  { key: 'accountability_docs', label: 'Accountability Docs', description: 'New docs, approvals, escalations.', roles: MGR_PLUS, group: 'Operations' },
  { key: 'flag_created', label: 'Overtime Flags', description: 'When employees hit overtime thresholds.', roles: MGR_PLUS, group: 'Operations' },
  { key: 'expense_submitted', label: 'Expenses', description: 'Expense submissions for approval.', roles: ['owner', 'sales_director', 'ops_manager'], group: 'Operations' },
  { key: 'supply_requests', label: 'Supply Requests', description: 'Supply orders and escalations.', roles: MGR_PLUS, group: 'Operations' },
  { key: 'facility_tickets', label: 'Facility Tickets', description: 'Maintenance requests and updates.', roles: MGR_PLUS, group: 'Operations' },
  { key: 'payroll_alerts', label: 'Payroll', description: 'Payroll reminders and approval requests.', roles: ['owner', 'sales_director', 'developer'], group: 'Operations' },
  { key: 'termination_docs', label: 'Termination Notices', description: 'Management copy emails for termination notices.', roles: MGR_PLUS, group: 'Operations' },
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
    fetch('/api/push/preferences').then(r => r.json()).then(d => setPrefs(d.prefs))
    fetch('/api/team/users/avatar?view=true').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.avatarUrl) setAvatarUrl(d.avatarUrl)
    })
  }, [])

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    setUploadingAvatar(true)
    try {
      const res = await fetch(`/api/team/users/avatar?ext=${ext}`)
      const { uploadUrl, avatarKey } = await res.json()
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      await fetch('/api/team/users/avatar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarKey }),
      })
      // Fetch the new view URL
      const viewRes = await fetch('/api/team/users/avatar?view=true')
      const viewData = await viewRes.json()
      if (viewData?.avatarUrl) setAvatarUrl(viewData.avatarUrl)
    } catch {
      alert('Upload failed. Please try again.')
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

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
        <p className="text-gray-500 text-sm mb-6">Manage your profile and preferences.</p>

        {/* Profile / Avatar */}
        {session && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 px-5 py-4 mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Profile</p>
            <div className="flex items-center gap-4">
              <div className="relative">
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="relative w-16 h-16 rounded-full overflow-hidden flex items-center justify-center bg-violet-700 hover:opacity-80 transition-opacity disabled:opacity-50 group"
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-lg font-bold">
                      {session.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-full">
                    {uploadingAvatar ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </div>
                </button>
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold">{session.fullName}</p>
                <p className="text-xs text-gray-500 capitalize mt-0.5">{session.role.replace(/_/g, ' ')}</p>
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="text-xs text-violet-400 hover:text-violet-300 mt-1 transition-colors disabled:opacity-50"
                >
                  {uploadingAvatar ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Add photo'}
                </button>
              </div>
            </div>
          </div>
        )}

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

            {/* Per-event prefs grouped by category */}
            {(() => {
              const groups = [...new Set(visibleEventPrefs.map(p => p.group))]
              return groups.map(group => {
                const groupPrefs = visibleEventPrefs.filter(p => p.group === group)
                if (groupPrefs.length === 0) return null
                return (
                  <div key={group} className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800">
                    <div className="px-5 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{group}</p>
                    </div>
                    {groupPrefs.map(def => (
                      <div key={def.key} className="flex items-start justify-between gap-4 px-5 py-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium">{def.label}</p>
                          <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{def.description}</p>
                        </div>
                        <Toggle on={prefs[def.key]} disabled={saving === def.key} onToggle={() => toggle(def.key)} />
                      </div>
                    ))}
                  </div>
                )
              })
            })()}
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
