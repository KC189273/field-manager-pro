'use client'

import { useState, FormEvent } from 'react'

export default function GetStartedPage() {
  const [form, setForm] = useState({
    businessName: '',
    contactName: '',
    email: '',
    phone: '',
    teamSize: '',
    industry: '',
    challenge: '',
    currentSoftware: '',
    timeline: '',
    message: '',
  })
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

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
        setError('Something went wrong. Please try again.')
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
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
          <h1 className="text-2xl font-bold text-white mb-3">You're on the list!</h1>
          <p className="text-gray-400 text-sm leading-relaxed mb-8">
            Thanks for your interest in Field Manager Pro. We'll reach out within one business day to discuss your team's needs and get you set up.
          </p>
          <button
            type="button"
            onClick={() => { window.location.href = '/login' }}
            className="text-violet-400 hover:text-violet-300 text-sm font-medium transition-colors cursor-pointer"
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    )
  }

  const inputClass = "w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm"
  const labelClass = "block text-sm font-medium text-gray-400 mb-1.5"

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-10">
      <div className="w-full max-w-sm mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Get started with FMP</h1>
          <p className="text-gray-400 text-sm mt-1">Tell us about your business and we'll be in touch.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* Contact info */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact Info</p>

            <div>
              <label className={labelClass}>Business Name</label>
              <input type="text" required value={form.businessName} onChange={set('businessName')}
                placeholder="Acme Field Services" className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Your Name</label>
              <input type="text" required value={form.contactName} onChange={set('contactName')}
                placeholder="Jane Smith" className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Work Email</label>
              <input type="email" required value={form.email} onChange={set('email')}
                placeholder="jane@yourcompany.com" className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Phone Number</label>
              <input type="tel" required value={form.phone} onChange={set('phone')}
                placeholder="(555) 000-0000" className={inputClass} />
            </div>
          </div>

          {/* Business details */}
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">About Your Business</p>

            <div>
              <label className={labelClass}>Team Size</label>
              <select required value={form.teamSize} onChange={set('teamSize')} className={inputClass}>
                <option value="" disabled>Select team size</option>
                <option value="1–10">1–10 employees</option>
                <option value="11–50">11–50 employees</option>
                <option value="51–200">51–200 employees</option>
                <option value="200+">200+ employees</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Industry / Type of Operation</label>
              <select required value={form.industry} onChange={set('industry')} className={inputClass}>
                <option value="" disabled>Select your industry</option>
                <option value="Retail / Merchandising">Retail / Merchandising</option>
                <option value="Field Sales">Field Sales</option>
                <option value="HVAC / Plumbing / Electrical">HVAC / Plumbing / Electrical</option>
                <option value="Landscaping / Grounds">Landscaping / Grounds</option>
                <option value="Cleaning / Janitorial">Cleaning / Janitorial</option>
                <option value="Delivery / Logistics">Delivery / Logistics</option>
                <option value="Construction / Contracting">Construction / Contracting</option>
                <option value="Healthcare / Home Services">Healthcare / Home Services</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Biggest challenge right now</label>
              <select required value={form.challenge} onChange={set('challenge')} className={inputClass}>
                <option value="" disabled>Select your biggest pain point</option>
                <option value="Tracking employee hours accurately">Tracking employee hours accurately</option>
                <option value="Knowing where my team is in the field">Knowing where my team is in the field</option>
                <option value="Managing schedules across multiple locations">Managing schedules across multiple locations</option>
                <option value="Expense tracking and approvals">Expense tracking and approvals</option>
                <option value="Payroll processing taking too long">Payroll processing taking too long</option>
                <option value="Paper-based or manual processes">Paper-based or manual processes</option>
                <option value="Multiple disconnected tools">Multiple disconnected tools</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>What are you currently using? <span className="text-gray-600">(optional)</span></label>
              <input type="text" value={form.currentSoftware} onChange={set('currentSoftware')}
                placeholder="e.g. spreadsheets, QuickBooks, Deputy…" className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>When are you looking to get started?</label>
              <select required value={form.timeline} onChange={set('timeline')} className={inputClass}>
                <option value="" disabled>Select a timeline</option>
                <option value="ASAP">As soon as possible</option>
                <option value="Within 30 days">Within 30 days</option>
                <option value="1–3 months">1–3 months</option>
                <option value="Just exploring">Just exploring for now</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Anything else? <span className="text-gray-600">(optional)</span></label>
              <textarea value={form.message} onChange={set('message')}
                placeholder="Tell us more about your operation, specific needs, or questions…"
                rows={3} className={`${inputClass} resize-none`} />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 transition-colors text-sm"
          >
            {loading ? 'Sending…' : 'Request Access'}
          </button>

          <button
            type="button"
            onClick={() => { window.location.href = '/login' }}
            className="block w-full text-center text-gray-500 hover:text-gray-300 text-sm transition-colors pb-4 cursor-pointer"
          >
            Already have an account? Sign in →
          </button>

        </form>
      </div>
    </div>
  )
}
