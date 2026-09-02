'use client'

import { useState, useEffect } from 'react'

interface ScorecardData {
  dm: { id: string; full_name: string }
  allDms: Array<{ id: string; full_name: string }>
  coachingGrade: { avg_grade: string | null; count: number }
  coachingCompliance: { rate: number }
  uniformCompliance: { rate: number }
  integrity: { intervention_rate: number }
  overall: { score: number | null; grade: string }
}

export default function DashboardScorecard() {
  const [data, setData] = useState<ScorecardData | null>(null)
  const [dmId, setDmId] = useState('')

  function load(id?: string) {
    fetch(`/api/reports/dm-scorecard${id ? `?dmId=${id}` : ''}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setData(d); if (!dmId && d.allDms?.length) setDmId(d.dm.id) }
    }).catch(() => {})
  }

  useEffect(() => { load() }, [])

  if (!data) return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Scorecard</p>
      <p className="text-xs text-gray-600 mt-2">Loading...</p>
    </div>
  )

  const g = data.overall.grade
  const gradeColor = g === 'A' ? 'text-green-400' : g === 'B' ? 'text-blue-400' : g === 'C' ? 'text-amber-400' : g === 'D' ? 'text-orange-400' : g === 'F' ? 'text-red-400' : 'text-gray-500'

  return (
    <a href="/dm-engagement" className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-3 transition-colors block">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] text-gray-500 uppercase tracking-wide">Scorecard</p>
        <p className="text-xs text-violet-500">View →</p>
      </div>

      {data.allDms.length > 1 && (
        <select value={dmId} onChange={e => { e.preventDefault(); e.stopPropagation(); setDmId(e.target.value); load(e.target.value) }}
          onClick={e => e.preventDefault()}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white mb-2 focus:outline-none">
          {data.allDms.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
      )}

      <div className="flex items-center gap-2 mb-2">
        <span className={`text-2xl font-black ${gradeColor}`}>{data.overall.grade}</span>
        <span className="text-xs text-gray-500 truncate">{data.dm.full_name}</span>
      </div>

      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <div className="flex justify-between"><span className="text-gray-500">Coach</span><span className={data.coachingGrade.avg_grade?.startsWith('A') ? 'text-green-400' : data.coachingGrade.avg_grade?.startsWith('B') ? 'text-blue-400' : 'text-amber-400'}>{data.coachingGrade.avg_grade || '-'}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Comply</span><span className={data.coachingCompliance.rate >= 90 ? 'text-green-400' : 'text-amber-400'}>{data.coachingCompliance.rate}%</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Uniform</span><span className={data.uniformCompliance.rate >= 80 ? 'text-green-400' : 'text-amber-400'}>{data.uniformCompliance.rate}%</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Integrity</span><span className={data.integrity.intervention_rate < 20 ? 'text-green-400' : 'text-amber-400'}>{Math.max(0, 100 - data.integrity.intervention_rate)}%</span></div>
      </div>
    </a>
  )
}
