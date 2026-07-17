'use client'

import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const IOS_URL = 'https://apps.apple.com/app/field-manager-pro/id6762024114'
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=app.fieldmanagerpro'

export default function DownloadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <DownloadInner />
    </Suspense>
  )
}

function DownloadInner() {
  const searchParams = useSearchParams()
  const code = searchParams.get('code') ?? ''

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase()
    const isIOS = /iphone|ipad|ipod/.test(ua)
    const isAndroid = /android/.test(ua)

    const timer = setTimeout(() => {
      if (isIOS) window.location.href = IOS_URL
      else if (isAndroid) window.location.href = ANDROID_URL
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-5">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-blue-400 mb-2">Field Manager Pro</h1>
        <p className="text-sm text-zinc-400 mb-2">Book appointments with your barber</p>

        {/* Recommendation banner */}
        <div className="bg-blue-600/10 border border-blue-500/30 rounded-xl px-4 py-3 mb-5">
          <div className="flex items-center justify-center gap-2 mb-1">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-xs font-semibold text-blue-400">Recommended</p>
          </div>
          <p className="text-xs text-zinc-400">Download the app to receive <span className="text-white font-semibold">push notification reminders</span> before your appointments so you never miss a cut!</p>
        </div>

        {code && (
          <div className="bg-zinc-900 border border-blue-500/30 rounded-xl px-4 py-3 mb-5">
            <p className="text-xs text-zinc-500">Your shop code</p>
            <p className="text-2xl font-mono font-bold text-blue-400 tracking-[0.3em] mt-1">{code.toUpperCase()}</p>
            <p className="text-xs text-zinc-600 mt-1">Enter this code after downloading the app</p>
          </div>
        )}

        <div className="space-y-3">
          <a href={IOS_URL}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 rounded-xl transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            Download for iPhone
          </a>

          <a href={ANDROID_URL}
            className="w-full flex items-center justify-center gap-2 bg-zinc-900 border border-zinc-700 hover:border-blue-500 text-white font-semibold py-3.5 rounded-xl transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.523 2.236l1.442-1.442a.5.5 0 00-.707-.707l-1.57 1.57A9.907 9.907 0 0012 .5c-1.74 0-3.384.446-4.813 1.23L5.742.086a.5.5 0 00-.707.707L6.477 2.236A9.96 9.96 0 002 10.5h20a9.96 9.96 0 00-4.477-8.264zM8.5 7a1 1 0 110-2 1 1 0 010 2zm7 0a1 1 0 110-2 1 1 0 010 2zM2 11.5v8a2 2 0 002 2h16a2 2 0 002-2v-8H2z" />
            </svg>
            Download for Android
          </a>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-600 mb-1">Don&apos;t want to download?</p>
          <p className="text-[10px] text-zinc-700 mb-2">You&apos;ll receive email reminders, but won&apos;t get instant push notifications</p>
          <a href={`/customer-signup${code ? `?code=${code}` : ''}`}
            className="text-sm text-blue-400 hover:text-blue-300 font-semibold">
            Continue in browser →
          </a>
        </div>
      </div>
    </div>
  )
}
