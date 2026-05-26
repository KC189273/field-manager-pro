'use client'

import { useState, useEffect, use } from 'react'

interface DocInfo {
  refNumber: string
  level: string
  title: string
  subjectName: string
  authorName: string
  incidentDate: string
  ackStatus: string
  ackAt: string | null
  status: string
}

function levelLabel(level: string): string {
  if (level === 'verbal') return 'Verbal Notice'
  if (level === 'written') return 'Written Notice — 2nd Level'
  return 'Final Written Notice — 3rd Level'
}

function levelColor(level: string): string {
  if (level === 'verbal') return 'bg-amber-700'
  if (level === 'written') return 'bg-orange-700'
  return 'bg-red-800'
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function AckPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [doc, setDoc] = useState<DocInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [alreadyDone, setAlreadyDone] = useState(false)

  useEffect(() => {
    fetch(`/api/ack/${token}`)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null }
        return r.json()
      })
      .then(d => {
        if (!d) return
        setDoc(d)
        if (d.ackStatus === 'acknowledged') setAlreadyDone(true)
      })
      .finally(() => setLoading(false))
  }, [token])

  async function handleAcknowledge() {
    setSubmitting(true)
    const res = await fetch(`/api/ack/${token}`, { method: 'POST' })
    if (res.ok) {
      const d = await res.json()
      if (d.alreadyAcknowledged) setAlreadyDone(true)
      else setAcknowledged(true)
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-500 text-sm">Loading document…</p>
      </div>
    )
  }

  if (notFound || !doc) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-2">Invalid Link</h1>
          <p className="text-slate-500 text-sm">This acknowledgment link is invalid or has already been used. Please contact your manager if you believe this is an error.</p>
        </div>
      </div>
    )
  }

  if (acknowledged || alreadyDone) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-2">Acknowledgment Recorded</h1>
          <p className="text-slate-500 text-sm mb-4">
            {alreadyDone && !acknowledged
              ? 'This document has already been acknowledged. No further action is required.'
              : `Your acknowledgment of receipt for document ${doc.refNumber} has been recorded and timestamped. Your manager has been notified.`}
          </p>
          <p className="text-xs text-slate-400">Reference: {doc.refNumber}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10 px-4">
      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="bg-slate-900 rounded-t-xl px-6 py-5 text-center">
          <p className="text-slate-400 text-xs tracking-widest uppercase mb-1.5">Field Manager Pro</p>
          <h1 className="text-white font-bold text-base tracking-wide uppercase">Official Accountability Notice</h1>
        </div>

        {/* Ref + Level */}
        <div className="bg-slate-50 border-x border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Reference Number</p>
            <p className="text-xl font-bold text-slate-900 tracking-wide">{doc.refNumber}</p>
          </div>
          <span className={`${levelColor(doc.level)} text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded`}>
            {doc.level === 'verbal' ? 'VERBAL' : doc.level === 'written' ? 'WRITTEN — 2ND' : 'FINAL — 3RD'}
          </span>
        </div>

        {/* Details */}
        <div className="bg-white border border-slate-200 px-6 py-5 space-y-0">
          {[
            ['Notice Level', levelLabel(doc.level)],
            ['Issued To', doc.subjectName],
            ['Issued By', doc.authorName],
            ['Date of Incident', formatDate(doc.incidentDate)],
          ].map(([label, value], i, arr) => (
            <div key={label} className={`py-3 flex justify-between items-start gap-4 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
              <span className="text-xs text-slate-400 uppercase tracking-wide shrink-0">{label}</span>
              <span className="text-sm text-slate-800 font-medium text-right">{value}</span>
            </div>
          ))}
          <div className="pt-3">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Document Title</p>
            <p className="text-sm font-semibold text-slate-900">{doc.title}</p>
          </div>
        </div>

        {/* Acknowledgment section */}
        <div className="bg-blue-50 border border-blue-200 border-t-0 rounded-b-xl px-6 py-6">
          <h2 className="text-sm font-bold text-blue-900 mb-3">Acknowledgment of Receipt Required</h2>
          <p className="text-xs text-blue-800 leading-relaxed mb-4">
            By clicking <strong>"Acknowledge Receipt"</strong> below, you confirm that you have received and read this official accountability document.
          </p>
          <div className="bg-white border border-blue-200 rounded-lg px-4 py-3 mb-4">
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>Important:</strong> This acknowledgment is <strong>not an admission of guilt</strong> or agreement with the contents of this document. It is solely a confirmation that you have received it.
            </p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5">
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Note:</strong> Failure to acknowledge receipt of this document may result in administrative action, including restriction from returning to scheduled work duties until acknowledgment is completed.
            </p>
          </div>

          <button
            onClick={handleAcknowledge}
            disabled={submitting}
            className="w-full bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 text-white font-bold py-4 rounded-xl text-sm tracking-wide uppercase transition-colors"
          >
            {submitting ? 'Recording…' : 'Acknowledge Receipt'}
          </button>

          <p className="text-xs text-slate-400 text-center mt-3">
            Your acknowledgment will be timestamped and your manager will be notified immediately.
          </p>
        </div>

        <p className="text-xs text-slate-400 text-center mt-5">
          Field Manager Pro — Official HR Documentation System<br />
          Ref: {doc.refNumber} — This link is for {doc.subjectName} only.
        </p>
      </div>
    </div>
  )
}
