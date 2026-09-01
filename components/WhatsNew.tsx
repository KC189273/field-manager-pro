'use client'

import { useState, useEffect } from 'react'

interface ChangelogEntry {
  change_date: string
  change_type: string
  title: string
  description: string | null
}

const TYPE_COLORS: Record<string, string> = {
  feature: 'bg-violet-900/40 text-violet-400',
  bugfix: 'bg-green-900/40 text-green-400',
  improvement: 'bg-blue-900/40 text-blue-400',
  removal: 'bg-red-900/40 text-red-400',
  role_change: 'bg-amber-900/40 text-amber-400',
}

const FIRST_SEEN_KEY = 'fmp_whats_new_first_seen'
const FIVE_DAYS = 5 * 86400000

export default function WhatsNew() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false) // Only hides for current session
  const [expired, setExpired] = useState(false) // Permanently hidden after 5 days

  useEffect(() => {
    try {
      const firstSeen = localStorage.getItem(FIRST_SEEN_KEY)
      if (firstSeen) {
        // If first seen more than 5 days ago, permanently hide
        if (Date.now() - parseInt(firstSeen) > FIVE_DAYS) {
          setExpired(true)
          return
        }
      } else {
        // First time seeing — record the timestamp
        localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()))
      }
    } catch { /* show by default */ }

    fetch('/api/changelog').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.entries) setEntries(d.entries)
    }).catch(() => {})
  }, [])

  function dismiss() {
    setDismissed(true) // Session-only dismiss — comes back on next app open
  }

  if (expired || dismissed || entries.length === 0) return null

  const shown = expanded ? entries : entries.slice(0, 3)

  return (
    <div className="bg-gray-900 border border-violet-800/30 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm">✨</span>
          <p className="text-xs font-bold text-violet-400 uppercase tracking-wide">What&apos;s New</p>
        </div>
        <button onClick={dismiss} className="text-gray-600 hover:text-gray-400 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="px-4 pb-3 space-y-2">
        {shown.map((e, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${TYPE_COLORS[e.change_type] || 'bg-gray-800 text-gray-400'}`}>
              {e.change_type === 'bugfix' ? 'fix' : e.change_type}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-white font-medium">{e.title}</p>
              {e.description && <p className="text-[11px] text-gray-500 line-clamp-1">{e.description}</p>}
            </div>
          </div>
        ))}
        {entries.length > 3 && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-violet-400 hover:text-violet-300 font-medium">
            {expanded ? 'Show less' : `+ ${entries.length - 3} more`}
          </button>
        )}
      </div>
    </div>
  )
}
