'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'fmp_photo_prompt_dismissed_v1'

export default function PhotoPromptBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return
    } catch {}

    fetch('/api/team/users/avatar?view=true')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.avatarUrl) setVisible(true)
      })
      .catch(() => {})
  }, [])

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="bg-amber-950/60 border border-amber-700/50 rounded-2xl p-4 mb-2 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-amber-800/60 flex items-center justify-center flex-shrink-0">
        <svg className="w-5 h-5 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-amber-200 text-sm font-semibold">Add a profile photo</p>
        <p className="text-amber-400 text-xs mt-0.5">Help your team put a face to the name.</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href="/settings"
          onClick={dismiss}
          className="text-xs font-semibold text-amber-300 hover:text-amber-100 transition-colors"
        >
          Add photo →
        </a>
        <button onClick={dismiss} className="text-amber-600 hover:text-amber-400 transition-colors ml-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
