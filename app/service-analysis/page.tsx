'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'
import { isCapacitor } from '@/lib/gps-native'

const PDF_URL = 'https://fieldmanagerpro.app/service-analysis.pdf'

function openPdf() {
  if (isCapacitor()) {
    // Use Web Share API when available — on Android this surfaces the native share sheet
    // which includes a Print option via the system print framework.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as any)?.Capacitor
    const isAndroid = cap?.getPlatform?.() === 'android'
    if (isAndroid && navigator.share) {
      navigator.share({ title: 'Service Analysis Sheet', url: PDF_URL }).catch(() => {
        window.open(PDF_URL, '_blank')
      })
    } else {
      // iOS and fallback: open in system browser
      window.open(PDF_URL, '_system')
    }
  } else {
    window.open('/service-analysis.pdf', '_blank')
  }
}

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

export default function ServiceAnalysisPage() {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14 flex flex-col">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-4xl mx-auto w-full flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-white">Service Analysis Sheet</h1>
          <button
            onClick={openPdf}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print / Open
          </button>
        </div>

        {/* Desktop: inline PDF viewer */}
        <div className="hidden sm:flex flex-col flex-1 rounded-2xl overflow-hidden border border-gray-800" style={{ minHeight: '75vh' }}>
          <iframe
            src="/service-analysis.pdf"
            className="w-full flex-1"
            style={{ minHeight: '75vh', border: 'none' }}
            title="Service Analysis Sheet"
          />
        </div>

        {/* Mobile: tap to open card */}
        <div className="sm:hidden bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-900/40 border border-violet-800/50 flex items-center justify-center">
            <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold mb-1">Service Analysis Sheet</p>
            <p className="text-gray-400 text-sm">Tap below to open and print the sheet from your device.</p>
          </div>
          <button
            onClick={openPdf}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
          >
            Open & Print
          </button>
        </div>
      </div>
    </div>
  )
}
