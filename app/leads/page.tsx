'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

interface Lead {
  id: string
  first_name: string
  last_name: string
  email: string
  company: string | null
  industry: string | null
  team_size: string | null
  phone: string | null
  notes: string | null
  status: string
  contact_log: Array<{ date: string; note: string }>
  created_at: string
  updated_at: string
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  new: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'New' },
  contacted: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Contacted' },
  follow_up: { bg: 'bg-violet-500/20', text: 'text-violet-400', label: 'Follow Up' },
  converted: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Converted' },
  closed: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Closed' },
}

export default function LeadsPage() {
  const router = useRouter()
  const [session, setSession] = useState<{ role: string; fullName: string } | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [logNote, setLogNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d || d.role !== 'developer') { router.replace('/dashboard'); return }
      setSession(d)
    })
  }, [router])

  const loadLeads = useCallback(() => {
    setLoading(true)
    fetch('/api/demo/leads')
      .then(r => r.json())
      .then(d => setLeads(d.leads ?? []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (session) loadLeads() }, [session, loadLeads])

  async function updateStatus(leadId: string, newStatus: string) {
    setSaving(true)
    await fetch('/api/demo/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, status: newStatus }),
    })
    await loadLeads()
    setSaving(false)
  }

  async function addLog(leadId: string) {
    if (!logNote.trim()) return
    setSaving(true)
    await fetch('/api/demo/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, logEntry: logNote.trim() }),
    })
    setLogNote('')
    await loadLeads()
    setSaving(false)
  }

  if (!session) return null

  const filtered = filter === 'all' ? leads : leads.filter(l => l.status === filter)
  const statusCounts = {
    all: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    follow_up: leads.filter(l => l.status === 'follow_up').length,
    converted: leads.filter(l => l.status === 'converted').length,
    closed: leads.filter(l => l.status === 'closed').length,
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role as 'developer'} fullName={session.fullName} />

      <div className="max-w-2xl mx-auto px-4 pt-5">
        <h1 className="text-xl font-bold text-white mb-4">Demo Leads</h1>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2 mb-5">
          {(['all', 'new', 'contacted', 'follow_up', 'converted', 'closed'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filter === s ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}>
              {s === 'all' ? 'All' : STATUS_COLORS[s]?.label ?? s} ({statusCounts[s]})
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm text-center py-12">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-12">No leads found.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(lead => {
              const sc = STATUS_COLORS[lead.status] ?? STATUS_COLORS.new
              const isExpanded = expandedId === lead.id
              const dateStr = new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

              return (
                <div key={lead.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <button onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                    className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-800/50 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white truncate">{lead.first_name} {lead.last_name}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{lead.email}</p>
                      <p className="text-[10px] text-gray-600">{dateStr}</p>
                    </div>
                    <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-800">
                      {/* Details */}
                      <div className="grid grid-cols-2 gap-2 pt-3 text-xs">
                        {lead.company && <div><span className="text-gray-500">Company:</span> <span className="text-gray-300">{lead.company}</span></div>}
                        {lead.industry && <div><span className="text-gray-500">Industry:</span> <span className="text-gray-300">{lead.industry}</span></div>}
                        {lead.team_size && <div><span className="text-gray-500">Team Size:</span> <span className="text-gray-300">{lead.team_size}</span></div>}
                        {lead.phone && <div><span className="text-gray-500">Phone:</span> <span className="text-gray-300">{lead.phone}</span></div>}
                      </div>
                      {lead.notes && <p className="text-xs text-gray-400 italic">{lead.notes}</p>}

                      {/* Status buttons */}
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(STATUS_COLORS).map(([key, val]) => (
                          <button key={key} onClick={() => updateStatus(lead.id, key)} disabled={saving || lead.status === key}
                            className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                              lead.status === key ? `${val.bg} ${val.text}` : 'bg-gray-800 text-gray-500 hover:text-white'
                            }`}>
                            {val.label}
                          </button>
                        ))}
                      </div>

                      {/* Contact log */}
                      {lead.contact_log.length > 0 && (
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mb-1">Contact Log</p>
                          <div className="space-y-1">
                            {lead.contact_log.map((entry, i) => (
                              <div key={i} className="flex gap-2 text-xs">
                                <span className="text-gray-600 shrink-0">{new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                <span className="text-gray-400">{entry.note}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add log entry */}
                      <div className="flex gap-2">
                        <input type="text" value={logNote} onChange={e => setLogNote(e.target.value)}
                          placeholder="Add a contact note..."
                          onKeyDown={e => { if (e.key === 'Enter') addLog(lead.id) }}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
                        <button onClick={() => addLog(lead.id)} disabled={saving || !logNote.trim()}
                          className="bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
