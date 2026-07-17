'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

interface HealthData {
  live: {
    connections: { active: number; max: number; running: number; idle: number }
    dbSize: { bytes: string; pretty: string }
    cacheHitRatio: number
    tables: Array<{ table_name: string; total_size: string; size_bytes: string; row_count: number; dead_rows: number; seq_scans: number; idx_scans: number }>
    indexes: Array<{ table_name: string; index_name: string; size: string; scans: number }>
    activeQueries: Array<{ query: string; count: number }>
    userStats: { total: number; active: number; managers: number; employees: number }
    issues: string[]
    actionItems: Array<{ severity: 'critical' | 'warning' | 'info'; title: string; detail: string; action: string }>
  }
  history: Array<{
    snapshot_at: string; active_connections: number; db_size_bytes: string
    gps_rows: number; notifications_rows: number; cache_hit_ratio: number
    issues_count: number; cleanup_gps: number; cleanup_notifications: number
  }>
}

function MiniChart({ data, color, label, formatter }: { data: number[]; color: string; label: string; formatter?: (v: number) => string }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 100
  const h = 40
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ')
  const current = data[data.length - 1]
  const prev = data[data.length - 2]
  const change = prev > 0 ? ((current - prev) / prev * 100).toFixed(0) : '0'
  const changeColor = Number(change) > 10 ? 'text-red-400' : Number(change) < -10 ? 'text-green-400' : 'text-gray-500'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">{label}</p>
        <p className={`text-xs font-semibold ${changeColor}`}>{Number(change) > 0 ? '+' : ''}{change}%</p>
      </div>
      <p className="text-2xl font-bold text-white mb-2">{formatter ? formatter(current) : current.toLocaleString()}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 40 }}>
        <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
      </svg>
    </div>
  )
}

function GaugeRing({ value, max, label, color, unit }: { value: number; max: number; label: string; color: string; unit?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  const circumference = 2 * Math.PI * 36
  const offset = circumference - (pct / 100) * circumference
  const statusColor = pct > 80 ? '#dc2626' : pct > 60 ? '#d97706' : color

  return (
    <div className="flex flex-col items-center">
      <svg width="90" height="90" className="mb-1">
        <circle cx="45" cy="45" r="36" fill="none" stroke="#1f2937" strokeWidth="6" />
        <circle cx="45" cy="45" r="36" fill="none" stroke={statusColor} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 45 45)" className="transition-all duration-700" />
        <text x="45" y="42" textAnchor="middle" className="fill-white text-lg font-bold" style={{ fontSize: 16 }}>
          {value}
        </text>
        <text x="45" y="56" textAnchor="middle" className="fill-gray-500" style={{ fontSize: 9 }}>
          / {max}{unit}
        </text>
      </svg>
      <p className="text-xs text-gray-400 text-center">{label}</p>
    </div>
  )
}

