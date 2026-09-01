'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_field_leader' | 'ops_manager' | 'owner' | 'sales_director' | 'developer' | 'customer' | 'barber' | 'shop_owner'

interface Session { id: string; fullName: string; role: Role }

interface Entry {
  change_date: string
  change_type: string
  title: string
  description: string | null
}

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  feature: { bg: 'bg-violet-900/40', text: 'text-violet-400', label: 'Feature' },
  bugfix: { bg: 'bg-green-900/40', text: 'text-green-400', label: 'Fix' },
  improvement: { bg: 'bg-blue-900/40', text: 'text-blue-400', label: 'Improvement' },
  removal: { bg: 'bg-red-900/40', text: 'text-red-400', label: 'Removed' },
  role_change: { bg: 'bg-amber-900/40', text: 'text-amber-400', label: 'Role Change' },
}

export default function ChangelogPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
    fetch('/api/changelog').then(r => r.ok ? r.json() : null).then(d => {
      setEntries(d?.entries ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // Group entries by month
  const grouped: Record<string, Entry[]> = {}
  for (const e of entries) {
    const month = new Date(e.change_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!grouped[month]) grouped[month] = []
    grouped[month].push(e)
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="max-w-lg mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-white mb-1">App Changes</h1>
        <p className="text-sm text-gray-500 mb-6">A running history of features, fixes, and improvements made to Field Manager Pro.</p>

        {loading ? (
          <p className="text-center text-gray-500 py-10">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-gray-600 py-10">No changes to show</p>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([month, items]) => (
              <div key={month}>
                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">{month}</h2>
                <div className="space-y-3">
                  {items.map((e, i) => {
                    const style = TYPE_STYLES[e.change_type] || TYPE_STYLES.improvement
                    return (
                      <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                        <div className="flex items-start gap-2">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${style.bg} ${style.text}`}>
                            {style.label}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm text-white font-medium">{e.title}</p>
                              <p className="text-[10px] text-gray-600 shrink-0">{new Date(e.change_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                            </div>
                            {e.description && (
                              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{e.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
