'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'
import { currentWeekStart, formatWeekRange } from '@/lib/schedule'

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

function Linkified({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const url = match[0]
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="text-violet-400 hover:text-violet-300 underline underline-offset-2 break-all"
      >
        {url}
      </a>
    )
    last = match.index + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <p className={className}>{parts}</p>
}

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

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
  assignee_avatar_url?: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  completed_at: string | null
  note: string | null
  photo_key: string | null
  photo_url: string | null
  photo_keys: string[]
  photo_urls: string[]
  completed_by_name: string | null
  require_photo: boolean
  group_task_id: string | null
  scheduled_send_at: string | null
  notification_sent_at: string | null
  recurrence: string
  recurrence_id: string | null
  store_id: string | null
  store_address: string | null
  storeAssignees?: string[]
}

interface AssignableUser {
  id: string
  full_name: string
  role: string
  manager_id: string | null
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function getWeekStartFromDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  return toDateStr(d)
}

function deduplicateStoreTasks(rawTasks: Task[]): Task[] {
  const storeGroups = new Map<string, Task[]>()
  for (const t of rawTasks) {
    if (t.store_id && t.group_task_id) {
      const g = storeGroups.get(t.group_task_id) ?? []
      g.push(t)
      storeGroups.set(t.group_task_id, g)
    }
  }
  const seen = new Set<string>()
  const result: Task[] = []
  for (const t of rawTasks) {
    if (t.store_id && t.group_task_id) {
      if (!seen.has(t.group_task_id)) {
        seen.add(t.group_task_id)
        const group = storeGroups.get(t.group_task_id)!
        const completed = group.find(g => g.completed_at)
        result.push({ ...(completed ?? group[0]), storeAssignees: group.map(g => g.assignee_name) })
      }
    } else {
      result.push(t)
    }
  }
  return result
}

