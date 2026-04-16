'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface Config {
  schedule_submit_notify_manager: string
  schedule_submit_notify_developer: string
  weekly_report_enabled: string
  flag_alert_notify_manager: string
}

interface Org {
  id: string
  name: string
  created_at: string
}

const CONFIG_LABELS: Record<keyof Config, string> = {
  schedule_submit_notify_manager: 'Email managers on schedule submission',
  schedule_submit_notify_developer: 'Email developer on schedule submission',
  weekly_report_enabled: 'Send weekly email report (Mon 4am)',
  flag_alert_notify_manager: 'Email managers on new flags',
}

export default function ConfigPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // Org state
  const [orgs, setOrgs] = useState<Org[]>([])
  const [newOrgName, setNewOrgName] = useState('')
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [orgMessage, setOrgMessage] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      setSession(s)
      if (s.role === 'developer') {
        fetch('/api/config').then(r => r.json()).then(d => setConfig(d.config))
        loadOrgs()
      }
    })
  }, [])

  async function loadOrgs() {
    const res = await fetch('/api/orgs')
    const data = await res.json()
    setOrgs(data.orgs ?? [])
  }

  function showOrgMsg(msg: string) {
    setOrgMessage(msg)
    setTimeout(() => setOrgMessage(''), 3000)
  }

  async function createOrg() {
    if (!newOrgName.trim()) return
    setCreatingOrg(true)
    const res = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newOrgName.trim() }),
    })
    setCreatingOrg(false)
    if (res.ok) {
      setNewOrgName('')
      showOrgMsg('Organization created')
      await loadOrgs()
    } else {
      const d = await res.json()
      showOrgMsg(d.error ?? 'Failed to create')
    }
  }

  async function renameOrg(orgId: string) {
    if (!renameValue.trim()) return
    const res = await fetch('/api/orgs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, name: renameValue.trim() }),
    })
    if (res.ok) {
      setRenamingId(null)
      setRenameValue('')
      showOrgMsg('Organization renamed')
      await loadOrgs()
    } else {
      const d = await res.json()
      showOrgMsg(d.error ?? 'Failed to rename')
    }
  }

  async function deleteOrg(orgId: string, name: string) {
    if (!confirm(`Delete "${name}"? All users in this org will become unassigned.`)) return
    const res = await fetch('/api/orgs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    })
    if (res.ok) {
      showOrgMsg('Organization deleted')
      await loadOrgs()
    }
  }

  async function save() {
    if (!config) return
    setSaving(true)
    setMessage('')
    const body: Record<string, string> = {}
    for (const key of Object.keys(config) as (keyof Config)[]) {
      body[key] = config[key]
    }
    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    setMessage(res.ok ? 'Settings saved' : 'Save failed')
  }

  function toggle(key: keyof Config) {
    setConfig(prev => {
      if (!prev) return prev
      return { ...prev, [key]: prev[key] === 'true' ? 'false' : 'true' }
    })
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-lg mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Developer Config</h1>
          <p className="text-gray-400 text-sm">Notification toggles, orgs, and cron</p>
        </div>

        {/* Organizations */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Organizations</h2>

          {orgMessage && (
            <div className="mb-3 px-4 py-2.5 rounded-xl bg-violet-900/30 border border-violet-700 text-violet-300 text-sm">
              {orgMessage}
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mb-3">
            {orgs.length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-500">No organizations yet</p>
            ) : (
              <div className="divide-y divide-gray-800">
                {orgs.map(org => (
                  <div key={org.id} className="px-5 py-3">
                    {renamingId === org.id ? (
                      <div className="flex gap-2 items-center">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') renameOrg(org.id); if (e.key === 'Escape') setRenamingId(null) }}
                          className="flex-1 bg-gray-800 border border-violet-500 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
                        />
                        <button onClick={() => renameOrg(org.id)} className="text-xs text-violet-400 font-semibold hover:text-violet-300">Save</button>
                        <button onClick={() => setRenamingId(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-white font-medium">{org.name}</span>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <button
                            onClick={() => { setRenamingId(org.id); setRenameValue(org.name) }}
                            className="text-xs text-violet-400 hover:text-violet-300 font-semibold transition-colors"
                          >
                            Rename
                          </button>
                          <span className="text-gray-700">·</span>
                          <button
                            onClick={() => deleteOrg(org.id, org.name)}
                            className="text-xs text-red-500 hover:text-red-400 font-semibold transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create org */}
          <div className="flex gap-2">
            <input
              placeholder="New organization name"
              value={newOrgName}
              onChange={e => setNewOrgName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createOrg() }}
              className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={createOrg}
              disabled={creatingOrg || !newOrgName.trim()}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              {creatingOrg ? '…' : 'Add'}
            </button>
          </div>
        </div>

        {/* Notification toggles */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Notifications</h2>
          {!config ? (
            <div className="text-gray-500 text-sm">Loading…</div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800">
              {(Object.keys(config) as (keyof Config)[]).map(key => (
                <div key={key} className="flex items-center justify-between px-5 py-4">
                  <p className="text-sm text-gray-200 flex-1 pr-4">{CONFIG_LABELS[key]}</p>
                  <button
                    onClick={() => toggle(key)}
                    className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      config[key] === 'true' ? 'bg-violet-600' : 'bg-gray-700'
                    }`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      config[key] === 'true' ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {message && (
            <div className="mt-3 px-4 py-2.5 rounded-xl bg-violet-900/30 border border-violet-700 text-violet-300 text-sm">
              {message}
            </div>
          )}

          {config && (
            <button
              onClick={save}
              disabled={saving}
              className="mt-4 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl transition-colors"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          )}
        </div>

        {/* Cron info */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="font-semibold text-white mb-2">Cron Job</h2>
          <p className="text-sm text-gray-400">Weekly report runs every Monday at 4:00 AM CST via Vercel cron.</p>
          <p className="text-xs text-gray-600 mt-1 font-mono">/api/cron/weekly-report · 0 10 * * 1 (UTC)</p>
        </div>
      </div>
    </div>
  )
}
