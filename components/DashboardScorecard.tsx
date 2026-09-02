'use client'

import { useState, useEffect } from 'react'

interface ScorecardData {
  dm: { id: string; full_name: string }
  allDms: Array<{ id: string; full_name: string }>
  coachingGrade: { avg_grade: string | null; count: number; weakest_category: string | null }
  coachingCompliance: { rate: number; with_coaching: number; total_visits: number }
  uniformCompliance: { rate: number; passed: number; total: number; failed: number }
  integrity: { intervention_rate: number; manual: number; edited: number; total: number }
  overall: { score: number | null; grade: string }
}

export default function DashboardScorecard() {
  const [data, setData] = useState<ScorecardData | null>(null)
  const [dmId, setDmId] = useState('')
  const [loading, setLoading] = useState(true)

  function load(id?: string) {
    setLoading(true)
    fetch(`/api/reports/dm-scorecard${id ? `?dmId=${id}` : ''}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setData(d); if (!dmId && d.allDms?.length) setDmId(d.dm.id) }
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading && !data) return <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4"><p className="text-sm text-gray-500">Loading scorecard...</p></div>
  if (!data) return null

  const g = data.overall.grade
  const gradeColor = g === 'A' ? 'text-green-400' : g === 'B' ? 'text-blue-400' : g === 'C' ? 'text-amber-400' : g === 'D' ? 'text-orange-400' : g === 'F' ? 'text-red-400' : 'text-gray-500'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-800/60">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">DM Scorecard</p>
        <a href="/dm-engagement" className="text-xs text-violet-500">Full View →</a>
      </div>

      {data.allDms.length > 1 && (
        <div className="px-4 pt-2">
          <select value={dmId} onChange={e => { setDmId(e.target.value); load(e.target.value) }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500">
            {data.allDms.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex items-center gap-4 mb-3">
          <p className={`text-4xl font-black ${gradeColor}`}>{data.overall.grade}</p>
          <div>
            <p className="text-sm font-bold text-white">{data.dm.full_name}</p>
            <p className="text-xs text-gray-500">Overall{data.overall.score !== null ? ` — ${data.overall.score}%` : ''}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <a href="/dm-engagement" className="bg-gray-800 rounded-xl px-3 py-2 hover:bg-gray-700 transition-colors">
            <p className="text-[10px] text-gray-500">Coaching</p>
            <p className={`text-lg font-bold ${data.coachingGrade.avg_grade?.startsWith('A') ? 'text-green-400' : data.coachingGrade.avg_grade?.startsWith('B') ? 'text-blue-400' : data.coachingGrade.avg_grade?.startsWith('C') ? 'text-amber-400' : 'text-red-400'}`}>{data.coachingGrade.avg_grade || '-'}</p>
            <p className="text-[10px] text-gray-600">{data.coachingGrade.count} sessions</p>
          </a>
          <a href="/dm-engagement" className="bg-gray-800 rounded-xl px-3 py-2 hover:bg-gray-700 transition-colors">
            <p className="text-[10px] text-gray-500">Coaching Compliance</p>
            <p className={`text-lg font-bold ${data.coachingCompliance.rate >= 90 ? 'text-green-400' : data.coachingCompliance.rate >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{data.coachingCompliance.rate}%</p>
            <p className="text-[10px] text-gray-600">{data.coachingCompliance.with_coaching}/{data.coachingCompliance.total_visits}</p>
          </a>
          <a href="/dm-engagement" className="bg-gray-800 rounded-xl px-3 py-2 hover:bg-gray-700 transition-colors">
            <p className="text-[10px] text-gray-500">Uniform</p>
            <p className={`text-lg font-bold ${data.uniformCompliance.rate >= 80 ? 'text-green-400' : data.uniformCompliance.rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{data.uniformCompliance.rate}%</p>
            <p className="text-[10px] text-gray-600">{data.uniformCompliance.passed}/{data.uniformCompliance.total}</p>
          </a>
          <a href="/dm-engagement" className="bg-gray-800 rounded-xl px-3 py-2 hover:bg-gray-700 transition-colors">
            <p className="text-[10px] text-gray-500">Integrity</p>
            <p className={`text-lg font-bold ${data.integrity.intervention_rate >= 30 ? 'text-red-400' : data.integrity.intervention_rate >= 20 ? 'text-amber-400' : 'text-green-400'}`}>{Math.max(0, 100 - data.integrity.intervention_rate)}%</p>
            <p className="text-[10px] text-gray-600">{data.integrity.manual}m {data.integrity.edited}e</p>
          </a>
        </div>
      </div>
    </div>
  )
}