export default function TasksPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current')
  const [historyTasks, setHistoryTasks] = useState<Task[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyAssigneeId, setHistoryAssigneeId] = useState('')
  const [reminding, setReminding] = useState<string | null>(null)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ title: '', description: '', assigneeIds: [] as string[], dueDate: '', dueTime: '', requirePhoto: false, scheduledSend: false, scheduledSendDate: '', scheduledSendTime: '', recurrence: 'none' })
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState('')
  const [multiPrompt, setMultiPrompt] = useState(false)

  // Complete modal
  const [completingTask, setCompletingTask] = useState<Task | null>(null)
  const [completeNote, setCompleteNote] = useState('')
  const [photoEntries, setPhotoEntries] = useState<{ key: string | null; preview: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState('')

  // Task filter
  const [taskFilter, setTaskFilter] = useState<'all' | 'mine' | 'employee' | 'dm'>('all')
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [filterDmId, setFilterDmId] = useState('')

  // Delete recurring modal
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)

  // Unchecking
  const [unchecking, setUnchecking] = useState<string | null>(null)

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Store task
  const [assignMode, setAssignMode] = useState<'person' | 'store'>('person')
  const [stores, setStores] = useState<{ id: string; address: string }[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [storeEmployees, setStoreEmployees] = useState<{ id: string; full_name: string }[]>([])
  const [storeEmployeesLoading, setStoreEmployeesLoading] = useState(false)
  const [fallbackEmployeeId, setFallbackEmployeeId] = useState('')
  const [reassigningTask, setReassigningTask] = useState<Task | null>(null)
  const [reassignToId, setReassignToId] = useState('')
  const [reassignSaving, setReassignSaving] = useState(false)

  // Computed week
  const monday = (() => {
    const base = currentWeekStart()
    base.setDate(base.getDate() + weekOffset * 7)
    return base
  })()
  const weekStart = toDateStr(monday)
  const weekLabel = formatWeekRange(monday)

  const canCreate = session?.role === 'owner' || session?.role === 'sales_director' || session?.role === 'developer' || session?.role === 'manager' || session?.role === 'ops_manager'
  const canCompleteTask = (task: Task) =>
    session?.id === task.assignee_id || session?.id === task.created_by || canCreate

  // Load session
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  // Load assignable users
  useEffect(() => {
    if (!session || !canCreate) return
    const url = session.role === 'manager' ? '/api/team/users?withPeers=true' : '/api/team/users'
    fetch(url)
      .then(r => r.json())
      .then(d => setAssignableUsers(d.users ?? []))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Load accessible stores for store task creation
  useEffect(() => {
    if (!session || !canCreate) return
    fetch('/api/tasks/store-employees')
      .then(r => r.json())
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Load employees scheduled at selected store on due date
  useEffect(() => {
    if (!selectedStoreId || !createForm.dueDate) { setStoreEmployees([]); setFallbackEmployeeId(''); return }
    setStoreEmployeesLoading(true)
    fetch(`/api/tasks/store-employees?storeId=${encodeURIComponent(selectedStoreId)}&date=${createForm.dueDate}`)
      .then(r => r.json())
      .then(d => { setStoreEmployees(d.employees ?? []); setFallbackEmployeeId('') })
      .catch(() => setStoreEmployees([]))
      .finally(() => setStoreEmployeesLoading(false))
  }, [selectedStoreId, createForm.dueDate])

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
    setCreateForm({ title: '', description: '', assigneeIds: [], dueDate: '', dueTime: '', requirePhoto: false, scheduledSend: false, scheduledSendDate: '', scheduledSendTime: '', recurrence: 'none' })
    setCreateError('')
    setMultiPrompt(false)
    setAssignMode('person')
    setSelectedStoreId('')
    setStoreEmployees([])
    setFallbackEmployeeId('')
    setShowCreate(true)
  }

  function toggleAssignee(id: string) {
    setCreateForm(f => ({
      ...f,
      assigneeIds: f.assigneeIds.includes(id)
        ? f.assigneeIds.filter(x => x !== id)
        : [...f.assigneeIds, id],
    }))
  }

  async function submitCreate() {
    setCreateError('')
    if (!createForm.title.trim()) { setCreateError('Title is required.'); return }
    if (!createForm.dueDate || !createForm.dueTime) { setCreateError('Due date and time are required.'); return }

    if (assignMode === 'store') {
      if (!selectedStoreId) { setCreateError('Please select a store.'); return }
      if (storeEmployees.length === 0 && !fallbackEmployeeId) {
        setCreateError('No employees scheduled. Please select an employee to assign to.')
        return
      }
      await doSubmit('separate')
      return
    }

    if (!createForm.assigneeIds.length) { setCreateError('Please select at least one assignee.'); return }
    if (createForm.scheduledSend && (!createForm.scheduledSendDate || !createForm.scheduledSendTime)) {
      setCreateError('Scheduled delivery date and time are required.')
      return
    }
    if (createForm.assigneeIds.length > 1) {
      setMultiPrompt(true)
      return
    }
    await doSubmit('separate')
  }

  async function doSubmit(mode: 'separate' | 'group') {
    setMultiPrompt(false)
    const dueDateISO = new Date(`${createForm.dueDate}T${createForm.dueTime}`).toISOString()

    // ── Store task ──
    if (assignMode === 'store') {
      const storeInfo = stores.find(s => s.id === selectedStoreId)
      const storeAssigneeIds = storeEmployees.length > 0
        ? storeEmployees.map(e => e.id)
        : (fallbackEmployeeId ? [fallbackEmployeeId] : [])
      if (!storeAssigneeIds.length) { setCreateError('No employees to assign to.'); return }
      const storeWeekStart = getWeekStartFromDate(createForm.dueDate)
      setSaving(true)
      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weekStart: storeWeekStart,
            title: createForm.title,
            description: createForm.description || null,
            dueDate: dueDateISO,
            requirePhoto: createForm.requirePhoto,
            storeId: selectedStoreId,
            storeAddress: storeInfo?.address ?? '',
            storeAssigneeIds,
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
      return
    }

    // ── Regular task ──
    const scheduledSendAt = createForm.scheduledSend && createForm.scheduledSendDate && createForm.scheduledSendTime
      ? new Date(`${createForm.scheduledSendDate}T${createForm.scheduledSendTime}`).toISOString()
      : null
    const groupTaskId = mode === 'group' ? crypto.randomUUID() : null
    setSaving(true)
    try {
      for (const assigneeId of createForm.assigneeIds) {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weekStart,
            title: createForm.title,
            description: createForm.description || null,
            assigneeId,
            dueDate: dueDateISO,
            requirePhoto: createForm.requirePhoto,
            groupTaskId,
            scheduledSendAt,
            recurrence: createForm.recurrence,
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setCreateError(d.error ?? 'Failed to create task.')
          return
        }
      }
      setShowCreate(false)
      await loadTasks()
    } catch {
      setCreateError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Load history ─────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!session) return
    setHistoryLoading(true)
    const url = `/api/tasks?history=true${historyAssigneeId ? `&assigneeId=${historyAssigneeId}` : ''}`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      setHistoryTasks(data.tasks ?? [])
    }
    setHistoryLoading(false)
  }, [session, historyAssigneeId])

  useEffect(() => {
    if (activeTab === 'history' && session) loadHistory()
  }, [activeTab, loadHistory, session])

  // ── Send reminder ─────────────────────────────────────────
  async function sendReminder(taskId: string) {
    setReminding(taskId)
    try {
      await fetch('/api/tasks/remind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
    } finally {
      setReminding(null)
    }
  }

  // ── Delete task ──────────────────────────────────────────
  async function deleteTask(taskId: string) {
    const task = [...tasks, ...historyTasks].find(t => t.id === taskId)
    if (task?.recurrence && task.recurrence !== 'none' && task.recurrence_id) {
      setDeletingTask(task)
      return
    }
    if (!confirm('Delete this task?')) return
    await fetch('/api/tasks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    })
    await loadTasks()
  }

  async function confirmDeleteTask(mode: 'single' | 'series') {
    if (!deletingTask) return
    const body = mode === 'series' && deletingTask.recurrence_id
      ? { seriesId: deletingTask.recurrence_id }
      : { taskId: deletingTask.id }
    setDeletingTask(null)
    await fetch('/api/tasks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await loadTasks()
  }

  // ── Complete modal ───────────────────────────────────────
  function openComplete(task: Task) {
    setCompletingTask(task)
    setCompleteNote('')
    setPhotoEntries([])
    setCompleteError('')
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      const preview = URL.createObjectURL(file)
      setPhotoEntries(prev => [...prev, { key: null, preview }])
      try {
        const urlRes = await fetch('/api/tasks/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        })
        if (urlRes.ok) {
          const { url, key } = await urlRes.json()
          const s3Res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
          if (s3Res.ok) {
            setPhotoEntries(prev => prev.map(e => e.preview === preview ? { ...e, key } : e))
          } else {
            setPhotoEntries(prev => prev.filter(e => e.preview !== preview))
            setCompleteError('Photo upload failed. Please try again.')
          }
        } else {
          setPhotoEntries(prev => prev.filter(e => e.preview !== preview))
          setCompleteError('Could not get upload URL. Please try again.')
        }
      } catch {
        setPhotoEntries(prev => prev.filter(e => e.preview !== preview))
        setCompleteError('Network error during upload. Please try again.')
      }
    }
    setUploading(false)
  }

  async function submitComplete() {
    if (!completingTask) return
    setCompleteError('')
    if (completingTask.require_photo && !photoEntries.some(e => e.key)) {
      setCompleteError('A photo is required to complete this task.')
      return
    }
    setCompleting(true)
    try {
      const res = await fetch('/api/tasks/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: completingTask.id,
          note: completeNote || null,
          photoKey: photoEntries[0]?.key ?? null,
          photoKeys: photoEntries.filter(e => e.key).map(e => e.key),
        }),
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

  // ── Reassign store task ──────────────────────────────────
  async function submitReassign() {
    if (!reassigningTask || !reassignToId) return
    setReassignSaving(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: reassigningTask.id, reassignToId }),
      })
      if (!res.ok) return
      setReassigningTask(null)
      setReassignToId('')
      await loadTasks()
    } finally {
      setReassignSaving(false)
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const assigneeManagerMap = new Map(assignableUsers.map(u => [u.id, u.manager_id]))
  const dmUsers = assignableUsers.filter(u => u.role === 'manager' || u.role === 'ops_manager')
  const empUsers = assignableUsers.filter(u => u.role === 'employee')

  const filteredTasks = (() => {
    const base = session.role !== 'employee' ? deduplicateStoreTasks(tasks) : tasks
    if (!canCreate) return base
    if (taskFilter === 'mine') return base.filter(t => t.assignee_id === session.id)
    if (taskFilter === 'employee' && filterEmployeeId) return base.filter(t => t.assignee_id === filterEmployeeId)
    if (taskFilter === 'dm' && filterDmId) return base.filter(t => assigneeManagerMap.get(t.assignee_id) === filterDmId)
    return base
  })()

  const pendingTasks = filteredTasks.filter(t => !t.completed_at)
  const completedTasks = filteredTasks.filter(t => t.completed_at)

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">Tasks</h1>
          {canCreate && activeTab === 'current' && (
            <button
              onClick={openCreate}
              className="text-sm bg-violet-600 hover:bg-violet-500 text-white font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              + Assign Task
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-800 mb-5">
          {(['current', 'history'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
                activeTab === tab
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab === 'current' ? 'This Week' : 'History'}
            </button>
          ))}
        </div>

        {/* ── Current week ── */}
        {activeTab === 'current' && (
          <>
            {/* Week nav */}
            <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 mb-5">
              <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white text-xl px-1 transition-colors">‹</button>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">{weekLabel}</p>
                {weekOffset === 0 && <p className="text-[10px] text-violet-400">Current Week</p>}
              </div>
              <button onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 hover:text-white text-xl px-1 transition-colors">›</button>
            </div>

            {/* Task filter pills */}
            {canCreate && (
              <div className="mb-4 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'mine', 'employee', 'dm'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => { setTaskFilter(f); setFilterEmployeeId(''); setFilterDmId('') }}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                        taskFilter === f
                          ? 'bg-violet-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                      }`}
                    >
                      {f === 'all' ? 'All' : f === 'mine' ? 'My Tasks' : f === 'employee' ? 'By Employee' : 'By DM'}
                    </button>
                  ))}
                </div>
                {taskFilter === 'employee' && (
                  <select
                    value={filterEmployeeId}
                    onChange={e => setFilterEmployeeId(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Select employee…</option>
                    {empUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                )}
                {taskFilter === 'dm' && (
                  <select
                    value={filterDmId}
                    onChange={e => setFilterDmId(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Select DM…</option>
                    {dmUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {loading ? (
              <div className="text-center text-gray-500 py-16">Loading…</div>
            ) : filteredTasks.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-sm">
                  {taskFilter === 'mine' ? 'No tasks assigned to you this week' :
                   taskFilter === 'employee' && filterEmployeeId ? 'No tasks for this employee this week' :
                   taskFilter === 'dm' && filterDmId ? 'No tasks for this DM\'s team this week' :
                   'No tasks for this week'}
                </p>
                {canCreate && taskFilter === 'all' && <p className="text-gray-700 text-xs mt-1">Tap "+ Assign Task" to create one</p>}
              </div>
            ) : (
              <div className="space-y-5">
                {pendingTasks.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Pending — {pendingTasks.length}</p>
                    <div className="space-y-2">
                      {pendingTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          session={session}
                          canCreate={canCreate}
                          canComplete={canCompleteTask(task)}
                          unchecking={unchecking}
                          reminding={reminding}
                          onComplete={() => openComplete(task)}
                          onUncheck={uncheckTask}
                          onDelete={deleteTask}
                          onLightbox={setLightboxUrl}
                          onRemind={sendReminder}
                          onReassign={task.store_id && canCreate ? () => { setReassigningTask(task); setReassignToId('') } : undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {completedTasks.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Completed — {completedTasks.length}</p>
                    <div className="space-y-2">
                      {completedTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          session={session}
                          canCreate={canCreate}
                          canComplete={canCompleteTask(task)}
                          unchecking={unchecking}
                          reminding={reminding}
                          onComplete={() => openComplete(task)}
                          onUncheck={uncheckTask}
                          onDelete={deleteTask}
                          onLightbox={setLightboxUrl}
                          onRemind={sendReminder}
                          onReassign={undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── History tab ── */}
        {activeTab === 'history' && (
          <>
            {canCreate && (
              <div className="mb-4">
                <select
                  value={historyAssigneeId}
                  onChange={e => setHistoryAssigneeId(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                >
                  <option value="">All assignees</option>
                  {assignableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
              </div>
            )}
            {historyLoading ? (
              <div className="text-center text-gray-500 py-16">Loading…</div>
            ) : historyTasks.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-sm">No completed tasks in the last 60 days</p>
              </div>
            ) : (
              <div className="space-y-2">
                {deduplicateStoreTasks(historyTasks).map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    session={session}
                    canCreate={canCreate}
                    canComplete={false}
                    unchecking={unchecking}
                    reminding={reminding}
                    onComplete={() => {}}
                    onUncheck={uncheckTask}
                    onDelete={deleteTask}
                    onLightbox={setLightboxUrl}
                    onRemind={sendReminder}
                    onReassign={undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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

              {/* Assign mode toggle */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Assign To</label>
                <div className="flex rounded-xl overflow-hidden border border-gray-700 mb-3">
                  <button
                    type="button"
                    onClick={() => setAssignMode('person')}
                    className={`flex-1 py-2 text-sm font-semibold transition-colors ${assignMode === 'person' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                  >
                    Person
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssignMode('store')}
                    className={`flex-1 py-2 text-sm font-semibold transition-colors ${assignMode === 'store' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                  >
                    Store
                  </button>
                </div>

                {/* Person mode */}
                {assignMode === 'person' && (
                  <div>
                    {createForm.assigneeIds.length > 0 && (
                      <p className="text-xs text-violet-400 mb-1.5">{createForm.assigneeIds.length} selected</p>
                    )}
                    <div className="max-h-40 overflow-y-auto bg-gray-800 border border-gray-700 rounded-xl divide-y divide-gray-700/60">
                      {assignableUsers.map(u => (
                        <label key={u.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-700/40 transition-colors">
                          <input
                            type="checkbox"
                            checked={createForm.assigneeIds.includes(u.id)}
                            onChange={() => toggleAssignee(u.id)}
                            className="w-4 h-4 accent-violet-500 shrink-0"
                          />
                          <span className="text-sm text-white">{u.full_name}</span>
                          <span className="text-xs text-gray-500 ml-auto">{u.role === 'manager' ? 'DM' : u.role.replace('_', ' ')}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Store mode */}
                {assignMode === 'store' && (
                  <div className="space-y-3">
                    <select
                      value={selectedStoreId}
                      onChange={e => setSelectedStoreId(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                    >
                      <option value="">— Select a store —</option>
                      {stores.map(s => (
                        <option key={s.id} value={s.id}>{s.address}</option>
                      ))}
                    </select>

                    {selectedStoreId && !createForm.dueDate && (
                      <p className="text-xs text-gray-500">Set a due date below to see who is scheduled.</p>
                    )}

                    {selectedStoreId && createForm.dueDate && (
                      <div className="bg-gray-800/60 border border-gray-700 rounded-xl px-4 py-3">
                        {storeEmployeesLoading ? (
                          <p className="text-xs text-gray-500">Checking schedule…</p>
                        ) : storeEmployees.length > 0 ? (
                          <>
                            <p className="text-xs text-gray-400 mb-2">Scheduled on {createForm.dueDate}:</p>
                            <div className="space-y-1">
                              {storeEmployees.map(e => (
                                <p key={e.id} className="text-sm text-white">{e.full_name}</p>
                              ))}
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                              All {storeEmployees.length} employee{storeEmployees.length > 1 ? 's' : ''} will receive this task. Notification sends the evening before the due date.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-amber-400 mb-2">No one is scheduled at this store on {createForm.dueDate}.</p>
                            <label className="block text-xs text-gray-400 mb-1.5">Select an employee to assign to instead:</label>
                            <select
                              value={fallbackEmployeeId}
                              onChange={e => setFallbackEmployeeId(e.target.value)}
                              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                            >
                              <option value="">— Select employee —</option>
                              {assignableUsers.filter(u => u.role === 'employee').map(u => (
                                <option key={u.id} value={u.id}>{u.full_name}</option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Due Date &amp; Time</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    required
                    value={createForm.dueDate}
                    onChange={e => setCreateForm(f => ({ ...f, dueDate: e.target.value }))}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                  <input
                    type="time"
                    required
                    value={createForm.dueTime}
                    onChange={e => setCreateForm(f => ({ ...f, dueTime: e.target.value }))}
                    className="w-32 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createForm.requirePhoto}
                  onChange={e => setCreateForm(f => ({ ...f, requirePhoto: e.target.checked }))}
                  className="w-4 h-4 accent-violet-500"
                />
                <span className="text-sm text-gray-300">Require photo to complete</span>
              </label>

              {assignMode === 'person' && (
                <>
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={createForm.scheduledSend}
                      onChange={e => setCreateForm(f => ({ ...f, scheduledSend: e.target.checked }))}
                      className="w-4 h-4 accent-violet-500"
                    />
                    <span className="text-sm text-gray-300">Schedule delivery for later</span>
                  </label>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Recurrence</label>
                    <select
                      value={createForm.recurrence}
                      onChange={e => setCreateForm(f => ({ ...f, recurrence: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                    >
                      <option value="none">One-time</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every 2 Weeks</option>
                      <option value="monthly">Monthly</option>
                    </select>
                    {createForm.recurrence !== 'none' && (
                      <p className="text-xs text-gray-500 mt-1">A new task will be created automatically for the same assignee(s) each cycle.</p>
                    )}
                  </div>
                  {createForm.scheduledSend && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Deliver notification on</label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={createForm.scheduledSendDate}
                          onChange={e => setCreateForm(f => ({ ...f, scheduledSendDate: e.target.value }))}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                        />
                        <input
                          type="time"
                          value={createForm.scheduledSendTime}
                          onChange={e => setCreateForm(f => ({ ...f, scheduledSendTime: e.target.value }))}
                          className="w-32 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">The assignee won&apos;t receive a notification until this date and time.</p>
                    </div>
                  )}
                </>
              )}

              {assignMode === 'store' && (
                <p className="text-xs text-gray-500">Employees will be notified the evening before the due date.</p>
              )}

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

      {/* ── Multi-assign Prompt ── */}
      {multiPrompt && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6" onClick={() => setMultiPrompt(false)}>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white mb-1">Assign to {createForm.assigneeIds.length} people</h2>
            <p className="text-sm text-gray-400 mb-5">How would you like to send this task?</p>
            <div className="space-y-3">
              <button
                onClick={() => doSubmit('separate')}
                className="w-full text-left bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl px-4 py-3.5 transition-colors"
              >
                <p className="text-sm font-semibold text-white">Send Separately</p>
                <p className="text-xs text-gray-500 mt-0.5">Each person gets their own independent task</p>
              </button>
              <button
                onClick={() => doSubmit('group')}
                className="w-full text-left bg-violet-900/30 hover:bg-violet-900/50 border border-violet-700/50 rounded-xl px-4 py-3.5 transition-colors"
              >
                <p className="text-sm font-semibold text-violet-300">Send as Group Task</p>
                <p className="text-xs text-gray-500 mt-0.5">Completing it for one marks it complete for all</p>
              </button>
            </div>
            <button onClick={() => setMultiPrompt(false)} className="w-full mt-3 py-2.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
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
                <label className="block text-xs text-gray-400 mb-1.5">
                  Photos{' '}
                  {completingTask.require_photo
                    ? <span className="text-amber-500 font-semibold">* required</span>
                    : <span className="text-gray-600">(optional — tap to add multiple)</span>
                  }
                </label>
                {photoEntries.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {photoEntries.map((entry, i) => (
                      <div key={i} className="relative">
                        <img src={entry.preview} alt="" className="w-full h-20 object-cover rounded-lg border border-gray-700" />
                        {entry.key === null && (
                          <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                            <p className="text-white text-[9px]">Uploading…</p>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setPhotoEntries(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs border border-gray-600"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-center justify-center w-full h-14 bg-gray-800 border border-dashed border-gray-700 rounded-xl cursor-pointer hover:border-violet-500 transition-colors">
                  <span className="text-sm text-gray-500">{uploading ? 'Uploading…' : '+ Add photos'}</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoChange} disabled={uploading} />
                </label>
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

      {/* ── Delete Recurring Modal ── */}
      {deletingTask && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setDeletingTask(null)}>
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white mb-1">Delete Recurring Task</h2>
            <p className="text-sm text-gray-400 mb-1 truncate">{deletingTask.title}</p>
            <p className="text-xs text-emerald-400 mb-5">
              ↻ {deletingTask.recurrence === 'biweekly' ? 'Every 2 weeks' : deletingTask.recurrence?.charAt(0).toUpperCase() + deletingTask.recurrence!.slice(1)}
            </p>
            <p className="text-sm text-gray-300 mb-5">Do you want to delete just this task, or the entire recurring series?</p>
            <div className="space-y-2">
              <button
                onClick={() => confirmDeleteTask('single')}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
              >
                Delete this task only
              </button>
              <button
                onClick={() => confirmDeleteTask('series')}
                className="w-full bg-red-600 hover:bg-red-500 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
              >
                Delete entire series
              </button>
              <button
                onClick={() => setDeletingTask(null)}
                className="w-full text-gray-500 hover:text-gray-300 text-sm py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reassign Modal ── */}
      {reassigningTask && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setReassigningTask(null)}>
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white mb-1">Reassign Task</h2>
            <p className="text-sm text-gray-500 mb-1 truncate">{reassigningTask.title}</p>
            {reassigningTask.store_address && (
              <p className="text-xs text-blue-400 mb-4">{reassigningTask.store_address}</p>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Assign to</label>
                <select
                  value={reassignToId}
                  onChange={e => setReassignToId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                >
                  <option value="">— Select employee —</option>
                  {assignableUsers.filter(u => u.role === 'employee').map(u => (
                    <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-1.5">This will remove the task from all other assigned employees immediately.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setReassigningTask(null)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={submitReassign}
                  disabled={!reassignToId || reassignSaving}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {reassignSaving ? 'Saving…' : 'Reassign'}
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
  reminding,
  onComplete,
  onUncheck,
  onDelete,
  onLightbox,
  onRemind,
  onReassign,
}: {
  task: Task
  session: Session
  canCreate: boolean
  canComplete: boolean
  unchecking: string | null
  reminding: string | null
  onComplete: () => void
  onUncheck: (id: string) => void
  onDelete: (id: string) => void
  onLightbox: (url: string) => void
  onRemind: (id: string) => void
  onReassign?: () => void
}) {
  const isDone = !!task.completed_at
  const now = new Date()
  const dueDate = task.due_date ? new Date(task.due_date) : null
  const isOverdue = !isDone && !!dueDate && dueDate < now
  const isDueToday = !isDone && !!dueDate && !isOverdue &&
    dueDate.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) ===
    now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

  function fmtDue(d: Date): string {
    const datePart = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })
    const timePart = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
    return `${datePart} before ${timePart}`
  }

  const isStoreTask = !!task.store_id
  const assigneeLabel = isStoreTask ? (task.store_address ?? 'Store') : task.assignee_name

  return (
    <div className={`bg-gray-900 border rounded-2xl overflow-hidden ${isDone ? 'border-green-900/50' : isOverdue ? 'border-red-700' : isDueToday ? 'border-amber-800/60' : 'border-gray-800'}`}>
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
            <Linkified text={task.description} className="text-xs text-gray-500 mt-0.5" />
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border ${isStoreTask ? 'bg-blue-900/40 text-blue-300 border-blue-800/40' : 'bg-violet-900/40 text-violet-300 border-violet-800/40'}`}>
              {!isStoreTask && (task.assignee_avatar_url
                ? <img src={task.assignee_avatar_url} alt={task.assignee_name} className="w-3.5 h-3.5 rounded-full object-cover flex-shrink-0" />
                : <div className="w-3.5 h-3.5 rounded-full bg-violet-700 flex items-center justify-center text-[6px] font-bold text-white flex-shrink-0">{task.assignee_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
              )}
              {isStoreTask ? '🏪 ' : ''}{assigneeLabel}
            </span>
            {task.created_by_name && (
              <span className="text-[10px] text-gray-600">from {task.created_by_name}</span>
            )}
            {task.group_task_id && !isStoreTask && (
              <span className="text-[10px] bg-blue-900/30 text-blue-400 border border-blue-800/40 px-2 py-0.5 rounded-full">
                Group
              </span>
            )}
            {task.recurrence && task.recurrence !== 'none' && (
              <span className="text-[10px] bg-emerald-900/30 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                ↻ {task.recurrence === 'biweekly' ? 'Every 2 wks' : task.recurrence.charAt(0).toUpperCase() + task.recurrence.slice(1)}
              </span>
            )}
            {task.scheduled_send_at && !task.notification_sent_at && !isDone && (
              <span className="text-[10px] bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded-full">
                🕐 Sends {new Date(task.scheduled_send_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            {task.require_photo && !isDone && (
              <span className="text-[10px] bg-amber-900/30 text-amber-400 border border-amber-800/40 px-2 py-0.5 rounded-full">
                📷 Photo required
              </span>
            )}
            {dueDate && !isDone && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                isOverdue
                  ? 'bg-red-900/40 text-red-400 border border-red-800/40'
                  : isDueToday
                  ? 'bg-amber-900/40 text-amber-400 border border-amber-800/40'
                  : 'bg-gray-800 text-gray-400 border border-gray-700'
              }`}>
                {isOverdue ? `⚠ Overdue · ${fmtDue(dueDate)}` : `Due ${fmtDue(dueDate)}`}
              </span>
            )}
          </div>

          {/* Store task — show who it was sent to */}
          {isStoreTask && task.storeAssignees && task.storeAssignees.length > 0 && (
            <p className="text-[10px] text-gray-500 mt-1.5">
              Sent to: {task.storeAssignees.join(', ')}
            </p>
          )}

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
              {(task.photo_urls?.length > 0 || task.photo_url) && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {(task.photo_urls?.length > 0 ? task.photo_urls : [task.photo_url]).filter(Boolean).map((url, i) => (
                    <button key={i} onClick={() => onLightbox(url!)} className="block">
                      <img
                        src={url!}
                        alt="Completion photo"
                        className="h-20 w-24 object-cover rounded-lg border border-gray-700 hover:border-violet-500 transition-colors"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        {canCreate && (
          <div className="flex flex-col gap-1.5 items-center shrink-0 mt-0.5">
            {!isDone && isStoreTask && onReassign && (
              <button
                onClick={onReassign}
                className="text-gray-600 hover:text-blue-400 transition-colors"
                title="Reassign to specific employee"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </button>
            )}
            {!isDone && (
              <button
                onClick={() => onRemind(task.id)}
                disabled={reminding === task.id}
                className="text-gray-600 hover:text-amber-400 disabled:opacity-40 transition-colors"
                title="Send reminder"
              >
                {reminding === task.id
                  ? <span className="text-[10px] text-amber-400">Sent</span>
                  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                }
              </button>
            )}
            <button
              onClick={() => onDelete(task.id)}
              className="text-gray-700 hover:text-red-400 transition-colors text-lg leading-none"
              title="Delete task"
            >×</button>
          </div>
        )}
      </div>
    </div>
  )
}
