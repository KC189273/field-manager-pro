'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

interface Session {
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'developer'
}

export default function ChecklistPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => { if (d) setSession(d) })
  }, [router])

  if (!session) return null

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-violet-600/20 flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Opening / Closing Checklist</h1>
        <p className="text-gray-500 text-sm">This feature is coming soon.</p>
      </div>
    </div>
  )
}
