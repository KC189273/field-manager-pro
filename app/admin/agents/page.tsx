'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Action {
  id: string
  run_id: string
  agent: string
  type: string
  risk_level: string
  status: string
  account_id: string | null
  account_name: string | null
  industry: string | null
  target_email: string | null
  subject: string | null
  body: string | null
  reason: string | null
  reviewed_by: string | null
  created_at: string
  reviewed_at: string | null
  executed_at: string | null
  result: string | null
}

interface Run {
  id: string
  agent: string
  trigger: string
  status: string
  summary: string | null
  input_tokens: number
  output_tokens: number
  cost_usd: number
  error: string | null
  created_at: string
  finished_at: string | null
}

interface Session {
  id: string
  fullName: string
  role: string
}

const VERTICAL_LABELS: Record<string, string> = {
  wireless_retail: 'Wireless Retail',
  barbershop: 'Barbershop',
}

function verticalLabel(industry: string | null): string {
  return VERTICAL_LABELS[industry ?? ''] ?? industry ?? 'Unknown'
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function agentColor(agent: string): string {
  switch (agent) {
    case 'health': return 'bg-green-900/30 text-green-400 border-green-800/40'
    case 'onboarding': return 'bg-blue-900/30 text-blue-400 border-blue-800/40'
    case 'support': return 'bg-amber-900/30 text-amber-400 border-amber-800/40'
    case 'growth': return 'bg-violet-900/30 text-violet-400 border-violet-800/40'
    default: return 'bg-gray-900/30 text-gray-400 border-gray-800/40'
  }
}

export default function AgentInboxPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [tab, setTab] = useState<'pending' | 'auto' | 'runs' | 'health'>('pending')
  const [actions, setActions] = useState<Action[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [spend, setSpend] = useState<{ today: number; total: number }>({ today: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [testResults, setTestResults] = useState<{ test: string; passed: boolean; detail: string }[] | null>(null)
  const [testRunning, setTestRunning] = useState(false)

  async function runRegressionTest() {
    setTestRunning(true)
    setTestResults(null)
    const res = await fetch('/api/agents/test')
    if (res.ok) {
      const d = await res.json()
      setTestResults(d.results)
      showMsg(d.passed ? 'All tests passed.' : 'Some tests failed.', d.passed ? 'success' : 'error')
    } else {
      showMsg('Test run failed', 'error')
    }
    setTestRunning(false)
  }

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (d) setSession(d)
    })
  }, [])

  async function loadData() {
    setLoading(true)
    const [actRes, runRes] = await Promise.all([
      fetch('/api/agents/actions?status=all&limit=100'),
      fetch('/api/agents/runs'),
    ])
    if (actRes.ok) {
      const d = await actRes.json()
      setActions(d.actions ?? [])
    }
    if (runRes.ok) {
      const d = await runRes.json()
      setRuns(d.runs ?? [])
      setSpend(d.spend ?? { today: 0, total: 0 })
    }
    setLoading(false)
  }

  useEffect(() => { if (session) loadData() }, [session])

  function showMsg(text: string, type: 'success' | 'error' = 'success') {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleAction(actionId: string, action: 'approve' | 'reject') {
    setActing(actionId + action)
    const res = await fetch('/api/agents/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId, action }),
    })
    if (res.ok) {
      showMsg(action === 'approve' ? 'Approved and executed.' : 'Rejected.')
      await loadData()
    } else {
      const d = await res.json().catch(() => ({}))
      showMsg(d.error ?? 'Action failed', 'error')
    }
    setActing(null)
  }

  async function handleEdit(actionId: string) {
    const res = await fetch('/api/agents/actions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId, subject: editSubject, body: editBody }),
    })
    if (res.ok) {
      showMsg('Draft updated.')
      setEditingId(null)
      await loadData()
    } else {
      showMsg('Failed to update draft', 'error')
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const pending = actions.filter(a => a.status === 'pending')
  const autoRun = actions.filter(a => a.status === 'auto_executed')

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role as 'developer'} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Agent Inbox</h1>
          <div className="text-right">
            <p className="text-xs text-gray-500">Today: ${spend.today.toFixed(4)}</p>
            <p className="text-xs text-gray-600">Total: ${spend.total.toFixed(4)}</p>
          </div>
        </div>

        {message && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
            message.type === 'error'
              ? 'bg-red-900/40 border border-red-700 text-red-300'
              : 'bg-green-900/40 border border-green-700 text-green-300'
          }`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {(['pending', 'auto', 'runs', 'health'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === t ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {t === 'pending' ? `Pending (${pending.length})` : t === 'auto' ? 'Auto' : t === 'runs' ? 'Runs' : 'Health'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ── PENDING QUEUE ── */}
            {tab === 'pending' && (
              <div className="space-y-4">
                {pending.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-12">No pending actions. All clear.</p>
                ) : pending.map(a => (
                  <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${agentColor(a.agent)}`}>
                            {a.agent}
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-gray-800 text-gray-400 border-gray-700">
                            {a.type}
                          </span>
                          {a.industry && (
                            <span className="text-[10px] text-gray-500">{verticalLabel(a.industry)}</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-white">{a.account_name ?? 'Unknown account'}</p>
                        {a.target_email && <p className="text-xs text-gray-500">To: {a.target_email}</p>}
                      </div>
                      <p className="text-[10px] text-gray-600 shrink-0">{fmtTime(a.created_at)}</p>
                    </div>

                    {a.reason && (
                      <div className="bg-gray-800/50 rounded-xl px-3 py-2">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1">Why</p>
                        <p className="text-xs text-gray-300">{a.reason}</p>
                      </div>
                    )}

                    {a.subject && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1">Subject</p>
                        <p className="text-sm text-white">{a.subject}</p>
                      </div>
                    )}

                    {a.body && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1">Draft</p>
                        <div className="bg-gray-800/50 rounded-xl px-3 py-2 text-xs text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {a.body}
                        </div>
                      </div>
                    )}

                    {/* Edit form */}
                    {editingId === a.id ? (
                      <div className="space-y-2 border-t border-gray-700 pt-3">
                        <input
                          value={editSubject}
                          onChange={e => setEditSubject(e.target.value)}
                          placeholder="Subject"
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                        />
                        <textarea
                          value={editBody}
                          onChange={e => setEditBody(e.target.value)}
                          rows={6}
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleEdit(a.id)} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-semibold text-white transition-colors">
                            Save Edit
                          </button>
                          <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm text-gray-400 transition-colors">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => handleAction(a.id, 'approve')}
                          disabled={acting === a.id + 'approve'}
                          className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                        >
                          {acting === a.id + 'approve' ? 'Sending…' : 'Approve & Send'}
                        </button>
                        <button
                          onClick={() => { setEditingId(a.id); setEditSubject(a.subject ?? ''); setEditBody(a.body ?? '') }}
                          className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleAction(a.id, 'reject')}
                          disabled={acting === a.id + 'reject'}
                          className="px-4 py-2.5 rounded-xl bg-red-900/50 hover:bg-red-800/50 disabled:opacity-50 text-red-400 text-sm font-semibold transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── AUTO-RUN FEED ── */}
            {tab === 'auto' && (
              <div className="space-y-2">
                {autoRun.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-12">No auto-run actions yet.</p>
                ) : autoRun.map(a => (
                  <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${agentColor(a.agent)}`}>
                          {a.agent}
                        </span>
                        <span className="text-[10px] text-gray-600">{a.type}</span>
                        {a.industry && <span className="text-[10px] text-gray-600">{verticalLabel(a.industry)}</span>}
                      </div>
                      <p className="text-sm text-white">{a.account_name ?? 'Unknown'}</p>
                      {a.reason && <p className="text-xs text-gray-500 mt-0.5 truncate">{a.reason}</p>}
                    </div>
                    <p className="text-[10px] text-gray-600 shrink-0">{fmtTime(a.created_at)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── RUNS LOG ── */}
            {tab === 'runs' && (
              <div className="space-y-2">
                {runs.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-12">No runs yet.</p>
                ) : runs.map(r => (
                  <div key={r.id} className={`bg-gray-900 border rounded-xl px-4 py-3 ${r.status === 'error' ? 'border-red-800/50' : 'border-gray-800'}`}>
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${agentColor(r.agent)}`}>
                          {r.agent}
                        </span>
                        <span className="text-[10px] text-gray-600">{r.trigger}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          r.status === 'ok' ? 'bg-green-900/30 text-green-400' : r.status === 'error' ? 'bg-red-900/30 text-red-400' : 'bg-amber-900/30 text-amber-400'
                        }`}>
                          {r.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-600 shrink-0">{fmtTime(r.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500">
                      <span>{r.input_tokens + r.output_tokens} tokens</span>
                      <span>${r.cost_usd.toFixed(4)}</span>
                      {r.finished_at && <span>{Math.round((new Date(r.finished_at).getTime() - new Date(r.created_at).getTime()) / 1000)}s</span>}
                    </div>
                    {r.status === 'error' && r.error && (
                      <p className="text-xs text-red-400 mt-1.5 bg-red-900/20 rounded-lg px-2 py-1">{r.error}</p>
                    )}
                    {r.summary && r.status === 'ok' && (
                      <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{r.summary.replace(/[*#|]/g, '').trim().slice(0, 200)}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* ── HEALTH / REGRESSION TESTS ── */}
            {tab === 'health' && (
              <div className="space-y-4">
                <button
                  onClick={runRegressionTest}
                  disabled={testRunning}
                  className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {testRunning ? 'Running Tests…' : 'Run Regression Tests'}
                </button>

                {testResults && (
                  <div className="space-y-2">
                    {testResults.map((t, i) => (
                      <div key={i} className={`px-4 py-3 rounded-xl border ${t.passed ? 'bg-green-900/20 border-green-800/40' : 'bg-red-900/20 border-red-800/40'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${t.passed ? 'text-green-400' : 'text-red-400'}`}>
                            {t.passed ? '✓' : '✗'}
                          </span>
                          <span className="text-sm text-white">{t.test}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 ml-5">{t.detail}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick stats */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Agent Crew Stats</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">Total Runs</p>
                      <p className="text-white font-semibold">{runs.length}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Today's Spend</p>
                      <p className="text-white font-semibold">${spend.today.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Lifetime Spend</p>
                      <p className="text-white font-semibold">${spend.total.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Pending Actions</p>
                      <p className="text-white font-semibold">{pending.length}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
