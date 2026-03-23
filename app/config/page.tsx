'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'developer'
}

interface Config {
  schedule_submit_notify_manager: string
  schedule_submit_notify_developer: string
  weekly_report_enabled: string
  flag_alert_notify_manager: string
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

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      setSession(s)
      if (s.role === 'developer') {
        fetch('/api/config').then(r => r.json()).then(d => setConfig(d.config))
      }
    })
  }, [])

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
    if (res.ok) {
      setMessage('Settings saved')
    } else {
      setMessage('Save failed')
    }
    setSaving(false)
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

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Developer Config</h1>
        <p className="text-gray-400 text-sm mb-6">Notification and reporting toggles</p>

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
          <div className="mt-4 px-4 py-3 rounded-xl bg-violet-900/30 border border-violet-700 text-violet-300 text-sm">
            {message}
          </div>
        )}

        {config && (
          <button
            onClick={save}
            disabled={saving}
            className="mt-5 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl transition-colors"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        )}

        <div className="mt-8 bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="font-semibold text-white mb-3">Cron Job</h2>
          <p className="text-sm text-gray-400">Weekly report runs every Monday at 4:00 AM CST via Vercel cron.</p>
          <p className="text-xs text-gray-600 mt-1 font-mono">/api/cron/weekly-report · 0 10 * * 1 (UTC)</p>
        </div>
      </div>
    </div>
  )
}
