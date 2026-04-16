'use client'

import { useEffect, useRef, useState } from 'react'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'rdm' | 'developer'

interface SessionUser {
  id: string
  fullName: string
  role: Role
}

interface Expense {
  id: string
  user_id: string
  submitted_by: string
  date: string
  amount: string
  category: string
  description: string | null
  receipt_key: string | null
  receipt_url: string | null
  status: 'pending' | 'approved' | 'rejected' | 'paid'
  rejection_reason: string | null
  approved_at: string | null
  paid_at: string | null
  user_full_name: string
  submitter_full_name: string
  approver_full_name: string | null
}

interface TeamUser {
  id: string
  full_name: string
  role: string
}

const CATEGORIES = ['Mileage', 'Meals', 'Supplies', 'Contest', 'Other']

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  approved: 'bg-green-500/15 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  paid: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
}

export default function ExpensesPage() {
  const [session, setSession] = useState<SessionUser | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<string>('pending')
  const [showHistory, setShowHistory] = useState(false)
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')

  // Form state
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    category: 'Meals',
    description: '',
    onBehalfOf: '',
  })
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptKey, setReceiptKey] = useState<string | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reject modal
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d) setSession(d)
      })
  }, [])

  useEffect(() => {
    if (!session) return
    loadExpenses()
    if (session.role === 'developer' || session.role === 'owner' || session.role === 'sales_director' || session.role === 'manager' || session.role === 'ops_manager') {
      fetch('/api/team/users')
        .then((r) => r.json())
        .then((d) => setTeamUsers(d.users ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => {
    if (!showHistory || !historyFrom || !historyTo) return
    loadExpenses(historyFrom, historyTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFrom, historyTo])

  async function loadExpenses(from?: string, to?: string) {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.size ? '?' + params.toString() : ''
    const res = await fetch(`/api/expenses${qs}`)
    const data = await res.json()
    setExpenses(data.expenses ?? [])
    setLoading(false)
  }

  async function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setReceiptFile(file)
    setReceiptPreview(URL.createObjectURL(file))
    setReceiptKey(null)

    // Auto-upload
    setUploading(true)
    try {
      const urlRes = await fetch('/api/expenses/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      if (!urlRes.ok) {
        const err = await urlRes.json()
        alert('Receipt upload failed: ' + (err.error ?? urlRes.status))
        setUploading(false)
        return
      }
      const { url, key } = await urlRes.json()
      const s3Res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!s3Res.ok) {
        const text = await s3Res.text()
        alert('S3 upload failed (' + s3Res.status + '): ' + text.slice(0, 200))
        setUploading(false)
        return
      }
      setReceiptKey(key)
    } catch (err) {
      alert('Receipt upload failed: ' + String(err))
    }
    setUploading(false)
  }

  async function handleScan() {
    if (!receiptKey) return
    setScanning(true)
    try {
      const res = await fetch('/api/expenses/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptKey }),
      })
      const { data, error } = await res.json()
      if (error) { alert('Could not read receipt. Please fill in manually.'); return }
      setForm((f) => ({
        ...f,
        date: data.date ?? f.date,
        amount: data.amount != null ? String(data.amount) : f.amount,
        category: CATEGORIES.includes(data.category) ? data.category : f.category,
        description: data.description ?? f.description,
      }))
    } finally {
      setScanning(false)
    }
  }

  async function handleSubmit() {
    if (!form.amount || !form.date || !form.category) {
      alert('Please fill in date, amount, and category.')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        date: form.date,
        amount: parseFloat(form.amount),
        category: form.category,
        description: form.description || null,
        receiptKey: receiptKey || null,
      }
      if (form.onBehalfOf) body.userId = form.onBehalfOf

      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error ?? 'Submit failed')
        return
      }
      setShowForm(false)
      setForm({ date: new Date().toISOString().slice(0, 10), amount: '', category: 'Meals', description: '', onBehalfOf: '' })
      setReceiptFile(null)
      setReceiptPreview(null)
      setReceiptKey(null)
      await loadExpenses()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAction(expenseId: string, action: 'approve' | 'pay') {
    setActionLoading(expenseId + action)
    try {
      await fetch('/api/expenses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenseId, action }),
      })
      await loadExpenses()
    } finally {
      setActionLoading(null)
    }
  }

  async function handleReject() {
    if (!rejectId || !rejectReason.trim()) return
    setActionLoading(rejectId + 'reject')
    try {
      const res = await fetch('/api/expenses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenseId: rejectId, action: 'reject', rejectionReason: rejectReason }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error ?? 'Reject failed')
        return
      }
      setRejectId(null)
      setRejectReason('')
      await loadExpenses()
    } finally {
      setActionLoading(null)
    }
  }

  const canApprove = session?.role === 'owner' || session?.role === 'sales_director' || session?.role === 'developer'
  const canViewDetail = session?.role === 'ops_manager' || session?.role === 'owner' || session?.role === 'sales_director' || session?.role === 'developer'
  const canSubmit = session && session.role !== 'employee'
  const canOnBehalf = session?.role === 'owner' || session?.role === 'sales_director' || session?.role === 'developer'

  const [detailExpense, setDetailExpense] = useState<Expense | null>(null)

  function openHistory() {
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    setHistoryFrom(from)
    setHistoryTo(to)
    setShowHistory(true)
    setFilter('paid')
    loadExpenses(from, to)
  }

  function closeHistory() {
    setShowHistory(false)
    setFilter('pending')
    loadExpenses()
  }

  const filtered = expenses.filter((e) => e.status === filter)

  const [expandedCard, setExpandedCard] = useState<string | null>(null)

  const totals = {
    pending: expenses.filter((e) => e.status === 'pending').reduce((s, e) => s + parseFloat(e.amount), 0),
    approved: expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + parseFloat(e.amount), 0),
    paid: expenses.filter((e) => e.status === 'paid').reduce((s, e) => s + parseFloat(e.amount), 0),
    rejected: expenses.filter((e) => e.status === 'rejected').reduce((s, e) => s + parseFloat(e.amount), 0),
  }

  const byStatus: Record<string, Expense[]> = {
    pending: expenses.filter((e) => e.status === 'pending'),
    approved: expenses.filter((e) => e.status === 'approved'),
    paid: expenses.filter((e) => e.status === 'paid'),
    rejected: expenses.filter((e) => e.status === 'rejected'),
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-24">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="pt-14">
        <div className="px-4 pt-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold">Expenses</h1>
            <div className="flex items-center gap-2">
              {canViewDetail && !showHistory && (
                <button
                  onClick={openHistory}
                  className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors border bg-gray-800 text-gray-400 border-gray-700 hover:text-white"
                >
                  History
                </button>
              )}
              {canSubmit && !showHistory && (
                <button
                  onClick={() => setShowForm(true)}
                  className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
                >
                  + Submit
                </button>
              )}
            </div>
          </div>

          {/* History date range bar */}
          {showHistory && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-white">Expense History</p>
                <button
                  onClick={closeHistory}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  ← Back to Active
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">From</label>
                  <input
                    type="date"
                    value={historyFrom}
                    onChange={(e) => setHistoryFrom(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">To</label>
                  <input
                    type="date"
                    value={historyTo}
                    onChange={(e) => setHistoryTo(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Summary cards — expandable */}
          <div className="space-y-2 mb-5">
            {(showHistory
              ? [
                  { key: 'paid', label: 'Paid', amount: totals.paid, color: 'text-blue-400', border: 'border-blue-500/20' },
                  { key: 'approved', label: 'Approved (Unpaid)', amount: totals.approved, color: 'text-green-400', border: 'border-green-500/20' },
                ]
              : [
                  { key: 'pending', label: 'Pending', amount: totals.pending, color: 'text-yellow-400', border: 'border-yellow-500/20' },
                  { key: 'rejected', label: 'Rejected', amount: totals.rejected, color: 'text-red-400', border: 'border-red-500/20' },
                ]
            ).map((s) => {
              const isOpen = expandedCard === s.key
              const rows = byStatus[s.key] ?? []
              return (
                <div key={s.key} className={`bg-gray-900 rounded-xl border ${isOpen ? s.border : 'border-gray-800'} overflow-hidden`}>
                  <button
                    className="w-full flex items-center justify-between px-4 py-3"
                    onClick={() => setExpandedCard(isOpen ? null : s.key)}
                  >
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-gray-500 w-16 text-left">{s.label}</p>
                      <p className={`font-bold text-sm ${s.color}`}>${s.amount.toFixed(2)}</p>
                      {rows.length > 0 && (
                        <span className="text-xs text-gray-600">{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    <svg
                      className={`w-4 h-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isOpen && rows.length > 0 && (
                    <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                      {rows.map((exp) => (
                        <div key={exp.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm text-white font-medium truncate">{exp.category}</p>
                            <p className="text-xs text-gray-500 truncate">{exp.user_full_name} · {exp.date}</p>
                          </div>
                          <p className="text-sm font-semibold text-white shrink-0">${parseFloat(exp.amount).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {isOpen && rows.length === 0 && (
                    <div className="border-t border-gray-800 px-4 py-3">
                      <p className="text-xs text-gray-600">No {s.label.toLowerCase()} expenses</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
            {(showHistory ? ['paid', 'approved'] : ['pending', 'rejected']).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${
                  filter === f ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Expense list */}
        <div className="px-4 space-y-3">
          {loading ? (
            <div className="text-center text-gray-500 py-12">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-500 py-12">No expenses found</div>
          ) : (
            filtered.map((exp) => (
              <div
                key={exp.id}
                className={`bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden ${canViewDetail ? 'cursor-pointer hover:border-gray-700 transition-colors' : ''}`}
                onClick={() => canViewDetail && setDetailExpense(exp)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="font-semibold text-white">{exp.category}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {exp.user_full_name}
                        {exp.submitter_full_name !== exp.user_full_name && (
                          <span className="text-gray-600"> · submitted by {exp.submitter_full_name}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-lg text-white">${parseFloat(exp.amount).toFixed(2)}</p>
                      <p className="text-xs text-gray-500">{exp.date}</p>
                    </div>
                  </div>

                  {exp.description && (
                    <p className="text-sm text-gray-400 mb-3">{exp.description}</p>
                  )}

                  <div className="flex items-center justify-between">
                    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium capitalize ${STATUS_COLORS[exp.status]}`}>
                      {exp.status}
                    </span>

                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {exp.receipt_url && !canViewDetail && (
                        <a
                          href={exp.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-violet-400 hover:text-violet-300 underline"
                        >
                          Receipt
                        </a>
                      )}

                      {canApprove && exp.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleAction(exp.id, 'approve')}
                            disabled={actionLoading === exp.id + 'approve'}
                            className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => { setRejectId(exp.id); setRejectReason('') }}
                            className="text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-1.5 rounded-lg font-medium transition-colors border border-red-600/30"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {canApprove && exp.status === 'approved' && (
                        <button
                          onClick={() => handleAction(exp.id, 'pay')}
                          disabled={actionLoading === exp.id + 'pay'}
                          className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                        >
                          Mark Paid
                        </button>
                      )}

                      {canViewDetail && (
                        <span className="text-xs text-gray-600">Tap to view</span>
                      )}
                    </div>
                  </div>

                  {exp.status === 'rejected' && exp.rejection_reason && (
                    <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <p className="text-xs text-red-400 font-semibold mb-1">Rejection reason:</p>
                      <p className="text-sm text-gray-300">{exp.rejection_reason}</p>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Submit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h2 className="font-bold text-lg">Submit Expense</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="p-5 space-y-4">
              {/* Receipt upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Receipt Photo (optional)</label>
                {receiptPreview ? (
                  <div className="relative">
                    <img src={receiptPreview} alt="Receipt" className="w-full max-h-48 object-contain rounded-xl bg-gray-800" />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={handleScan}
                        disabled={scanning || !receiptKey || uploading}
                        className="flex-1 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-medium transition-colors"
                      >
                        {scanning ? 'Scanning...' : uploading ? 'Uploading...' : 'Scan Receipt'}
                      </button>
                      <button
                        onClick={() => { setReceiptFile(null); setReceiptPreview(null); setReceiptKey(null) }}
                        className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-xl border border-gray-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-700 rounded-xl py-8 text-center text-gray-500 hover:border-violet-500 hover:text-violet-400 transition-colors"
                  >
                    <p className="text-sm font-medium">Tap to attach receipt</p>
                    <p className="text-xs mt-1">JPG, PNG, or PDF</p>
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={handleReceiptChange}
                />
              </div>

              {/* On behalf of (owner/developer only) */}
              {canOnBehalf && teamUsers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">On Behalf Of</label>
                  <select
                    value={form.onBehalfOf}
                    onChange={(e) => setForm((f) => ({ ...f, onBehalfOf: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Myself</option>
                    {teamUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                >
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Description (optional)</label>
                <textarea
                  rows={3}
                  placeholder="What was this expense for?"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting || uploading}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit Expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailExpense && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setDetailExpense(null)}>
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h2 className="font-bold text-lg">Expense Detail</h2>
              <button onClick={() => setDetailExpense(null)} className="text-gray-500 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="p-5 space-y-4">
              {/* Receipt image */}
              {detailExpense.receipt_url && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Receipt</p>
                  <img
                    src={detailExpense.receipt_url}
                    alt="Receipt"
                    className="w-full rounded-xl bg-gray-800 object-contain max-h-72"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  <a
                    href={detailExpense.receipt_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs text-violet-400 hover:text-violet-300 underline mt-2"
                  >
                    Open full size
                  </a>
                </div>
              )}

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">Employee</p>
                  <p className="text-sm text-white font-medium">{detailExpense.user_full_name}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">Date</p>
                  <p className="text-sm text-white font-medium">{detailExpense.date}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">Category</p>
                  <p className="text-sm text-white font-medium">{detailExpense.category}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">Amount</p>
                  <p className="text-sm text-white font-bold">${parseFloat(detailExpense.amount).toFixed(2)}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3 col-span-2">
                  <p className="text-xs text-gray-500 mb-1">Status</p>
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-medium capitalize ${STATUS_COLORS[detailExpense.status]}`}>
                    {detailExpense.status}
                  </span>
                </div>
                {detailExpense.submitter_full_name !== detailExpense.user_full_name && (
                  <div className="bg-gray-800 rounded-xl p-3 col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Submitted By</p>
                    <p className="text-sm text-white">{detailExpense.submitter_full_name}</p>
                  </div>
                )}
                {detailExpense.description && (
                  <div className="bg-gray-800 rounded-xl p-3 col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Description</p>
                    <p className="text-sm text-white">{detailExpense.description}</p>
                  </div>
                )}
                {detailExpense.approver_full_name && (
                  <div className="bg-gray-800 rounded-xl p-3 col-span-2">
                    <p className="text-xs text-gray-500 mb-1">
                      {detailExpense.status === 'rejected' ? 'Rejected By' : 'Approved By'}
                    </p>
                    <p className="text-sm text-white">{detailExpense.approver_full_name}</p>
                  </div>
                )}
                {detailExpense.status === 'rejected' && detailExpense.rejection_reason && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 col-span-2">
                    <p className="text-xs text-red-400 font-semibold mb-1">Rejection Reason</p>
                    <p className="text-sm text-gray-300">{detailExpense.rejection_reason}</p>
                  </div>
                )}
              </div>

              {/* Approve/reject/pay actions */}
              {canApprove && detailExpense.status === 'pending' && (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={async () => { await handleAction(detailExpense.id, 'approve'); setDetailExpense(null) }}
                    disabled={!!actionLoading}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => { setDetailExpense(null); setRejectId(detailExpense.id); setRejectReason('') }}
                    className="flex-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 font-semibold py-3 rounded-xl transition-colors border border-red-600/30"
                  >
                    Reject
                  </button>
                </div>
              )}
              {canApprove && detailExpense.status === 'approved' && (
                <button
                  onClick={async () => { await handleAction(detailExpense.id, 'pay'); setDetailExpense(null) }}
                  disabled={!!actionLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  Mark Paid
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800 p-5">
            <h2 className="font-bold text-lg mb-4">Reject Expense</h2>
            <p className="text-sm text-gray-400 mb-3">You must provide a reason for rejection. This will be emailed to the submitter.</p>
            <textarea
              rows={4}
              placeholder="Reason for rejection..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 resize-none mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setRejectId(null); setRejectReason('') }}
                className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || !!actionLoading}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
