'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'

export default function GetStartedPage() {
  const [form, setForm] = useState({
    businessName: '',
    contactName: '',
    email: '',
    phone: '',
    teamSize: '',
    message: '',
  })
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/get-started', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setSubmitted(true)
      } else {
        setError('Something went wrong. Please try again or email us directly.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-600 mb-5">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Request received!</h1>
          <p className="text-gray-400 text-sm mb-6">
            Thanks for your interest in Field Manager Pro. We'll be in touch within one business day to get your team set up.
          </p>
          <Link
            href="/login"
            className="text-violet-400 hover:text-violet-300 text-sm transition-colors"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Get started with FMP</h1>
          <p className="text-gray-400 text-sm mt-1">Tell us about your business and we'll get you set up.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl p-6 border border-gray-800 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Business Name</label>
            <input
              type="text"
              required
              value={form.businessName}
              onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))}
              placeholder="Acme Field Services"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Your Name</label>
            <input
              type="text"
              required
              value={form.contactName}
              onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
              placeholder="Jane Smith"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Work Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="jane@yourcompany.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Phone <span className="text-gray-600">(optional)</span></label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="(555) 000-0000"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Team Size</label>
            <select
              required
              value={form.teamSize}
              onChange={e => setForm(f => ({ ...f, teamSize: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            >
              <option value="" disabled>Select team size</option>
              <option value="1–10">1–10 employees</option>
              <option value="11–50">11–50 employees</option>
              <option value="51–200">51–200 employees</option>
              <option value="200+">200+ employees</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Anything else? <span className="text-gray-600">(optional)</span></label>
            <textarea
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              placeholder="Tell us about your field operations..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-colors"
          >
            {loading ? 'Sending…' : 'Request Access'}
          </button>
        </form>

        <p className="text-center mt-4">
          <Link href="/login" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
            Already have an account? Sign in →
          </Link>
        </p>
      </div>
    </div>
  )
}
