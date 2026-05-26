'use client'

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'fmp_welcomed_v1'

const ROLE_TIPS: Record<string, { title: string; steps: string[] }> = {
  employee: {
    title: "Welcome to Field Manager Pro!",
    steps: [
      "Clock in when you arrive at your shift using the Clock In / Out page.",
      "Check your upcoming schedule on the dashboard.",
      "Submit opening and closing checklists from the Checklist page.",
    ],
  },
  manager: {
    title: "Welcome, District Manager!",
    steps: [
      "Add your stores under DM Store Visit → Manage Stores.",
      "Bulk-import your employees under Team → Bulk Import.",
      "Publish your store schedule so employees can see their shifts.",
    ],
  },
  default: {
    title: "Welcome to Field Manager Pro!",
    steps: [
      "Set up your organization under Team.",
      "Add store locations under DM Store Visit.",
      "Configure schedules and start tracking your field team.",
    ],
  },
}

export default function WelcomeBanner({ role }: { role: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    } catch {}
  }, [])

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setVisible(false)
  }

  if (!visible) return null

  const tips = ROLE_TIPS[role] ?? ROLE_TIPS.default

  return (
    <div className="bg-violet-950 border border-violet-700 rounded-2xl p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-white font-semibold text-sm">{tips.title}</p>
        </div>
        <button onClick={dismiss} className="text-violet-400 hover:text-violet-200 text-lg leading-none flex-shrink-0">×</button>
      </div>
      <p className="text-violet-300 text-xs mb-2">Here's how to get started:</p>
      <ol className="space-y-1.5">
        {tips.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-violet-200">
            <span className="flex-shrink-0 w-4 h-4 rounded-full bg-violet-700 text-violet-300 flex items-center justify-center font-semibold text-[10px] mt-0.5">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <button onClick={dismiss} className="mt-4 text-xs text-violet-400 hover:text-violet-200 transition-colors font-medium">
        Got it, dismiss →
      </button>
    </div>
  )
}
