'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'sales_director' | 'ops_manager' | 'owner' | 'developer'

interface Session {
  id: string
  fullName: string
  role: Role
  org_id?: string | null
}

interface Doc {
  id: string
  ref_number: string
  level: string
  title: string
  subject_id: string
  subject_name: string
  subject_role: string
  author_id: string
  author_name: string
  author_role: string
  incident_date: string
  status: string
  ack_status: string
  ack_at: string | null
  sd_name: string | null
  approver_name: string | null
  approved_at: string | null
  rejected_at: string | null
  rejected_by_name: string | null
  rejection_notes: string | null
  created_at: string
  conversation_status: string | null
  revision_notes: string | null
  revision_requested_by_name: string | null
}

interface DetailDoc extends Doc {
  subject_email: string
  author_email: string
  notes: string
  expectations: string
  sd_id: string | null
  sd_email: string | null
  parent_rejected_doc_id: string | null
  conversation_approved_at: string | null
  revision_requested_at: string | null
  priorConvos: Array<{ id: string; convo_date: string; notes: string }>
  linkedVerbals: Array<{ ref_number: string; level: string; title: string; incident_date: string; status: string }>
  auditLog: Array<{ action: string; actor_name: string | null; notes: string | null; created_at: string }>
}

interface TerminationRequest {
  id: string
  employee_name: string
  employee_email: string
  requested_by_name: string
  requested_by_role: string
  reasons: string
  status: string
  approved_by_name: string | null
  created_at: string
  approved_at: string | null
}

interface Subject { id: string; full_name: string; role: string }
interface Author  { id: string; full_name: string; role: string }

interface PriorConvo { convo_date: string; notes: string }

const LEVEL_COLORS: Record<string, string> = {
  verbal:  'bg-amber-700/20 text-amber-400 border-amber-700/30',
  written: 'bg-orange-700/20 text-orange-400 border-orange-700/30',
  final:   'bg-red-800/20 text-red-400 border-red-800/30',
}
const LEVEL_LABELS: Record<string, string> = {
  verbal:  'Verbal',
  written: 'Written — 2nd',
  final:   'Final — 3rd',
}
const STATUS_COLORS: Record<string, string> = {
  pending_approval: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  approved:         'bg-green-500/15 text-green-400 border-green-500/30',
  rejected:         'bg-red-500/15 text-red-400 border-red-500/30',
  needs_revision:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
}
const STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Pending Approval',
  approved:         'Approved',
  rejected:         'Rejected',
  needs_revision:   'Needs Revision',
}
const ACK_COLORS: Record<string, string> = {
  pending:      'text-amber-400',
  acknowledged: 'text-green-400',
  refused:      'text-red-400',
}
const ACK_LABELS: Record<string, string> = {
  pending:      'Awaiting Ack',
  acknowledged: 'Acknowledged',
  refused:      'Refused',
}

function canViewDash(role: Role) {
  return ['manager','sales_director','ops_manager','owner','developer'].includes(role)
}
function canApprove(role: Role) {
  return ['sales_director','owner','developer'].includes(role)
}
function canSubmit(role: Role) {
  return ['manager','sales_director','owner','developer'].includes(role)
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    submitted: 'Document submitted',
    pending_approval_notified: 'Approvers notified',
    emails_sent: 'Emails sent to subject & author',
    approved: 'Document approved',
    rejected: 'Document rejected',
    auto_created_verbal: 'Auto-created Verbal from rejection',
    acknowledged: 'Subject acknowledged receipt',
    refused: 'Subject refused acknowledgment',
    ack_reminder_sent: 'Ack reminder sent (24hr)',
    ack_subject_reminder_sent: 'Auto-reminder sent to subject (21hr)',
    manual_reminder_sent: 'Manual reminder sent to subject',
    '72hr_escalation_sent': '72hr escalation sent to Owner',
    conversation_complete: 'Voice conversation marked complete — notice sent',
    force_send: 'Voice conversation bypassed — notice force-sent by SD',
    convo_reminder_sent: '12-hour voice conversation reminder sent to DM',
    convo_escalated: '24-hour deadline missed — escalated to SD',
    sent_back_for_revision: 'Document sent back for revision',
    resubmitted: 'Document revised and resubmitted for approval',
  }
  return map[action] ?? action
}

