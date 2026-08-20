'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Session { id: string; fullName: string; role: string }
interface FeatureRequest {
  id: string; submitted_by_name: string; submitted_by_role: string
  title: string; description: string; category: string | null
  status: string; dev_notes: string | null; reviewed_by: string | null
  created_at: string; updated_at: string
}

const CATEGORIES = ['New Feature', 'Improvement', 'Bug Fix', 'UI/UX', 'Reporting', 'Other']
const STATUS_COLORS: Record<string, string> = {
  submitted: 'text-amber-400 bg-amber-900/30 border-amber-800/50',
  under_review: 'text-blue-400 bg-blue-900/30 border-blue-800/50',
  planned: 'text-violet-400 bg-violet-900/30 border-violet-800/50',
  in_progress: 'text-cyan-400 bg-cyan-900/30 border-cyan-800/50',
  completed: 'text-green-400 bg-green-900/30 border-green-800/50',
  declined: 'text-gray-400 bg-gray-800/50 border-gray-700/50',
}

export default function FeatureRequestsPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [requests, setRequests] = useState<FeatureRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Developer review state
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [reviewStatus, setReviewStatus] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
    loadRequests()
  }, [])

  async function loadRequests() {
    setLoading(true)
    const res = await fetch('/api/feature-requests')
    if (res.ok) {
      const data = await res.json()
      setRequests(data.requests ?? [])
    }
    setLoading(false)
  }

  async function submit() {
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    setMessage(null)
    const res = await fetch('/api/feature-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), description: description.trim(), category }),
    })
    setSubmitting(false)
    if (res.ok) {
      setMessage({ text: 'Feature request submitted — the dev team has been notified!', type: 'success' })
      setShowForm(false)
      setTitle(''); setDescription(''); setCategory('')
      loadRequests()
    } else {
      const d = await res.json().catch(() => ({}))
      setMessage({ text: d.error || 'Failed to submit', type: 'error' })
    }
  }

  async function updateStatus() {
    if (!reviewId || !reviewStatus) return
    setReviewing(true)
    await fetch('/api/feature-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: reviewId, status: reviewStatus, devNotes: reviewNotes }),
    })
    setReviewing(false)
    setReviewId(null)
    loadRequests()
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role as never} fullName={session.fullName} />}

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold text-white">Feature Requests</h1>
          <button onClick={() => setShowForm(!showForm)} className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors">
            {showForm ? 'Cancel' : '+ New Request'}
          </button>
        </div>
        <p className="text-gray-500 text-sm mb-5">Suggest changes or improvements for the app.</p>

        {message && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
            {message.text}
          </div>
        )}

        {showForm && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Short description of the change"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500">
                <option value="">— Select —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Description</label>
              <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Describe what you'd like changed and why it would help..."
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 resize-none" />
            </div>
            <button onClick={submit} disabled={submitting || !title.trim() || !description.trim()}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm text-center py-10">Loading...</p>
        ) : requests.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">No feature requests yet.</p>
            <p className="text-gray-600 text-xs mt-1">Tap "+ New Request" to suggest a change.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(req => (
              <div key={req.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <button onClick={() => setExpandedId(expandedId === req.id ? null : req.id)} className="w-full px-5 py-4 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm">{req.title}</p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {req.submitted_by_name} · {new Date(req.created_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })}
                        {req.category && ` · ${req.category}`}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${STATUS_COLORS[req.status] || STATUS_COLORS.submitted}`}>
                      {req.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </button>

                {expandedId === req.id && (
                  <div className="border-t border-gray-800 px-5 py-4 space-y-3">
                    <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{req.description}</p>
                    {req.dev_notes && (
                      <div className="bg-violet-900/20 border border-violet-800/40 rounded-xl px-4 py-3">
                        <p className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-1">Developer Response</p>
                        <p className="text-sm text-gray-300">{req.dev_notes}</p>
                        {req.reviewed_by && <p className="text-xs text-gray-500 mt-1">— {req.reviewed_by}</p>}
                      </div>
                    )}
                    {session?.role === 'developer' && (
                      <div className="pt-2 border-t border-gray-800">
                        {reviewId !== req.id ? (
                          <button onClick={() => { setReviewId(req.id); setReviewStatus(req.status); setReviewNotes(req.dev_notes || '') }}
                            className="text-xs font-semibold text-violet-400 hover:text-violet-300">Update Status</button>
                        ) : (
                          <div className="space-y-2">
                            <select value={reviewStatus} onChange={e => setReviewStatus(e.target.value)}
                              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500">
                              <option value="submitted">Submitted</option>
                              <option value="under_review">Under Review</option>
                              <option value="planned">Planned</option>
                              <option value="in_progress">In Progress</option>
                              <option value="completed">Completed</option>
                              <option value="declined">Declined</option>
                            </select>
                            <textarea rows={2} value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
                              placeholder="Developer notes..." className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 resize-none" />
                            <div className="flex gap-2">
                              <button onClick={updateStatus} disabled={reviewing}
                                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl text-sm">
                                {reviewing ? 'Saving...' : 'Save'}
                              </button>
                              <button onClick={() => setReviewId(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2 rounded-xl text-sm">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
