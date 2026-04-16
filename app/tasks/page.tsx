'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'
import { currentWeekStart, formatWeekRange } from '@/lib/schedule'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'rdm' | 'developer'

interface Session {
  id: string
  fullName: string
  role: Role
}

interface Task {
  id: string
  week_start: string
  title: string
  description: string | null
  due_date: string | null
  assignee_id: string
  assignee_name: string
  created_by: string | null
  created_by_name: string | null
  created_at: string
  completed_at: string | null
  note: string | null
  photo_key: string | null
  photo_url: string | null
  completed_by_name: string | null
}

interface AssignableUser {
  id: string
  full_name: string
  role: string
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function TasksPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ title: '', description: '', assigneeId: '', dueDate: '' })
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState('')

  // Complete modal
  const [completingTask, setCompletingTask] = useState<Task | null>(null)
  const [completeNote, setCompleteNote] = useState('')
  const [photoKey, setPhotoKey] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState('')

  // Unchecking
  const [unchecking, setUnchecking] = useState<string | null>(null)

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Computed week
  const monday = (() => {
    const base = currentWeekStart()
    base.setDate(base.getDate() + weekOffset * 7)
    return base
  })()
  const weekStart = toDateStr(monday)
  const weekLabel = formatWeekRange(monday)

  const canCreate = session?.role === 'owner' || session?.role === 'sales_director' || session?.role === 'developer' || session?.role === 'rdm'
  const canCompleteTask = (task: Task) =>
    session?.id === task.assignee_id || canCreate

  // Load session + assignable users once
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  useEffect(() => {
    if (!session || !canCreate) return
    fetch('/api/team/users')
      .then(r => r.json())
      .then(d => {
        const all: AssignableUser[] = d.users ?? []
        setAssignableUsers(
          all.filter(u => u.role === 'manager' || u.role === 'ops_manager' || u.role === 'sales_director')
        )
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const loadTasks = useCallback(async () => {
    if (!session) return
    setLoading(true)
    const res = await fetch(`/api/tasks?weekStart=${weekStart}`)
    if (res.ok) {
      const data = await res.json()
      setTasks(data.tasks ?? [])
    }
    setLoading(false)
  }, [session, weekStart])

  useEffect(() => {
    if (!session) return
    loadTasks()
  }, [loadTasks, session])

  // ── Create task ──────────────────────────────────────────
  function openCreate() {
    setCreateForm({ title: '', description: '', assigneeId: assignableUsers[0]?.id ?? '', dueDate: '' })
    setCreateError('')
    setShowCreate(true)
  }

  async function submitCreate() {
    setCreateError('')
    if (!createForm.title.trim()) { setCreateError('Title is required.'); return }
    if (!createForm.assigneeId) { setCreateError('Please select an assignee.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart,
          title: createForm.title,
          description: createForm.description || null,
          assigneeId: createForm.assigneeId,
          dueDate: createForm.dueDate || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setCreateError(d.error ?? 'Failed to create task.')
        return
      }
      setShowCreate(false)
      await loadTasks()
    } catch {
      setCreateError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete task ──────────────────────────────────────────
  async function deleteTask(taskId: string) {
    if (!confirm('Delete this task?')) return
    await fetch('/api/tasks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    })
    await loadTasks()
  }

  // ── Complete modal ───────────────────────────────────────
  function openComplete(task: Task) {
    setCompletingTask(task)
    setCompleteNote('')
    setPhotoKey(null)
    setPhotoPreview(null)
    setCompleteError('')
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoPreview(URL.createObjectURL(file))
    setPhotoKey(null)
    setUploading(true)
    try {
      const urlRes = await fetch('/api/tasks/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      if (!urlRes.ok) { setCompleteError('Photo upload failed.'); setUploading(false); return }
      const { url, key } = await urlRes.json()
      const s3Res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!s3Res.ok) { setCompleteError('Photo upload failed.'); setUploading(false); return }
      setPhotoKey(key)
    } catch {
      setCompleteError('Photo upload failed.')
    }
    setUploading(false)
  }

  async function submitComplete() {
    if (!completingTask) return
    setCompleteError('')
    setCompleting(true)
    try {
      const res = await fetch('/api/tasks/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: completingTask.id, note: completeNote || null, photoKey }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setCompleteError(d.error ?? 'Failed to complete task.')
        return
      }
      setCompletingTask(null)
      await loadTasks()
    } catch {
      setCompleteError('Network error. Please try again.')
    } finally {
      setCompleting(false)
    }
  }

  async function uncheckTask(taskId: string) {
    setUnchecking(taskId)
    try {
      await fetch('/api/tasks/complete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      await loadTasks()
    } finally {
      setUnchecking(null)
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const pendingTasks = tasks.filter(t => !t.completed_at)
  const completedTasks = tasks.filter(t => t.completed_at)

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">Tasks</h1>
          {canCreate && (
            <button
              onClick={openCreate}
              className="text-sm bg-violet-600 hover:bg-violet-500 text-white font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              + Assign Task
            </button>
          )}
        </div>

        {/* Week nav */}
        <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 mb-5">
          <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white text-xl px-1 transition-colors">‹</button>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">{weekLabel}</p>
            {weekOffset === 0 && <p className="text-[10px] text-violet-400">Current Week</p>}
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 hover:text-white text-xl px-1 transition-colors">›</button>
        </div>

        {loading ? (
          <div className="text-center text-gray-500 py-16">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No tasks for this week</p>
            {canCreate && <p className="text-gray-700 text-xs mt-1">Tap "+ Assign Task" to create one</p>}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Pending */}
            {pendingTasks.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">
                  Pending — {pendingTasks.length}
                </p>
                <div className="space-y-2">
                  {pendingTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      session={session}
                      canCreate={canCreate}
                      canComplete={canCompleteTask(task)}
                      unchecking={unchecking}
                      onComplete={() => openComplete(task)}
                      onUncheck={uncheckTask}
                      onDelete={deleteTask}
                      onLightbox={setLightboxUrl}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed */}
            {completedTasks.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">
                  Completed — {completedTasks.length}
                </p>
                <div className="space-y-2">
                  {completedTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      session={session}
                      canCreate={canCreate}
                      canComplete={canCompleteTask(task)}
                      unchecking={unchecking}
                      onComplete={() => openComplete(task)}
                      onUncheck={uncheckTask}
                      onDelete={deleteTask}
                      onLightbox={setLightboxUrl}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-5">Assign Task</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Title</label>
                <input
                  type="text"
                  placeholder="What needs to be done?"
                  value={createForm.title}
                  onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Description (optional)</label>
                <textarea
                  placeholder="Additional details…"
                  value={createForm.description}
                  onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Assign To</label>
                <select
                  value={createForm.assigneeId}
                  onChange={e => setCreateForm(f => ({ ...f, assigneeId: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                >
                  <option value="">Select person…</option>
                  {assignableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.role === 'manager' ? 'DM' : u.role.replace('_', ' ')})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Due Date <span className="text-gray-600">(optional)</span></label>
                <input
                  type="date"
                  value={createForm.dueDate}
                  onChange={e => setCreateForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              {createError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400">{createError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={submitCreate}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {saving ? 'Saving…' : 'Assign Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Complete Modal ── */}
      {completingTask && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setCompletingTask(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">Mark Complete</h2>
            <p className="text-sm text-gray-500 mb-5 truncate">{completingTask.title}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Note (optional)</label>
                <textarea
                  placeholder="Any notes on completion…"
                  value={completeNote}
                  onChange={e => setCompleteNote(e.target.value)}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Photo (optional)</label>
                {photoPreview ? (
                  <div className="relative">
                    <img src={photoPreview} alt="preview" className="w-full h-40 object-cover rounded-xl" />
                    <button
                      onClick={() => { setPhotoPreview(null); setPhotoKey(null) }}
                      className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm"
                    >×</button>
                    {uploading && (
                      <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                        <p className="text-white text-xs">Uploading…</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="flex items-center justify-center w-full h-20 bg-gray-800 border border-dashed border-gray-700 rounded-xl cursor-pointer hover:border-violet-500 transition-colors">
                    <span className="text-sm text-gray-500">Tap to add photo</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                  </label>
                )}
              </div>
              {completeError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400">{completeError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setCompletingTask(null)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={submitComplete}
                  disabled={completing || uploading}
                  className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {completing ? 'Saving…' : 'Mark Complete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo Lightbox ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white bg-gray-800 rounded-full w-9 h-9 flex items-center justify-center text-lg hover:bg-gray-700 transition-colors"
          >×</button>
          <img
            src={lightboxUrl}
            alt="Task photo"
            className="max-w-full max-h-full rounded-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

// ── Task Card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  session,
  canCreate,
  canComplete,
  unchecking,
  onComplete,
  onUncheck,
  onDelete,
  onLightbox,
}: {
  task: Task
  session: Session
  canCreate: boolean
  canComplete: boolean
  unchecking: string | null
  onComplete: () => void
  onUncheck: (id: string) => void
  onDelete: (id: string) => void
  onLightbox: (url: string) => void
}) {
  const isDone = !!task.completed_at
  const ROLE_LABELS: Record<string, string> = {
    manager: 'DM', ops_manager: 'Ops Manager',
    sales_director: 'Sales Director', owner: 'Owner', developer: 'Developer',
  }
  const today = new Date().toISOString().split('T')[0]
  const isOverdue = !isDone && !!task.due_date && task.due_date < today
  const isDueToday = !isDone && task.due_date === today

  return (
    <div className={`bg-gray-900 border rounded-2xl overflow-hidden ${isDone ? 'border-green-900/50' : isOverdue ? 'border-red-800/60' : 'border-gray-800'}`}>
      <div className="flex items-start gap-3 p-4">
        {/* Checkmark button */}
        {canComplete ? (
          <button
            onClick={isDone ? () => onUncheck(task.id) : onComplete}
            disabled={unchecking === task.id}
            className={`mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
              isDone
                ? 'bg-green-600 border-green-600 hover:bg-green-700'
                : 'border-gray-600 hover:border-green-500'
            } disabled:opacity-40`}
            title={isDone ? 'Mark incomplete' : 'Mark complete'}
          >
            {isDone && (
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        ) : (
          <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${isDone ? 'bg-green-600 border-green-600' : 'border-gray-700'}`}>
            {isDone && (
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${isDone ? 'text-gray-400 line-through' : 'text-white'}`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] bg-violet-900/40 text-violet-300 border border-violet-800/40 px-2 py-0.5 rounded-full">
              {task.assignee_name}
            </span>
            {task.created_by_name && (
              <span className="text-[10px] text-gray-600">from {task.created_by_name}</span>
            )}
            {task.due_date && !isDone && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                isOverdue
                  ? 'bg-red-900/40 text-red-400 border border-red-800/40'
                  : isDueToday
                  ? 'bg-amber-900/40 text-amber-400 border border-amber-800/40'
                  : 'bg-gray-800 text-gray-400 border border-gray-700'
              }`}>
                {isOverdue ? '⚠ Overdue · ' : isDueToday ? '· Due today' : 'Due '}
                {isOverdue || isDueToday ? '' : new Date(task.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {isOverdue ? new Date(task.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
              </span>
            )}
          </div>

          {/* Completion info */}
          {isDone && (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs text-green-500">
                ✓ Completed {fmtDateTime(task.completed_at!)}
                {task.completed_by_name && ` by ${task.completed_by_name}`}
              </p>
              {task.note && (
                <p className="text-xs text-gray-400 italic">"{task.note}"</p>
              )}
              {task.photo_url && (
                <button onClick={() => onLightbox(task.photo_url!)} className="block">
                  <img
                    src={task.photo_url}
                    alt="Completion photo"
                    className="h-20 w-32 object-cover rounded-lg border border-gray-700 hover:border-violet-500 transition-colors"
                  />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Delete button */}
        {canCreate && (
          <button
            onClick={() => onDelete(task.id)}
            className="shrink-0 text-gray-700 hover:text-red-400 transition-colors text-lg leading-none mt-0.5"
            title="Delete task"
          >×</button>
        )}
      </div>
    </div>
  )
}
