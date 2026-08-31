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

const DISMISS_KEY = 'fmp_whats_new_dismissed'

export default function WhatsNew() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    // Check if dismissed
    try {
      const d = localStorage.getItem(DISMISS_KEY)
      // Show again if dismissed more than 7 days ago or never dismissed
      if (!d || Date.now() - parseInt(d) > 7 * 86400000) {
        setDismissed(false)
      }
    } catch { setDismissed(false) }

    fetch('/api/changelog').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.entries) setEntries(d.entries)
    }).catch(() => {})
  }, [])

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
  }

  if (dismissed || entries.length === 0) return null

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