// ─── DocCard ──────────────────────────────────────────────────────────────────
function DocCard({ doc, onClick }: { doc: Doc; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${LEVEL_COLORS[doc.level] ?? ''}`}>
            {LEVEL_LABELS[doc.level] ?? doc.level}
          </span>
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_COLORS[doc.status] ?? ''}`}>
            {STATUS_LABELS[doc.status] ?? doc.status}
          </span>
        </div>
        <span className="text-xs text-gray-500 shrink-0 text-right"><span className="block text-[10px] uppercase tracking-wide text-gray-600">Date Submitted</span>{new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}</span>
      </div>
      <p className="text-sm font-semibold text-white mb-1 leading-snug">{doc.title}</p>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-gray-400">Subject: <span className="text-gray-300">{doc.subject_name}</span></p>
          {doc.author_id !== doc.subject_id && (
            <p className="text-xs text-gray-500">By: {doc.author_name}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {doc.status === 'approved' && (doc.conversation_status === 'pending' || doc.conversation_status === 'escalated') && (
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${
              doc.conversation_status === 'escalated'
                ? 'bg-red-900/30 border-red-700/50 text-red-400'
                : 'bg-amber-900/30 border-amber-700/50 text-amber-400'
            }`}>
              {doc.conversation_status === 'escalated' ? 'Convo Overdue' : 'Voice Convo Required'}
            </span>
          )}
          {doc.status === 'approved' && !doc.conversation_status && (
            <span className={`text-[10px] font-semibold ${ACK_COLORS[doc.ack_status]}`}>
              {ACK_LABELS[doc.ack_status]}
            </span>
          )}
          {doc.status === 'approved' && (doc.conversation_status === 'complete' || doc.conversation_status === 'bypassed') && (
            <span className={`text-[10px] font-semibold ${ACK_COLORS[doc.ack_status]}`}>
              {ACK_LABELS[doc.ack_status]}
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-gray-600 mt-1.5">{doc.ref_number}</p>
    </button>
  )
}

// ─── Detail Modal ────────────────────────────────────────────────────────────
function DetailModal({
  docId, session, onClose, onApproved, onRejected, onDelete,
}: {
  docId: string
  session: Session
  onClose: () => void
  onApproved: () => void
  onRejected: () => void
  onDelete: () => void
}) {
  const [doc, setDoc] = useState<DetailDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [rejecting, setRejecting] = useState(false)
  const [rejectionNotes, setRejectionNotes] = useState('')
  const [rejectionType, setRejectionType] = useState<'downgrade' | 'revision'>('downgrade')
  const [approving, setApproving] = useState(false)
  const [revisioning, setRevisioning] = useState(false)
  const [revisionTitle, setRevisionTitle] = useState('')
  const [revisionNotes, setRevisionNotes] = useState('')
  const [revisionExpectations, setRevisionExpectations] = useState('')
  const [resubmitting, setResubmitting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [reminderSent, setReminderSent] = useState(false)
  const [completingConvo, setCompletingConvo] = useState(false)
  const [forceSending, setForceSending] = useState(false)
  const [terminationOpen, setTerminationOpen] = useState(false)
  const [terminationReasons, setTerminationReasons] = useState('')
  const [terminating, setTerminating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/accountability/${docId}`)
      .then(r => r.json())
      .then(d => { setDoc(d); setLoading(false) })
  }, [docId])

  async function handleApprove() {
    const isWrittenOrFinal = doc?.level === 'written' || doc?.level === 'final'
    const confirmMsg = isWrittenOrFinal
      ? `Approve ${doc?.ref_number}? The DM will have 24 hours to complete a voice conversation with ${doc?.subject_name} before the formal notice is sent.`
      : `Approve ${doc?.ref_number}? This will send the formal notice to ${doc?.subject_name} immediately.`
    if (!confirm(confirmMsg)) return
    setSubmitting(true)
    setError('')
    const res = await fetch(`/api/accountability/${docId}/approve`, { method: 'POST' })
    if (res.ok) { onApproved() }
    else { const d = await res.json(); setError(d.error ?? 'Approval failed'); setSubmitting(false) }
  }

  async function handleConversationComplete() {
    if (!confirm(`Mark voice conversation with ${doc?.subject_name} as complete? This will send the formal notice to ${doc?.subject_name} immediately.`)) return
    setCompletingConvo(true)
    setError('')
    const res = await fetch(`/api/accountability/${docId}/conversation-complete`, { method: 'POST' })
    if (res.ok) {
      fetch(`/api/accountability/${docId}`).then(r => r.json()).then(d => { setDoc(d); setCompletingConvo(false) })
    } else {
      const d = await res.json(); setError(d.error ?? 'Failed to mark complete'); setCompletingConvo(false)
    }
  }

  async function handleForceSend() {
    if (!confirm(`Force-send the formal notice to ${doc?.subject_name} without waiting for the DM to complete the voice conversation?`)) return
    setForceSending(true)
    setError('')
    const res = await fetch(`/api/accountability/${docId}/force-send`, { method: 'POST' })
    if (res.ok) {
      fetch(`/api/accountability/${docId}`).then(r => r.json()).then(d => { setDoc(d); setForceSending(false) })
    } else {
      const d = await res.json(); setError(d.error ?? 'Force send failed'); setForceSending(false)
    }
  }

  async function handleTerminate() {
    if (!terminationReasons.trim()) { setError('Please enter the reasons for termination.'); return }
    if (!confirm(`Submit termination request for ${doc?.subject_name}? This will require Sales Director approval before the notice is sent.`)) return
    setTerminating(true)
    setError('')
    const res = await fetch('/api/accountability/termination', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: doc?.subject_id, reasons: terminationReasons.trim() }),
    })
    if (res.ok) {
      setTerminationOpen(false)
      setTerminationReasons('')
      setTerminating(false)
      fetch(`/api/accountability/${docId}`).then(r => r.json()).then(d => setDoc(d))
    } else {
      const d = await res.json(); setError(d.error ?? 'Termination request failed'); setTerminating(false)
    }
  }

  async function handleReject() {
    if (!rejectionNotes.trim()) { setError('Please enter rejection notes before submitting.'); return }
    setSubmitting(true)
    setError('')
    const res = await fetch(`/api/accountability/${docId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionNotes: rejectionNotes.trim(), rejectionType }),
    })
    if (res.ok) { onRejected() }
    else { const d = await res.json(); setError(d.error ?? 'Rejection failed'); setSubmitting(false) }
  }

  async function handleResubmit() {
    if (!revisionTitle.trim() || !revisionNotes.trim() || !revisionExpectations.trim()) {
      setError('Please fill in all fields before resubmitting.'); return
    }
    setResubmitting(true)
    setError('')
    const res = await fetch(`/api/accountability/${docId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: revisionTitle.trim(), notes: revisionNotes.trim(), expectations: revisionExpectations.trim() }),
    })
    if (res.ok) {
      setRevisioning(false)
      fetch(`/api/accountability/${docId}`).then(r => r.json()).then(d => { setDoc(d); setResubmitting(false) })
    } else {
      const d = await res.json(); setError(d.error ?? 'Resubmit failed'); setResubmitting(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Permanently delete ${doc?.ref_number}? This cannot be undone.`)) return
    setDeleting(true)
    setError('')
    const res = await fetch(`/api/accountability/${docId}`, { method: 'DELETE' })
    if (res.ok) { onDelete() }
    else { const d = await res.json(); setError(d.error ?? 'Delete failed'); setDeleting(false) }
  }

  async function handleRemind() {
    setSendingReminder(true)
    setError('')
    const res = await fetch(`/api/accountability/${docId}/remind`, { method: 'POST' })
    if (res.ok) {
      setReminderSent(true)
      // Refresh to show the new audit entry
      fetch(`/api/accountability/${docId}`).then(r => r.json()).then(d => setDoc(d))
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to send reminder')
    }
    setSendingReminder(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-2xl border border-gray-800 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Accountability Record</p>
            <h2 className="font-bold text-white">{doc?.ref_number ?? '…'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-5">
          {loading || !doc ? (
            <div className="text-center text-gray-500 py-10 text-sm">Loading…</div>
          ) : (
            <>
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border ${LEVEL_COLORS[doc.level]}`}>
                  {LEVEL_LABELS[doc.level] ?? doc.level}
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border ${STATUS_COLORS[doc.status]}`}>
                  {STATUS_LABELS[doc.status] ?? doc.status}
                </span>
                {doc.status === 'approved' && !doc.conversation_status && (
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border border-gray-700 ${ACK_COLORS[doc.ack_status]}`}>
                    {ACK_LABELS[doc.ack_status]}
                  </span>
                )}
                {doc.status === 'approved' && (doc.conversation_status === 'complete' || doc.conversation_status === 'bypassed') && (
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border border-gray-700 ${ACK_COLORS[doc.ack_status]}`}>
                    {ACK_LABELS[doc.ack_status]}
                  </span>
                )}
                {doc.conversation_status === 'pending' && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border bg-amber-900/30 border-amber-700/50 text-amber-400">
                    Voice Convo Required
                  </span>
                )}
                {doc.conversation_status === 'escalated' && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border bg-red-900/30 border-red-700/50 text-red-400">
                    Convo Overdue — Escalated
                  </span>
                )}
                {doc.conversation_status === 'complete' && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border bg-green-900/20 border-green-700/40 text-green-400">
                    Voice Convo Complete
                  </span>
                )}
                {doc.conversation_status === 'bypassed' && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border bg-gray-700/40 border-gray-600/40 text-gray-400">
                    Convo Bypassed
                  </span>
                )}
              </div>

              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Subject', doc.subject_name + (doc.subject_role === 'manager' ? ' (DM)' : '')],
                  ['Issued By', doc.author_name],
                  ['Date of Incident', fmtDate(doc.incident_date)],
                  ['Filed', fmtDateTime(doc.created_at)],
                  ...(doc.approved_at ? [['Approved', fmtDateTime(doc.approved_at) + (doc.approver_name ? ` by ${doc.approver_name}` : '')]] : []),
                  ...(doc.ack_at ? [['Acknowledged', fmtDateTime(doc.ack_at)]] : []),
                  ...(doc.sd_name ? [['Sales Director', doc.sd_name]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="bg-gray-800 rounded-xl p-3">
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className="text-sm text-white font-medium leading-snug">{value}</p>
                  </div>
                ))}
              </div>

              {/* Title */}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Document Title</p>
                <p className="text-white font-semibold text-base">{doc.title}</p>
              </div>

              {/* Prior convos */}
              {doc.priorConvos.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Prior Conversations on Record</p>
                  <div className="space-y-2">
                    {doc.priorConvos.map((c, i) => (
                      <div key={c.id} className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                        <p className="text-xs font-semibold text-amber-400 mb-1">Conversation {i + 1} — {fmtDate(c.convo_date)}</p>
                        <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{c.notes}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Linked verbals */}
              {doc.linkedVerbals.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Related Prior Records</p>
                  <div className="space-y-2">
                    {doc.linkedVerbals.map(v => (
                      <div key={v.ref_number} className="bg-gray-800 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-gray-300">{v.ref_number} — {v.title}</p>
                          <p className="text-xs text-gray-500">Incident: {fmtDate(v.incident_date)}</p>
                        </div>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${LEVEL_COLORS[v.level]}`}>
                          {LEVEL_LABELS[v.level] ?? v.level}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Summary of Discussion</p>
                <div className="bg-gray-800 border-l-4 border-gray-600 rounded-r-xl px-4 py-3">
                  <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{doc.notes}</p>
                </div>
              </div>

              {/* Expectations */}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Clear Expectations Moving Forward</p>
                <div className="bg-green-500/10 border-l-4 border-green-500 rounded-r-xl px-4 py-3">
                  <p className="text-sm text-green-200 leading-relaxed whitespace-pre-wrap">{doc.expectations}</p>
                </div>
              </div>

              {/* Final warning callout */}
              {doc.level === 'final' && (
                <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">⚠ Final Written Notice</p>
                  <p className="text-xs text-red-300 leading-relaxed">This is the third and final written notice. Failure to correct may result in further action up to and including termination.</p>
                </div>
              )}

              {/* Rejection notes */}
              {doc.status === 'rejected' && doc.rejection_notes && (
                <div className="bg-red-900/20 border border-red-800 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">Rejection Notes — {doc.rejected_by_name}</p>
                  <p className="text-xs text-red-300 leading-relaxed whitespace-pre-wrap">{doc.rejection_notes}</p>
                </div>
              )}

              {/* Approval actions */}
              {canApprove(session.role) && doc.status === 'pending_approval' && !rejecting && (
                <div className="flex gap-3">
                  <button
                    onClick={handleApprove}
                    disabled={submitting}
                    className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
                  >
                    {approving ? 'Approving…' : 'Approve & Send'}
                  </button>
                  <button
                    onClick={() => { setRejecting(true); setError('') }}
                    disabled={submitting}
                    className="flex-1 bg-red-900/40 hover:bg-red-900/60 border border-red-700/50 text-red-400 font-semibold py-3 rounded-xl text-sm transition-colors"
                  >
                    Reject & Downgrade
                  </button>
                </div>
              )}

              {/* Rejection form */}
              {canApprove(session.role) && doc.status === 'pending_approval' && rejecting && (
                <div className="space-y-3">
                  {/* Rejection type toggle */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRejectionType('downgrade')}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-colors text-left ${
                        rejectionType === 'downgrade'
                          ? 'bg-red-900/40 border-red-700 text-red-300'
                          : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
                      }`}
                    >
                      <p className="font-bold mb-0.5">Reject & Downgrade</p>
                      <p className="text-[10px] opacity-70">Converts to Verbal, sends immediately</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectionType('revision')}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-colors text-left ${
                        rejectionType === 'revision'
                          ? 'bg-blue-900/40 border-blue-700 text-blue-300'
                          : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
                      }`}
                    >
                      <p className="font-bold mb-0.5">Send Back for Revision</p>
                      <p className="text-[10px] opacity-70">DM edits and resubmits for approval</p>
                    </button>
                  </div>

                  <p className="text-xs text-gray-400">
                    {rejectionType === 'downgrade'
                      ? `This will reject the ${doc.level} notice and automatically convert it to a Verbal, which will be sent to ${doc.subject_name} immediately.`
                      : `This will send the document back to ${doc.author_name} with your notes. They can edit and resubmit for your approval.`
                    }
                  </p>
                  <textarea
                    rows={4}
                    placeholder={rejectionType === 'downgrade'
                      ? 'Explain why you are rejecting this level and converting it to a verbal…'
                      : 'Explain what needs to be changed or corrected before resubmission…'
                    }
                    value={rejectionNotes}
                    onChange={e => setRejectionNotes(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={handleReject}
                      disabled={submitting || !rejectionNotes.trim()}
                      className={`flex-1 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors ${
                        rejectionType === 'revision'
                          ? 'bg-blue-800 hover:bg-blue-700'
                          : 'bg-red-800 hover:bg-red-700'
                      }`}
                    >
                      {submitting ? 'Submitting…' : rejectionType === 'revision' ? 'Send Back for Revision' : 'Confirm Rejection & Downgrade'}
                    </button>
                    <button
                      onClick={() => { setRejecting(false); setError(''); setRejectionNotes(''); setRejectionType('downgrade') }}
                      disabled={submitting}
                      className="px-5 bg-gray-800 border border-gray-700 text-gray-400 font-semibold py-3 rounded-xl text-sm hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Revision banner + resubmit form — DM view */}
              {doc.status === 'needs_revision' && (
                <div className="space-y-3">
                  <div className="bg-blue-900/20 border border-blue-700/40 rounded-xl px-4 py-3">
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-1">
                      Document Sent Back for Revision
                      {doc.revision_requested_by_name && <span className="normal-case font-normal text-blue-500"> — by {doc.revision_requested_by_name}</span>}
                      {doc.revision_requested_at && <span className="normal-case font-normal text-blue-600"> on {fmtDateTime(doc.revision_requested_at)}</span>}
                    </p>
                    <p className="text-xs text-blue-200 leading-relaxed whitespace-pre-wrap">{doc.revision_notes}</p>
                  </div>

                  {(session.id === doc.author_id || session.role === 'developer') && (
                    !revisioning ? (
                      <button
                        onClick={() => {
                          setRevisionTitle(doc.title)
                          setRevisionNotes(doc.notes)
                          setRevisionExpectations(doc.expectations)
                          setRevisioning(true)
                          setError('')
                        }}
                        className="w-full bg-blue-700 hover:bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
                      >
                        Edit & Resubmit for Approval
                      </button>
                    ) : (
                      <div className="space-y-3 bg-gray-800/50 border border-gray-700 rounded-xl p-4">
                        <p className="text-xs font-bold text-white uppercase tracking-wide">Revise Document</p>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Document Title</label>
                          <input
                            type="text"
                            value={revisionTitle}
                            onChange={e => setRevisionTitle(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Summary of Discussion</label>
                          <textarea
                            rows={5}
                            value={revisionNotes}
                            onChange={e => setRevisionNotes(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Clear Expectations Moving Forward</label>
                          <textarea
                            rows={3}
                            value={revisionExpectations}
                            onChange={e => setRevisionExpectations(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={handleResubmit}
                            disabled={resubmitting || !revisionTitle.trim() || !revisionNotes.trim() || !revisionExpectations.trim()}
                            className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
                          >
                            {resubmitting ? 'Resubmitting…' : 'Resubmit for Approval'}
                          </button>
                          <button
                            onClick={() => { setRevisioning(false); setError('') }}
                            disabled={resubmitting}
                            className="px-5 bg-gray-800 border border-gray-700 text-gray-400 font-semibold py-3 rounded-xl text-sm hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Voice conversation actions */}
              {doc.status === 'approved' && (doc.conversation_status === 'pending' || doc.conversation_status === 'escalated') && (
                <div className="pt-2 border-t border-gray-800 space-y-3">
                  {/* Info banner */}
                  <div className={`rounded-xl px-4 py-3 ${doc.conversation_status === 'escalated' ? 'bg-red-900/20 border border-red-700/40' : 'bg-amber-900/20 border border-amber-700/40'}`}>
                    <p className={`text-xs font-semibold mb-1 ${doc.conversation_status === 'escalated' ? 'text-red-400' : 'text-amber-400'}`}>
                      {doc.conversation_status === 'escalated' ? '⚠ Voice Conversation Overdue' : 'Voice Conversation Required'}
                    </p>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {doc.conversation_status === 'escalated'
                        ? `The 24-hour window for the voice conversation has passed. The formal notice has not yet been sent to ${doc.subject_name}.`
                        : `Before the formal notice is sent to ${doc.subject_name}, the District Manager must complete a voice conversation. Once done, mark it complete below.`
                      }
                    </p>
                    {doc.conversation_approved_at && (
                      <p className="text-xs text-gray-600 mt-1">Approved: {fmtDateTime(doc.conversation_approved_at)}</p>
                    )}
                  </div>

                  {/* DM: mark conversation complete */}
                  {(session.role === 'manager' || session.role === 'ops_manager') && doc.author_id === session.id && (
                    <button
                      onClick={handleConversationComplete}
                      disabled={completingConvo}
                      className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
                    >
                      {completingConvo ? 'Sending Notice…' : 'Mark Voice Conversation Complete & Send Notice'}
                    </button>
                  )}

                  {/* SD/Owner/Dev: force send */}
                  {['sales_director', 'owner', 'developer'].includes(session.role) && (
                    <button
                      onClick={handleForceSend}
                      disabled={forceSending}
                      className="w-full bg-orange-900/30 hover:bg-orange-900/50 border border-orange-700/50 text-orange-400 font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50"
                    >
                      {forceSending ? 'Force Sending…' : 'Force Send Notice (Bypass Voice Conversation)'}
                    </button>
                  )}
                </div>
              )}

              {/* Manual reminder — owner / SD / dev */}
              {['owner', 'sales_director', 'developer'].includes(session.role) &&
               doc.status === 'approved' && doc.ack_status === 'pending' &&
               (!doc.conversation_status || doc.conversation_status === 'complete' || doc.conversation_status === 'bypassed') && (
                <div className="pt-2 border-t border-gray-800">
                  <button
                    onClick={handleRemind}
                    disabled={sendingReminder || reminderSent}
                    className={`w-full font-semibold py-3 rounded-xl text-sm transition-colors border ${
                      reminderSent
                        ? 'bg-green-900/20 border-green-700/40 text-green-400 cursor-default'
                        : 'bg-violet-600/10 hover:bg-violet-600/20 border-violet-600/30 text-violet-400 disabled:opacity-50'
                    }`}
                  >
                    {reminderSent ? 'Reminder Sent' : sendingReminder ? 'Sending…' : 'Send Acknowledgment Reminder'}
                  </button>
                </div>
              )}

              {/* Termination — final warning, acknowledged, DM/SD/Owner can initiate */}
              {doc.level === 'final' && doc.ack_status === 'acknowledged' &&
               ['manager', 'ops_manager', 'sales_director', 'owner', 'developer'].includes(session.role) && (
                <div className="pt-2 border-t border-gray-800">
                  {!terminationOpen ? (
                    <button
                      onClick={() => { setTerminationOpen(true); setError('') }}
                      className="w-full bg-red-900/20 hover:bg-red-900/40 border border-red-700/50 text-red-400 font-semibold py-3 rounded-xl text-sm transition-colors"
                    >
                      Initiate Termination Process
                    </button>
                  ) : (
                    <div className="space-y-3 bg-red-900/10 border border-red-800/40 rounded-xl p-4">
                      <div>
                        <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">Termination Request</p>
                        <p className="text-xs text-gray-400 leading-relaxed mb-3">
                          This will submit a termination request for <strong className="text-white">{doc.subject_name}</strong> for Sales Director approval. Once approved, a formal termination notice will be emailed to the employee and all management.
                        </p>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Reason(s) for Termination <span className="text-red-400">*</span></label>
                        <textarea
                          rows={4}
                          placeholder="Describe the specific reasons for termination, citing the documented incidents and any additional context…"
                          value={terminationReasons}
                          onChange={e => setTerminationReasons(e.target.value)}
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={handleTerminate}
                          disabled={terminating || !terminationReasons.trim()}
                          className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
                        >
                          {terminating ? 'Submitting…' : 'Submit for SD Approval'}
                        </button>
                        <button
                          onClick={() => { setTerminationOpen(false); setTerminationReasons(''); setError('') }}
                          disabled={terminating}
                          className="px-5 bg-gray-800 border border-gray-700 text-gray-400 font-semibold py-3 rounded-xl text-sm hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-400 text-center">{error}</p>}

              {/* Developer delete */}
              {session.role === 'developer' && (
                <div className="pt-2 border-t border-gray-800">
                  <button
                    onClick={handleDelete}
                    disabled={deleting || submitting}
                    className="w-full bg-red-900/20 hover:bg-red-900/40 border border-red-800/50 text-red-500 font-semibold py-2.5 rounded-xl text-xs transition-colors"
                  >
                    {deleting ? 'Deleting…' : '⚠ Delete Record (Dev Only)'}
                  </button>
                </div>
              )}

              {/* Audit log */}
              {doc.auditLog.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Audit Trail</p>
                  <div className="space-y-1.5">
                    {doc.auditLog.map((entry, i) => (
                      <div key={i} className="flex items-start gap-3 text-xs">
                        <span className="text-gray-600 shrink-0 mt-0.5">{fmtDateTime(entry.created_at)}</span>
                        <div>
                          <span className="text-gray-400">{actionLabel(entry.action)}</span>
                          {entry.actor_name && <span className="text-gray-600"> — {entry.actor_name}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Submit Form ──────────────────────────────────────────────────────────────
function SubmitForm({ session, subjects, onSuccess }: {
  session: Session
  subjects: Subject[]
  onSuccess: (refNumber: string) => void
}) {
  const [subjectId, setSubjectId] = useState('')
  const [subjectSearch, setSubjectSearch] = useState('')
  const [level, setLevel] = useState<'verbal' | 'written' | 'final'>('verbal')
  const [title, setTitle] = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [notes, setNotes] = useState('')
  const [expectations, setExpectations] = useState('')
  const [priorConvos, setPriorConvos] = useState<PriorConvo[]>([])
  const [linkedVerbalIds, setLinkedVerbalIds] = useState<string[]>([])
  const [availableVerbals, setAvailableVerbals] = useState<Doc[]>([])
  const [reminderAcknowledged, setReminderAcknowledged] = useState(false)
  const [testMode, setTestMode] = useState(session.role === 'developer')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Load available verbals for the selected subject (for linking)
  useEffect(() => {
    if (!subjectId) { setAvailableVerbals([]); return }
    fetch(`/api/accountability?subjectId=${subjectId}&level=verbal&status=approved`)
      .then(r => r.json())
      .then(d => setAvailableVerbals(d.docs ?? []))
      .catch(() => {})
  }, [subjectId])

  function addPriorConvo() {
    setPriorConvos(p => [...p, { convo_date: '', notes: '' }])
  }
  function removePriorConvo(i: number) {
    setPriorConvos(p => p.filter((_, idx) => idx !== i))
  }
  function updatePriorConvo(i: number, field: 'convo_date' | 'notes', value: string) {
    setPriorConvos(p => p.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }
  function toggleLinkedVerbal(id: string) {
    setLinkedVerbalIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  async function handleSubmit() {
    if (!subjectId || !title.trim() || !incidentDate || !notes.trim() || !expectations.trim()) {
      setError('Please fill in all required fields.'); return
    }
    if (!reminderAcknowledged) {
      setError('You must acknowledge the documentation reminder before submitting.'); return
    }
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/accountability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subjectId, level, title: title.trim(), incidentDate,
        notes: notes.trim(), expectations: expectations.trim(),
        priorConvos: priorConvos.filter(c => c.convo_date && c.notes.trim()),
        linkedVerbalIds,
        reminderAcknowledged,
        testMode: session.role === 'developer' ? testMode : false,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      onSuccess(data.refNumber)
    } else {
      setError(data.error ?? 'Submission failed. Please try again.')
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500'
  const labelCls = 'block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5'

  return (
    <div className="space-y-5 py-5">

      {/* Subject */}
      <div>
        <label className={labelCls}>
          {session.role === 'manager' ? 'Employee' : (session.role === 'developer' || session.role === 'owner') ? 'Subject' : 'District Manager'} <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          placeholder="Search by name…"
          value={subjectSearch}
          onChange={e => setSubjectSearch(e.target.value)}
          className={`${inputCls} mb-2`}
        />
        <select value={subjectId} onChange={e => { setSubjectId(e.target.value); setLinkedVerbalIds([]) }} className={inputCls}>
          <option value="">Select…</option>
          {subjects
            .filter(s => s.full_name.toLowerCase().includes(subjectSearch.toLowerCase()))
            .map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        {subjects.length === 0 && (
          <p className="text-xs text-amber-400 mt-1">No direct reports found in your account.</p>
        )}
      </div>

      {/* Level */}
      <div>
        <label className={labelCls}>Notice Level <span className="text-red-400">*</span></label>
        <div className="grid grid-cols-3 gap-2">
          {(['verbal', 'written', 'final'] as const).map(l => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              className={`py-3 px-2 rounded-xl border text-xs font-bold uppercase tracking-wide transition-colors ${
                level === l
                  ? l === 'verbal' ? 'bg-amber-700/30 border-amber-600 text-amber-300'
                    : l === 'written' ? 'bg-orange-700/30 border-orange-600 text-orange-300'
                    : 'bg-red-900/40 border-red-700 text-red-300'
                  : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
              }`}
            >
              {l === 'verbal' ? 'Verbal' : l === 'written' ? 'Written\n2nd Level' : 'Final\n3rd Level'}
            </button>
          ))}
        </div>
        {level !== 'verbal' && (
          <p className="text-xs text-amber-400 mt-2">
            ⚠ {level === 'written' ? 'Written' : 'Final'} notices require Sales Director and Owner approval before being sent.
          </p>
        )}
      </div>

      {/* Title */}
      <div>
        <label className={labelCls}>Document Title <span className="text-red-400">*</span></label>
        <input
          type="text"
          placeholder="e.g. Attendance Policy Violation, Customer Service Standards"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className={inputCls}
        />
      </div>

      {/* Incident date */}
      <div>
        <label className={labelCls}>Date of Conversation / Incident <span className="text-red-400">*</span></label>
        <input type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)} className={inputCls} />
      </div>

      {/* Prior conversations (written/final) */}
      {level !== 'verbal' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={labelCls + ' mb-0'}>Prior Conversations on Record</label>
            <button type="button" onClick={addPriorConvo} className="text-xs text-violet-400 hover:text-violet-300 font-semibold transition-colors">
              + Add Conversation
            </button>
          </div>
          {priorConvos.length === 0 && (
            <p className="text-xs text-gray-600 mb-2">No prior conversations added. Click "+ Add Conversation" to document any prior discussions about this matter.</p>
          )}
          <div className="space-y-3">
            {priorConvos.map((c, i) => (
              <div key={i} className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-400">Conversation {i + 1}</p>
                  <button type="button" onClick={() => removePriorConvo(i)} className="text-xs text-gray-600 hover:text-red-400 transition-colors">Remove</button>
                </div>
                <input
                  type="date"
                  value={c.convo_date}
                  onChange={e => updatePriorConvo(i, 'convo_date', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <textarea
                  rows={2}
                  placeholder="Brief summary of what was discussed…"
                  value={c.notes}
                  onChange={e => updatePriorConvo(i, 'notes', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link prior verbals */}
      {level !== 'verbal' && subjectId && availableVerbals.length > 0 && (
        <div>
          <label className={labelCls}>Link Related Prior Records <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
          <div className="space-y-2">
            {availableVerbals.map(v => (
              <label key={v.id} className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 cursor-pointer hover:border-gray-600 transition-colors">
                <input
                  type="checkbox"
                  checked={linkedVerbalIds.includes(v.id)}
                  onChange={() => toggleLinkedVerbal(v.id)}
                  className="accent-violet-500 w-4 h-4 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-300">{v.ref_number} — {v.title}</p>
                  <p className="text-xs text-gray-500">Incident: {fmtDate(v.incident_date)}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className={labelCls}>Summary of Discussion <span className="text-red-400">*</span></label>
        <p className="text-xs text-gray-600 mb-1.5">Document specifically what happened, what was said, and the full context of this conversation.</p>
        <textarea
          rows={6}
          placeholder="Describe the incident or behavior, the conversation that took place, what was communicated to the employee, and any relevant context…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className={inputCls + ' resize-none'}
        />
      </div>

      {/* Expectations */}
      <div>
        <label className={labelCls}>Clear Expectations Moving Forward <span className="text-red-400">*</span></label>
        <p className="text-xs text-gray-600 mb-1.5">State clearly and specifically what is expected going forward and any agreed-upon action plan.</p>
        <textarea
          rows={4}
          placeholder="List the specific expectations, behaviors, or improvements required, and any deadlines or follow-up dates…"
          value={expectations}
          onChange={e => setExpectations(e.target.value)}
          className={inputCls + ' resize-none'}
        />
      </div>

      {/* Developer test mode toggle */}
      {session.role === 'developer' && (
        <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl p-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={testMode}
              onChange={e => setTestMode(e.target.checked)}
              className="accent-blue-500 w-4 h-4 shrink-0"
            />
            <div>
              <p className="text-xs font-semibold text-blue-400">Test Mode (Dev Only)</p>
              <p className="text-xs text-blue-300/60">Record is created but no emails or push notifications are sent.</p>
            </div>
          </label>
        </div>
      )}

      {/* Reminder checkbox */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={reminderAcknowledged}
            onChange={e => setReminderAcknowledged(e.target.checked)}
            className="accent-violet-500 w-4 h-4 mt-0.5 shrink-0"
          />
          <p className="text-xs text-gray-300 leading-relaxed">
            <strong className="text-white">Documentation Reminder:</strong> I understand that I am required to retain a copy of this accountability document on file for a minimum of one year, and that this document is permanently on record and cannot be altered or deleted once submitted.
          </p>
        </label>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || !subjectId || !title.trim() || !incidentDate || !notes.trim() || !expectations.trim() || !reminderAcknowledged}
        className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors text-sm"
      >
        {submitting ? 'Submitting…' : level === 'verbal' ? 'Submit & Send Notice' : 'Submit for Approval'}
      </button>

      {level !== 'verbal' && (
        <p className="text-xs text-gray-600 text-center">
          This document will be sent to your Sales Director and Owner for review before being delivered to the employee.
        </p>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type MainTab = 'submit' | 'my-records' | 'pending' | 'all-records' | 'dm-records' | 'termination'

export default function AccountabilityPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [tab, setTab] = useState<MainTab>('submit')
  const [successRef, setSuccessRef] = useState<string | null>(null)

  // List state
  const [docs, setDocs] = useState<Doc[]>([])
  const [pendingApproval, setPendingApproval] = useState<Doc[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [authors, setAuthors] = useState<Author[]>([])
  const [loading, setLoading] = useState(false)

  // Termination requests
  const [termRequests, setTermRequests] = useState<TerminationRequest[]>([])
  const [termLoading, setTermLoading] = useState(false)
  const [termActing, setTermActing] = useState<string | null>(null)
  const [termError, setTermError] = useState('')

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterSubject, setFilterSubject] = useState('')
  const [filterAuthor, setFilterAuthor] = useState('')

  // Detail modal
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      setSession(d)
      // Default tab based on role
      if (d.role === 'manager') setTab('submit')
      else if (['sales_director','owner','developer'].includes(d.role)) setTab('pending')
      else setTab('all-records')
    })
  }, [])

  const loadDocs = useCallback(() => {
    if (!session) return
    setLoading(true)
    const params = new URLSearchParams()
    if (dateFrom)      params.set('dateFrom', dateFrom)
    if (dateTo)        params.set('dateTo', dateTo)
    if (filterSubject) params.set('subjectId', filterSubject)
    if (filterAuthor)  params.set('authorId', filterAuthor)
    fetch(`/api/accountability?${params}`)
      .then(r => r.json())
      .then(d => {
        setDocs(d.docs ?? [])
        setPendingApproval(d.pendingApproval ?? [])
        setSubjects(d.subjects ?? [])
        setAuthors(d.authors ?? [])
      })
      .finally(() => setLoading(false))
  }, [session, dateFrom, dateTo, filterSubject, filterAuthor])

  const loadTermRequests = useCallback(() => {
    setTermLoading(true)
    setTermError('')
    fetch('/api/accountability/termination')
      .then(r => r.json())
      .then(d => setTermRequests(d.requests ?? []))
      .catch(() => setTermError('Failed to load termination requests'))
      .finally(() => setTermLoading(false))
  }, [])

  async function handleTermAction(reqId: string, action: 'approve' | 'reject') {
    const req = termRequests.find(r => r.id === reqId)
    const msg = action === 'approve'
      ? `Approve termination for ${req?.employee_name}? This will immediately send the termination notice and lock their account.`
      : `Reject termination request for ${req?.employee_name}?`
    if (!confirm(msg)) return
    setTermActing(reqId)
    setTermError('')
    const res = await fetch(`/api/accountability/termination/${reqId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (res.ok) {
      loadTermRequests()
    } else {
      const d = await res.json()
      setTermError(d.error ?? 'Action failed')
    }
    setTermActing(null)
  }

  useEffect(() => {
    if (session) loadDocs()
  }, [session, tab, loadDocs])

  useEffect(() => {
    if (session && tab === 'termination') loadTermRequests()
  }, [session, tab, loadTermRequests])

  if (!session) return <div className="min-h-screen bg-gray-950" />
  if (!canViewDash(session.role)) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-500">Access denied.</p>
    </div>
  )

  const dmOnlyDocs = docs.filter(d => d.subject_role === 'manager')
  const employeeDocs = docs.filter(d => d.subject_role !== 'manager')

  // Tabs visible per role
  const tabs: Array<{ key: MainTab; label: string; badge?: number }> = []
  if (canSubmit(session.role)) tabs.push({ key: 'submit', label: 'New Document' })
  if (session.role === 'manager') tabs.push({ key: 'my-records', label: 'My Records' })
  if (canApprove(session.role)) tabs.push({ key: 'pending', label: 'Pending Approval', badge: pendingApproval.length })
  if (['sales_director','ops_manager','owner','developer'].includes(session.role)) {
    tabs.push({ key: 'all-records', label: 'All Records' })
    tabs.push({ key: 'dm-records', label: 'DM Records' })
  }
  if (['sales_director','owner','developer'].includes(session.role)) {
    const pendingTermCount = termRequests.filter(r => r.status === 'pending_approval').length
    tabs.push({ key: 'termination', label: 'Terminations', badge: pendingTermCount || undefined })
  }

  const filterBar = (
    <div className="flex flex-wrap gap-2 mb-4">
      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500" placeholder="From" />
      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500" />
      {subjects.length > 0 && (
        <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 flex-1 min-w-[160px]">
          <option value="">All employees</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      )}
      {session.role !== 'manager' && authors.length > 0 && (
        <select value={filterAuthor} onChange={e => setFilterAuthor(e.target.value)} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 flex-1 min-w-[140px]">
          <option value="">All authors</option>
          {authors.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
      )}
      <button onClick={loadDocs} className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">Search</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 bg-gray-950 sticky top-14 z-30 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSuccessRef(null) }}
            className={`px-4 py-3 text-sm font-semibold transition-colors border-b-2 whitespace-nowrap shrink-0 ${
              tab === t.key
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
            {t.badge ? (
              <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4">

        {/* ── New Document ── */}
        {tab === 'submit' && canSubmit(session.role) && (
          successRef ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Document Submitted</h2>
              <p className="text-gray-400 text-sm mb-1">Reference Number: <strong className="text-white font-mono">{successRef}</strong></p>
              <p className="text-gray-500 text-xs mb-6 max-w-xs">
                Your document has been filed. All required parties have been notified.
              </p>
              <button
                onClick={() => setSuccessRef(null)}
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
              >
                Submit Another
              </button>
            </div>
          ) : (
            <>
              <div className="pt-5 pb-2">
                <h1 className="text-xl font-bold text-white">New Accountability Document</h1>
                <p className="text-gray-500 text-xs mt-1">All documents are permanent and cannot be edited or deleted once submitted.</p>
              </div>
              <SubmitForm
                session={session}
                subjects={subjects.length ? subjects : []}
                onSuccess={ref => { setSuccessRef(ref) }}
              />
            </>
          )
        )}

        {/* ── My Records (DM only) ── */}
        {tab === 'my-records' && session.role === 'manager' && (
          <div className="pt-5">
            <h1 className="text-xl font-bold text-white mb-4">My Records</h1>
            {filterBar}
            {loading ? (
              <p className="text-center text-gray-500 py-10 text-sm">Loading…</p>
            ) : docs.length === 0 ? (
              <p className="text-center text-gray-500 py-10 text-sm">No accountability documents found.</p>
            ) : (
              <div className="space-y-3">
                {docs.map(d => <DocCard key={d.id} doc={d} onClick={() => setDetailId(d.id)} />)}
              </div>
            )}
          </div>
        )}

        {/* ── Pending Approval ── */}
        {tab === 'pending' && canApprove(session.role) && (
          <div className="pt-5">
            <h1 className="text-xl font-bold text-white mb-1">Pending Approval</h1>
            <p className="text-xs text-gray-500 mb-4">Documents requiring your review. SLA: 72 hours from submission.</p>
            {loading ? (
              <p className="text-center text-gray-500 py-10 text-sm">Loading…</p>
            ) : pendingApproval.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">No documents pending approval.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingApproval.map(d => (
                  <div key={d.id} className="relative">
                    <DocCard doc={d} onClick={() => setDetailId(d.id)} />
                    <div className="absolute top-4 right-4">
                      <span className="text-[10px] bg-amber-500 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                        Action Required
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── All Records ── */}
        {tab === 'all-records' && (
          <div className="pt-5">
            <h1 className="text-xl font-bold text-white mb-4">All Records</h1>
            {filterBar}
            {loading ? (
              <p className="text-center text-gray-500 py-10 text-sm">Loading…</p>
            ) : employeeDocs.length === 0 ? (
              <p className="text-center text-gray-500 py-10 text-sm">No records found for the selected filters.</p>
            ) : (
              <div className="space-y-3">
                {employeeDocs.map(d => <DocCard key={d.id} doc={d} onClick={() => setDetailId(d.id)} />)}
              </div>
            )}
          </div>
        )}

        {/* ── DM Records ── */}
        {tab === 'dm-records' && (
          <div className="pt-5">
            <h1 className="text-xl font-bold text-white mb-1">DM Accountability Records</h1>
            <p className="text-xs text-gray-500 mb-4">Accountability documents filed against District Managers.</p>
            {filterBar}
            {loading ? (
              <p className="text-center text-gray-500 py-10 text-sm">Loading…</p>
            ) : dmOnlyDocs.length === 0 ? (
              <p className="text-center text-gray-500 py-10 text-sm">No DM accountability records found.</p>
            ) : (
              <div className="space-y-3">
                {dmOnlyDocs.map(d => <DocCard key={d.id} doc={d} onClick={() => setDetailId(d.id)} />)}
              </div>
            )}
          </div>
        )}

        {/* ── Termination Requests ── */}
        {tab === 'termination' && ['sales_director','owner','developer'].includes(session.role) && (
          <div className="pt-5">
            <h1 className="text-xl font-bold text-white mb-1">Termination Requests</h1>
            <p className="text-xs text-gray-500 mb-4">Pending requests require your approval before the notice is sent and the account is locked.</p>
            {termError && <p className="text-sm text-red-400 mb-3">{termError}</p>}
            {termLoading ? (
              <p className="text-center text-gray-500 py-10 text-sm">Loading…</p>
            ) : termRequests.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">No termination requests on file.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {termRequests.map(req => {
                  const isPending = req.status === 'pending_approval'
                  const isApproved = req.status === 'approved'
                  const isActing = termActing === req.id
                  return (
                    <div
                      key={req.id}
                      className={`bg-gray-900 border rounded-2xl p-4 ${
                        isPending ? 'border-red-800/60' : 'border-gray-800'
                      }`}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <p className="text-sm font-bold text-white">{req.employee_name}</p>
                          <p className="text-xs text-gray-500">{req.employee_email}</p>
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0 ${
                          isPending ? 'bg-red-900/30 border-red-700/50 text-red-400'
                          : isApproved ? 'bg-green-900/20 border-green-700/40 text-green-400'
                          : 'bg-gray-700/30 border-gray-600/40 text-gray-400'
                        }`}>
                          {isPending ? 'Pending Approval' : isApproved ? 'Approved' : 'Rejected'}
                        </span>
                      </div>

                      {/* Meta */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="bg-gray-800 rounded-xl p-2.5">
                          <p className="text-xs text-gray-500 mb-0.5">Requested By</p>
                          <p className="text-xs font-medium text-white">{req.requested_by_name}</p>
                          <p className="text-[10px] text-gray-600 capitalize">{req.requested_by_role.replace('_', ' ')}</p>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-2.5">
                          <p className="text-xs text-gray-500 mb-0.5">Submitted</p>
                          <p className="text-xs font-medium text-white">{fmtDateTime(req.created_at)}</p>
                        </div>
                        {req.approved_by_name && (
                          <div className="bg-gray-800 rounded-xl p-2.5 col-span-2">
                            <p className="text-xs text-gray-500 mb-0.5">{isApproved ? 'Approved' : 'Rejected'} By</p>
                            <p className="text-xs font-medium text-white">{req.approved_by_name} {req.approved_at ? `— ${fmtDateTime(req.approved_at)}` : ''}</p>
                          </div>
                        )}
                      </div>

                      {/* Reasons */}
                      <div className="bg-red-900/10 border border-red-800/30 rounded-xl px-3 py-2.5 mb-3">
                        <p className="text-xs text-gray-500 mb-1">Reason(s) for Termination</p>
                        <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{req.reasons}</p>
                      </div>

                      {/* Actions — only for SD/owner/developer and only if pending */}
                      {isPending && ['sales_director','owner','developer'].includes(session.role) && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleTermAction(req.id, 'approve')}
                            disabled={isActing}
                            className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                          >
                            {isActing ? 'Processing…' : 'Approve & Send Termination Notice'}
                          </button>
                          <button
                            onClick={() => handleTermAction(req.id, 'reject')}
                            disabled={isActing}
                            className="px-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-50 text-gray-400 font-semibold py-2.5 rounded-xl text-sm transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Detail modal */}
      {detailId && (
        <DetailModal
          docId={detailId}
          session={session}
          onClose={() => setDetailId(null)}
          onApproved={() => { setDetailId(null); loadDocs() }}
          onRejected={() => { setDetailId(null); loadDocs() }}
          onDelete={() => { setDetailId(null); loadDocs() }}
        />
      )}
    </div>
  )
}
