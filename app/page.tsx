'use client'

import { useEffect } from 'react'

/**
 * Root page — static client component served instantly from CDN.
 * Checks auth silently and redirects. Eliminates cold-start black screen
 * that happens when the root is a dynamic server component.
 */
export default function Home() {
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        window.location.replace(d?.id ? '/dashboard' : '/login')
      })
      .catch(() => {
        window.location.replace('/login')
      })
  }, [])

  return (
    <div className="fixed inset-0 bg-gray-950 flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
    </div>
  )
}