function BarChart({ items, maxVal }: { items: Array<{ label: string; value: number; color: string; subLabel?: string }>; maxVal?: number }) {
  const max = maxVal ?? Math.max(...items.map(i => i.value), 1)
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-gray-300 truncate flex-1">{item.label}</span>
            <span className="text-xs text-gray-500 ml-2 shrink-0">{item.subLabel ?? item.value.toLocaleString()}</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DbHealthPage() {
  const router = useRouter()
  const [session, setSession] = useState<{ role: string; fullName: string } | null>(null)
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(new Set())

  // Load dismissed items from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ops-dismissed')
      if (saved) setDismissedItems(new Set(JSON.parse(saved)))
    } catch { /* ignore */ }
  }, [])

  function dismissItem(key: string) {
    setDismissedItems(prev => {
      const next = new Set(prev)
      next.add(key)
      try { localStorage.setItem('ops-dismissed', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  function clearDismissed() {
    setDismissedItems(new Set())
    try { localStorage.removeItem('ops-dismissed') } catch { /* ignore */ }
  }

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d) return
      if (!['developer', 'owner', 'ops_manager', 'sales_director'].includes(d.role)) { router.replace('/dashboard'); return }
      setSession(d)
    })
  }, [router])

  useEffect(() => {
    if (!session) return
    setLoading(true)
    fetch('/api/db-health')
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(new Date()) })
      .finally(() => setLoading(false))
  }, [session])

  function refresh() {
    setLoading(true)
    fetch('/api/db-health')
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(new Date()) })
      .finally(() => setLoading(false))
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const live = data?.live
  const history = data?.history ?? []

  const fmtBytes = (b: number) => {
    if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
    if (b > 1e6) return (b / 1e6).toFixed(0) + ' MB'
    return (b / 1e3).toFixed(0) + ' KB'
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role as 'developer'} fullName={session.fullName} />

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">App Health</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {lastRefresh ? `Last refreshed ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
            </p>
          </div>
          <button onClick={refresh} disabled={loading}
            className="text-xs font-semibold text-violet-400 hover:text-violet-300 bg-gray-800 border border-gray-700 px-4 py-2 rounded-xl disabled:opacity-50">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {loading && !data ? (
          <div className="space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 animate-pulse">
                <div className="h-4 bg-gray-800 rounded w-32 mb-3" />
                <div className="h-8 bg-gray-800 rounded w-20" />
              </div>
            ))}
          </div>
        ) : live ? (
          <>
            {/* Status Banner */}
            <div className={`rounded-2xl p-4 border ${
              live.issues.length === 0 ? 'bg-green-900/20 border-green-700/30' :
              live.issues.length <= 2 ? 'bg-amber-900/20 border-amber-700/30' :
              'bg-red-900/20 border-red-700/30'
            }`}>
              <div className="flex items-center gap-3">
                <span className={`text-2xl`}>{live.issues.length === 0 ? '✅' : live.issues.length <= 2 ? '⚠️' : '🔴'}</span>
                <div>
                  <p className="text-sm font-bold text-white">
                    {live.issues.length === 0 ? 'All Systems Healthy' : `${live.issues.length} Issue${live.issues.length !== 1 ? 's' : ''} Detected`}
                  </p>
                  {live.issues.length > 0 && (
                    <ul className="mt-1">
                      {live.issues.map((issue, i) => (
                        <li key={i} className="text-xs text-red-400">{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Action Items & Suggestions */}
            {live.actionItems && live.actionItems.length > 0 && (() => {
              const visibleItems = live.actionItems.filter(a => !dismissedItems.has(a.title))
              const dismissedCount = live.actionItems.length - visibleItems.length
              return (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                    <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Action Items & Suggestions</p>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">
                        {visibleItems.filter(a => a.severity === 'critical').length > 0 && (
                          <span className="text-red-400 font-semibold mr-2">{visibleItems.filter(a => a.severity === 'critical').length} critical</span>
                        )}
                        {visibleItems.filter(a => a.severity === 'warning').length > 0 && (
                          <span className="text-amber-400 font-semibold mr-2">{visibleItems.filter(a => a.severity === 'warning').length} warning</span>
                        )}
                        {visibleItems.filter(a => a.severity === 'info').length} info
                      </span>
                      {dismissedCount > 0 && (
                        <button onClick={clearDismissed} className="text-[10px] text-gray-600 hover:text-gray-400 underline">
                          Show {dismissedCount} resolved
                        </button>
                      )}
                    </div>
                  </div>
                  {visibleItems.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-sm text-gray-500">All items resolved</p>
                      <button onClick={clearDismissed} className="text-xs text-violet-400 hover:text-violet-300 mt-2">
                        Show resolved items
                      </button>
                    </div>
                  ) : visibleItems.map((item, i) => (
                    <div key={i} className={`px-4 py-3 border-b border-gray-800/50 last:border-0 ${
                      item.severity === 'critical' ? 'bg-red-900/10 border-l-4 border-l-red-500' :
                      item.severity === 'warning' ? 'bg-amber-900/10 border-l-4 border-l-amber-500' :
                      'border-l-4 border-l-gray-700'
                    }`}>
                      <div className="flex items-start gap-2">
                        <span className="text-sm mt-0.5">
                          {item.severity === 'critical' ? '🔴' : item.severity === 'warning' ? '🟡' : '🟢'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white">{item.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{item.detail}</p>
                          <p className="text-xs text-violet-400 mt-1 font-medium">{item.action}</p>
                        </div>
                        <button onClick={() => dismissItem(item.title)} title="Mark as resolved"
                          className="shrink-0 mt-0.5 p-1 rounded-lg text-gray-600 hover:text-green-400 hover:bg-green-900/20 transition-colors">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Gauges Row */}
            <div className="grid grid-cols-3 gap-4">
              <GaugeRing value={live.connections.active} max={live.connections.max} label="Connections" color="#7c3aed" />
              <GaugeRing value={live.cacheHitRatio} max={100} label="Cache Hit %" color="#16a34a" unit="%" />
              <GaugeRing value={live.activeQueries.reduce((s, q) => s + q.count, 0)} max={20} label="Active Queries" color="#0891b2" />
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center">
                <p className="text-2xl font-bold text-white">{live.dbSize.pretty}</p>
                <p className="text-xs text-gray-500 mt-1">Database Size</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center">
                <p className="text-2xl font-bold text-white">{live.userStats.active}</p>
                <p className="text-xs text-gray-500 mt-1">Active Users ({live.userStats.managers} DMs, {live.userStats.employees} Employees)</p>
              </div>
            </div>

            {/* Trend Charts */}
            {history.length >= 2 && (
              <div className="grid grid-cols-2 gap-3">
                <MiniChart data={history.map(h => h.gps_rows)} color="#7c3aed" label="GPS Breadcrumbs"
                  formatter={v => v.toLocaleString()} />
                <MiniChart data={history.map(h => Number(h.db_size_bytes))} color="#0891b2" label="DB Size"
                  formatter={fmtBytes} />
                <MiniChart data={history.map(h => h.active_connections)} color="#d97706" label="Connections"
                  formatter={v => String(v)} />
                <MiniChart data={history.map(h => h.issues_count)} color="#dc2626" label="Issues"
                  formatter={v => String(v)} />
              </div>
            )}

            {/* Table Sizes */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-3">Table Sizes</p>
              <BarChart items={live.tables.slice(0, 8).map(t => ({
                label: t.table_name,
                value: Number(t.size_bytes),
                color: t.table_name === 'gps_breadcrumbs' ? '#7c3aed' : t.dead_rows > 1000 ? '#dc2626' : '#374151',
                subLabel: `${t.total_size} · ${t.row_count.toLocaleString()} rows`,
              }))} />
            </div>

            {/* Seq Scans vs Index Scans */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-3">Query Efficiency (Seq Scans vs Index Scans)</p>
              {live.tables.filter(t => t.row_count > 1000).slice(0, 8).map(t => {
                const total = t.seq_scans + t.idx_scans
                const idxPct = total > 0 ? Math.round((t.idx_scans / total) * 100) : 100
                return (
                  <div key={t.table_name} className="mb-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-gray-300">{t.table_name}</span>
                      <span className={`text-xs font-semibold ${idxPct >= 80 ? 'text-green-400' : idxPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {idxPct}% indexed
                      </span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden flex">
                      <div className="h-full bg-green-500 transition-all" style={{ width: `${idxPct}%` }} />
                      <div className="h-full bg-red-500 transition-all" style={{ width: `${100 - idxPct}%` }} />
                    </div>
                  </div>
                )
              })}
              <p className="text-[10px] text-gray-600 mt-2">Green = index scans (fast). Red = sequential scans (slow on large tables).</p>
            </div>

            {/* Active Queries */}
            {live.activeQueries.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-3">Active Queries Right Now</p>
                {live.activeQueries.map((q, i) => (
                  <div key={i} className="flex items-start gap-2 mb-2 last:mb-0">
                    <span className="text-xs font-bold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded shrink-0">{q.count}x</span>
                    <code className="text-xs text-gray-400 break-all">{q.query}</code>
                  </div>
                ))}
              </div>
            )}

            {/* Index Usage */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-3">Indexes by Size</p>
              <BarChart items={live.indexes.slice(0, 8).map(idx => ({
                label: `${idx.table_name}.${idx.index_name.replace(idx.table_name + '_', '')}`,
                value: idx.scans,
                color: idx.scans > 100 ? '#16a34a' : idx.scans > 0 ? '#d97706' : '#dc2626',
                subLabel: `${idx.size} · ${idx.scans.toLocaleString()} scans`,
              }))} />
              <p className="text-[10px] text-gray-600 mt-2">Green = heavily used. Red = never used (may be unnecessary).</p>
            </div>

          </>
        ) : null}
      </div>
    </div>
  )
}
