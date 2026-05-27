'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Conversation {
  id: string
  name: string | null
  type: string
  created_at: string
  last_message: string | null
  last_message_type: string | null
  last_message_at: string | null
  last_sender_name: string | null
  unread_count: string
  participant_names: string | null
  is_muted: boolean
}

interface Reaction {
  emoji: string
  user_id: string
  user_name: string
}

interface Message {
  id: string
  sender_id: string
  sender_name: string
  body: string
  type: string
  created_at: string
  reactions?: Reaction[]
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🙌', '✅']

interface ChatUser {
  id: string
  full_name: string
  role: string
}

interface GifResult {
  id: string
  previewUrl: string
  url: string
}

function fmtTime(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function fmtMsgTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function initials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const AVATAR_COLORS = [
  'bg-violet-700', 'bg-blue-700', 'bg-emerald-700',
  'bg-rose-700', 'bg-amber-700', 'bg-cyan-700', 'bg-fuchsia-700',
]
function avatarColor(name: string): string {
  let n = 0
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

export default function ChatPage() {
  const router = useRouter()
  const [view, setView] = useState<'list' | 'conversation'>('list')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  // New chat modal
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatType, setNewChatType] = useState<'direct' | 'group'>('direct')
  const [newChatName, setNewChatName] = useState('')
  const [newChatSearch, setNewChatSearch] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([])
  const [creatingChat, setCreatingChat] = useState(false)

  // Photo attachment
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [lightboxTransform, setLightboxTransform] = useState({ scale: 1, tx: 0, ty: 0 })
  const lightboxImgRef = useRef<HTMLImageElement>(null)
  // Refs for pinch gesture state (mutated without re-render for performance)
  const lbScale = useRef(1)
  const lbTx = useRef(0)
  const lbTy = useRef(0)
  const lbStartDist = useRef(0)
  const lbStartScale = useRef(1)
  const lbStartTx = useRef(0)
  const lbStartTy = useRef(0)
  const lbNatural = useRef({ left: 0, top: 0 })
  const lbPinchCenter = useRef({ x: 0, y: 0 })
  const lbDragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  useEffect(() => {
    if (!lightboxUrl || !lightboxImgRef.current) return
    const img = lightboxImgRef.current

    function getDist(t: TouchList) {
      return Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY)
    }
    function applyTransform(s: number, tx: number, ty: number) {
      lbScale.current = s; lbTx.current = tx; lbTy.current = ty
      setLightboxTransform({ scale: s, tx, ty })
    }

    function onStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        lbDragStart.current = null
        const rect = img.getBoundingClientRect()
        // Natural (untransformed) position
        lbNatural.current = { left: rect.left - lbTx.current, top: rect.top - lbTy.current }
        lbStartDist.current = getDist(e.touches)
        lbStartScale.current = lbScale.current
        lbStartTx.current = lbTx.current
        lbStartTy.current = lbTy.current
        lbPinchCenter.current = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        }
      } else if (e.touches.length === 1 && lbScale.current > 1) {
        lbDragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: lbTx.current, ty: lbTy.current }
      }
    }

    function onMove(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault()
        const s1 = lbStartScale.current
        const s2 = Math.min(5, Math.max(1, s1 * getDist(e.touches) / lbStartDist.current))
        const ratio = s2 / s1
        const cx = lbPinchCenter.current.x
        const cy = lbPinchCenter.current.y
        const nl = lbNatural.current
        // Keep pinch focal point fixed: tx2 = (cx - nleft)(1 - ratio) + tx1 * ratio
        const tx2 = (cx - nl.left) * (1 - ratio) + lbStartTx.current * ratio
        const ty2 = (cy - nl.top) * (1 - ratio) + lbStartTy.current * ratio
        applyTransform(s2, tx2, ty2)
      } else if (e.touches.length === 1 && lbDragStart.current) {
        e.preventDefault()
        const dx = e.touches[0].clientX - lbDragStart.current.x
        const dy = e.touches[0].clientY - lbDragStart.current.y
        applyTransform(lbScale.current, lbDragStart.current.tx + dx, lbDragStart.current.ty + dy)
      }
    }

    function onEnd() { lbDragStart.current = null }

    img.addEventListener('touchstart', onStart, { passive: true })
    img.addEventListener('touchmove', onMove, { passive: false })
    img.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      img.removeEventListener('touchstart', onStart)
      img.removeEventListener('touchmove', onMove)
      img.removeEventListener('touchend', onEnd)
    }
  }, [lightboxUrl])

  function closeLightbox() {
    setLightboxUrl(null)
    setLightboxTransform({ scale: 1, tx: 0, ty: 0 })
    lbScale.current = 1; lbTx.current = 0; lbTy.current = 0
  }

  // Reactions
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null)

  // @mentions
  const [convParticipants, setConvParticipants] = useState<{ id: string; full_name: string; username: string }[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)

  // Mute / info sheet
  const [showInfo, setShowInfo] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [mutedBy, setMutedBy] = useState<string[]>([])
  const [togglingMute, setTogglingMute] = useState(false)

  // GIF picker
  const [gifOpen, setGifOpen] = useState(false)
  const [gifSearch, setGifSearch] = useState('')
  const [gifs, setGifs] = useState<GifResult[]>([])
  const [loadingGifs, setLoadingGifs] = useState(false)
  const [gifEnabled, setGifEnabled] = useState(true)

  // Session info
  const [myId, setMyId] = useState('')

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMsgTimeRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Get session
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.id) setMyId(d.id)
    }).catch(() => {})
  }, [])

  const loadConversations = useCallback(() => {
    fetch('/api/chat/conversations')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.conversations) setConversations(d.conversations)
      })
      .catch(() => {})
      .finally(() => setLoadingConvs(false))
  }, [])

  useEffect(() => {
    loadConversations()
    const interval = setInterval(loadConversations, 10000)
    return () => clearInterval(interval)
  }, [loadConversations])

  const loadMessages = useCallback((convId: string, since?: string) => {
    const url = since
      ? `/api/chat/conversations/${convId}/messages?after=${encodeURIComponent(since)}`
      : `/api/chat/conversations/${convId}/messages`
    return fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.messages) return
        if (d.mutedBy !== undefined) setMutedBy(d.mutedBy)
        if ('participants' in d) setConvParticipants(d.participants)
        if (since) {
          if (d.messages.length > 0) {
            setMessages(prev => {
              const existingIds = new Set(prev.map(m => m.id))
              const newMsgs = d.messages.filter((m: Message) => !existingIds.has(m.id))
              return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev
            })
            lastMsgTimeRef.current = d.messages[d.messages.length - 1].created_at
          }
        } else {
          setMessages(d.messages)
          if (d.messages.length > 0) {
            lastMsgTimeRef.current = d.messages[d.messages.length - 1].created_at
          }
        }
      })
      .catch(() => {})
  }, [])

  function openConversation(conv: Conversation) {
    setActiveConv(conv)
    setView('conversation')
    setMessages([])
    setInput('')
    setIsMuted(conv.is_muted ?? false)
    setMutedBy([])
    lastMsgTimeRef.current = null
    setLoadingMsgs(true)
    loadMessages(conv.id).finally(() => setLoadingMsgs(false))
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      if (lastMsgTimeRef.current) {
        loadMessages(conv.id, lastMsgTimeRef.current)
      }
    }, 3000)
    // Update local unread to 0
    setConversations(prev =>
      prev.map(c => c.id === conv.id ? { ...c, unread_count: '0' } : c)
    )
  }

  function closeConversation() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setView('list')
    setActiveConv(null)
    setMessages([])
    setShowInfo(false)
    setMentionQuery(null)
    setConvParticipants([])
    lastMsgTimeRef.current = null
    loadConversations()
  }

  function insertMention(participant: { id: string; full_name: string }) {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const cursorPos = textarea.selectionStart ?? input.length
    const textBefore = input.slice(0, cursorPos)
    const textAfter = input.slice(cursorPos)
    const match = textBefore.match(/@([^@]*)$/)
    if (!match) return
    const mentionStart = cursorPos - match[0].length
    const newText = input.slice(0, mentionStart) + `@${participant.full_name} ` + textAfter
    setInput(newText)
    setMentionQuery(null)
    setTimeout(() => {
      const newCursor = mentionStart + participant.full_name.length + 2
      textarea.focus()
      textarea.setSelectionRange(newCursor, newCursor)
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
    }, 0)
  }

  async function toggleMute() {
    if (!activeConv) return
    setTogglingMute(true)
    const res = await fetch(`/api/chat/conversations/${activeConv.id}/mute`, { method: 'PATCH' })
      .then(r => r.ok ? r.json() : null).catch(() => null)
    if (res !== null) {
      setIsMuted(res.muted)
      setActiveConv(prev => prev ? { ...prev, is_muted: res.muted } : prev)
    }
    setTogglingMute(false)
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])


  async function sendMessage(body: string, type = 'text', optimisticBody?: string) {
    if (!activeConv || !body.trim()) return
    setSending(true)
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      sender_id: myId,
      sender_name: 'You',
      body: optimisticBody ?? body.trim(),
      type,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    // In column-reverse layout scrollTop=0 is the bottom — scroll there when sending
    if (messagesContainerRef.current) messagesContainerRef.current.scrollTop = 0

    await fetch(`/api/chat/conversations/${activeConv.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body.trim(), type }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.message) {
          setMessages(prev => {
            // Replace optimistic, then deduplicate in case poll already added the real message
            const replaced = prev.map(m => m.id === optimistic.id ? d.message : m)
            const seen = new Set<string>()
            return replaced.filter(m => {
              if (seen.has(m.id)) return false
              seen.add(m.id)
              return true
            })
          })
          lastMsgTimeRef.current = d.message.created_at
        }
      })
      .catch(() => {})
      .finally(() => setSending(false))
  }

  async function handleReact(msgId: string, emoji: string) {
    setActiveReactionMsgId(null)
    const res = await fetch('/api/chat/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: msgId, emoji }),
    }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (!res) return
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m
      const existing = m.reactions ?? []
      if (res.action === 'added') {
        return { ...m, reactions: [...existing, { emoji, user_id: myId, user_name: 'You' }] }
      } else {
        return { ...m, reactions: existing.filter(r => !(r.emoji === emoji && r.user_id === myId)) }
      }
    }))
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeConv) return
    e.target.value = ''
    const localUrl = URL.createObjectURL(file)
    setUploadingPhoto(true)
    try {
      const urlRes = await fetch('/api/chat/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type }),
      })
      if (!urlRes.ok) { alert('Failed to prepare upload.'); return }
      const { url, key } = await urlRes.json()
      await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      await sendMessage(key, 'image', localUrl)
    } catch {
      alert('Failed to send photo.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      setMentionQuery(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (mentionQuery !== null && filteredMentions.length > 0) {
        e.preventDefault()
        insertMention(filteredMentions[0])
        return
      }
      e.preventDefault()
      sendMessage(input)
    }
  }

  const EVERYONE_ENTRY = { id: '__everyone__', full_name: 'everyone', username: 'everyone' }

  const filteredMentions = mentionQuery !== null
    ? [
        ...('everyone'.includes(mentionQuery.toLowerCase()) ? [EVERYONE_ENTRY] : []),
        ...convParticipants.filter(p => {
          const q = mentionQuery.toLowerCase()
          return p.full_name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
        }),
      ]
    : []

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setInput(val)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
    const cursorPos = e.target.selectionStart ?? val.length
    const textBefore = val.slice(0, cursorPos)
    const atMatch = textBefore.match(/@([^@]*)$/)
    setMentionQuery(atMatch ? atMatch[1] : null)
  }

  // GIF functions
  function openGifPicker() {
    setGifOpen(true)
    setGifSearch('')
    loadGifs('')
  }

  function loadGifs(q: string) {
    setLoadingGifs(true)
    const url = q.trim() ? `/api/tenor?q=${encodeURIComponent(q.trim())}` : '/api/tenor'
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.results !== undefined) {
          setGifs(d.results)
          if (d.results.length === 0 && !q) setGifEnabled(false)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingGifs(false))
  }

  const gifSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleGifSearch(q: string) {
    setGifSearch(q)
    if (gifSearchTimer.current) clearTimeout(gifSearchTimer.current)
    gifSearchTimer.current = setTimeout(() => loadGifs(q), 400)
  }

  function selectGif(gif: GifResult) {
    setGifOpen(false)
    sendMessage(gif.url, 'gif')
  }

  // New chat functions
  function openNewChat() {
    setNewChatOpen(true)
    setNewChatType('direct')
    setNewChatName('')
    setNewChatSearch('')
    setSelectedUsers([])
    fetch('/api/chat/users')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.users) setChatUsers(d.users) })
      .catch(() => {})
  }

  function toggleUser(id: string) {
    setSelectedUsers(prev =>
      prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]
    )
  }

  async function createChat() {
    if (selectedUsers.length === 0) return
    if (newChatType === 'group' && !newChatName.trim()) return
    setCreatingChat(true)
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: newChatType,
        participantIds: selectedUsers,
        name: newChatType === 'group' ? newChatName.trim() : undefined,
      }),
    }).then(r => r.ok ? r.json() : null).catch(() => null)

    setCreatingChat(false)
    setNewChatOpen(false)

    if (res?.conversation?.id) {
      // Find or create conversation object for opening
      const existing = conversations.find(c => c.id === res.conversation.id)
      if (existing) {
        openConversation(existing)
      } else {
        // Reload conversations and then open
        await fetch('/api/chat/conversations')
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (d?.conversations) {
              setConversations(d.conversations)
              const found = d.conversations.find((c: Conversation) => c.id === res.conversation.id)
              if (found) openConversation(found)
            }
          })
          .catch(() => {})
      }
    }
  }

  const filteredUsers = chatUsers.filter(u =>
    u.full_name.toLowerCase().includes(newChatSearch.toLowerCase())
  )

  const totalUnread = conversations.reduce((sum, c) => sum + parseInt(c.unread_count || '0'), 0)

  // --- CONVERSATION LIST ---
  if (view === 'list') {
    return (
      <div className="h-[100dvh] bg-gray-950 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (window.history.length > 1) router.back()
                else router.push('/dashboard')
              }}
              className="flex items-center gap-1.5 text-violet-400 hover:text-violet-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-sm font-medium">Back</span>
            </button>
          </div>
          <h1 className="text-base font-bold text-white absolute left-1/2 -translate-x-1/2">Messages</h1>
          <div className="flex items-center gap-2">
            {totalUnread > 0 && (
              <span className="text-xs text-violet-400 font-medium">{totalUnread} unread</span>
            )}
            <button
              onClick={openNewChat}
              className="w-9 h-9 bg-violet-600 rounded-xl flex items-center justify-center hover:bg-violet-500 transition-colors"
              aria-label="New message"
            >
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto pb-16">
          {loadingConvs ? (
            <div className="space-y-1 px-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3 animate-pulse">
                  <div className="w-12 h-12 rounded-full bg-gray-800 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-gray-800 rounded w-32" />
                    <div className="h-3 bg-gray-800 rounded w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center px-8">
              <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-white font-semibold text-base">No conversations yet</p>
              <p className="text-gray-500 text-sm mt-1">Tap + to start a message or group chat</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-900">
              {conversations.map(conv => {
                const name = conv.type === 'group' && conv.name
                  ? conv.name
                  : conv.participant_names ?? 'Unknown'
                const unread = parseInt(conv.unread_count || '0')
                const lastMsg = conv.last_message_type === 'gif'
                  ? '📎 GIF'
                  : conv.last_message_type === 'image'
                  ? '📷 Photo'
                  : conv.last_message
                const isGroup = conv.type === 'group'

                return (
                  <button
                    key={conv.id}
                    onClick={() => openConversation(conv)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-900 transition-colors text-left"
                  >
                    {/* Avatar */}
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${isGroup ? 'bg-violet-800' : avatarColor(name)}`}>
                      {isGroup ? (
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      ) : (
                        <span className="text-white text-sm font-bold">{initials(name)}</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm font-semibold truncate ${unread > 0 ? 'text-white' : 'text-gray-200'}`}>
                          {name}
                        </p>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {conv.is_muted && (
                            <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                            </svg>
                          )}
                          {conv.last_message_at && (
                            <span className="text-[10px] text-gray-500">{fmtTime(conv.last_message_at)}</span>
                          )}
                          {unread > 0 && (
                            <span className="w-5 h-5 bg-violet-600 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                              {unread > 9 ? '9+' : unread}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className={`text-xs mt-0.5 truncate ${unread > 0 ? 'text-gray-300 font-medium' : 'text-gray-500'}`}>
                        {lastMsg
                          ? conv.last_sender_name
                            ? `${conv.last_sender_name}: ${lastMsg}`
                            : lastMsg
                          : 'No messages yet'}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* New Chat Modal */}
        {newChatOpen && (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setNewChatOpen(false)}
          >
            <div
              className="bg-gray-900 rounded-t-2xl max-h-[85vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-gray-700" />
              </div>

              <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                <p className="text-white font-bold text-base">New Message</p>
                <button onClick={() => setNewChatOpen(false)} className="text-gray-500 hover:text-gray-300">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Type toggle */}
              <div className="px-5 pt-4 pb-3">
                <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
                  <button
                    onClick={() => { setNewChatType('direct'); setSelectedUsers(prev => prev.slice(0, 1)) }}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${newChatType === 'direct' ? 'bg-violet-600 text-white' : 'text-gray-400'}`}
                  >
                    Direct Message
                  </button>
                  <button
                    onClick={() => setNewChatType('group')}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${newChatType === 'group' ? 'bg-violet-600 text-white' : 'text-gray-400'}`}
                  >
                    Group Chat
                  </button>
                </div>

                {newChatType === 'group' && (
                  <input
                    value={newChatName}
                    onChange={e => setNewChatName(e.target.value)}
                    placeholder="Group name"
                    className="mt-3 w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                  />
                )}

                <input
                  value={newChatSearch}
                  onChange={e => setNewChatSearch(e.target.value)}
                  placeholder="Search people…"
                  className="mt-3 w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                />

                {selectedUsers.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedUsers.map(uid => {
                      const u = chatUsers.find(u => u.id === uid)
                      return u ? (
                        <span key={uid} className="flex items-center gap-1 bg-violet-900/60 text-violet-300 text-xs px-2.5 py-1 rounded-full">
                          {u.full_name}
                          <button onClick={() => toggleUser(uid)} className="ml-0.5 text-violet-400 hover:text-white">×</button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}
              </div>

              {/* User list */}
              <div className="overflow-y-auto flex-1 divide-y divide-gray-800/60 px-2">
                {filteredUsers.map(u => {
                  const selected = selectedUsers.includes(u.id)
                  return (
                    <button
                      key={u.id}
                      onClick={() => {
                        if (newChatType === 'direct') {
                          setSelectedUsers([u.id])
                        } else {
                          toggleUser(u.id)
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${selected ? 'bg-violet-900/30' : 'hover:bg-gray-800'}`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${avatarColor(u.full_name)}`}>
                        <span className="text-white text-xs font-bold">{initials(u.full_name)}</span>
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium text-white truncate">{u.full_name}</p>
                        <p className="text-xs text-gray-500">{roleLabel(u.role)}</p>
                      </div>
                      {selected && (
                        <div className="w-5 h-5 bg-violet-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Create button */}
              <div className="px-5 py-4 border-t border-gray-800">
                <button
                  onClick={createChat}
                  disabled={
                    creatingChat ||
                    selectedUsers.length === 0 ||
                    (newChatType === 'group' && !newChatName.trim())
                  }
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
                >
                  {creatingChat ? 'Opening…' : newChatType === 'direct' ? 'Open Chat' : 'Create Group'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- CONVERSATION VIEW ---
  const convName = activeConv
    ? (activeConv.type === 'group' && activeConv.name
        ? activeConv.name
        : activeConv.participant_names ?? 'Chat')
    : 'Chat'

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {/* Conversation header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950">
        <button
          onClick={closeConversation}
          className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-800 transition-colors flex-shrink-0"
        >
          <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${activeConv?.type === 'group' ? 'bg-violet-800' : avatarColor(convName)}`}>
          {activeConv?.type === 'group' ? (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          ) : (
            <span className="text-white text-xs font-bold">{initials(convName)}</span>
          )}
        </div>
        <button
          className="flex-1 min-w-0 text-left"
          onClick={() => setShowInfo(true)}
        >
          <p className="text-sm font-bold text-white truncate">{convName}</p>
          {activeConv?.type === 'group' && activeConv.participant_names && (
            <p className="text-[10px] text-gray-500 truncate">{activeConv.participant_names}</p>
          )}
        </button>
        {isMuted && (
          <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        )}
      </div>

      {/* Messages */}
      {/* flex-col-reverse makes scrollTop=0 the natural bottom — no JS scroll needed */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto flex flex-col-reverse">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
            {loadingMsgs ? (
              <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <p className="text-gray-600 text-sm">No messages yet</p>
                <p className="text-gray-700 text-xs mt-1">Say hello!</p>
              </>
            )}
          </div>
        ) : (
          <div className="px-4 py-3 space-y-1">
            {messages.map((msg, i) => {
              const isMe = msg.sender_id === myId
              const prevMsg = messages[i - 1]
              const showSender = !isMe &&
                activeConv?.type === 'group' &&
                prevMsg?.sender_id !== msg.sender_id

              const showTime = !prevMsg ||
                new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 5 * 60 * 1000

              return (
                <div key={msg.id}>
                  {showTime && (
                    <div className="flex justify-center my-3">
                      <span className="text-[10px] text-gray-600 bg-gray-900 px-3 py-1 rounded-full">
                        {fmtMsgTime(msg.created_at)}
                      </span>
                    </div>
                  )}
                  {showSender && (
                    <p className="text-[10px] text-gray-500 ml-12 mb-0.5 mt-2">{msg.sender_name}</p>
                  )}
                  <div className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar — only for others, only on last message in group */}
                    {!isMe && (
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 self-end ${avatarColor(msg.sender_name)}`}>
                        <span className="text-white text-[10px] font-bold">{initials(msg.sender_name)}</span>
                      </div>
                    )}
                    {/* Bubble */}
                    <div className={`max-w-[72%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                      {msg.type === 'gif' ? (
                        <button
                          className={`rounded-2xl overflow-hidden ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
                          onClick={() => setActiveReactionMsgId(prev => prev === msg.id ? null : msg.id)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={msg.body}
                            alt="GIF"
                            className="max-w-[200px] max-h-[200px] object-contain"
                            loading="lazy"
                          />
                        </button>
                      ) : msg.type === 'image' ? (
                        <div className="flex flex-col">
                          <button
                            className={`rounded-2xl overflow-hidden ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
                            onClick={() => setLightboxUrl(msg.body)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={msg.body}
                              alt="Photo"
                              className="max-w-[240px] max-h-[320px] object-cover"
                              loading="lazy"
                            />
                          </button>
                          <button
                            onClick={() => setActiveReactionMsgId(prev => prev === msg.id ? null : msg.id)}
                            className={`text-[10px] text-gray-600 mt-0.5 ${isMe ? 'text-right' : 'text-left'}`}
                          >
                            React
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setActiveReactionMsgId(prev => prev === msg.id ? null : msg.id)}
                          className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words text-left ${
                            isMe
                              ? 'bg-violet-600 text-white rounded-br-sm'
                              : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                          }`}
                        >
                          {msg.body.split(/(@[A-Za-z][^@\n]*?)(?=\s|$)/g).map((part, i) =>
                            part.startsWith('@') ? (
                              <span key={i} className={isMe ? 'font-bold text-violet-200' : 'font-bold text-violet-400'}>{part}</span>
                            ) : part
                          )}
                        </button>
                      )}
                      {/* Reaction pills */}
                      {(msg.reactions ?? []).length > 0 && (() => {
                        const grouped = REACTION_EMOJIS
                          .map(e => ({
                            emoji: e,
                            count: (msg.reactions ?? []).filter(r => r.emoji === e).length,
                            reactedByMe: (msg.reactions ?? []).some(r => r.emoji === e && r.user_id === myId),
                          }))
                          .filter(g => g.count > 0)
                        return (
                          <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            {grouped.map(({ emoji, count, reactedByMe }) => (
                              <button
                                key={emoji}
                                onClick={() => handleReact(msg.id, emoji)}
                                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                  reactedByMe
                                    ? 'bg-violet-900/40 border-violet-500 text-violet-300'
                                    : 'bg-gray-800 border-gray-700 text-gray-300'
                                }`}
                              >
                                <span>{emoji}</span>
                                {count > 1 && <span className="text-[10px]">{count}</span>}
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                    {isMe && <div className="w-7 flex-shrink-0" />}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* @mention dropdown */}
      {mentionQuery !== null && filteredMentions.length > 0 && (
        <div className="border-t border-gray-800 bg-gray-900 max-h-40 overflow-y-auto">
          {filteredMentions.map(p => {
            const isEveryone = p.id === '__everyone__'
            return (
              <button
                key={p.id}
                onMouseDown={e => { e.preventDefault(); insertMention(p) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors text-left"
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-white ${isEveryone ? 'bg-violet-700' : avatarColor(p.full_name)}`}>
                  {isEveryone ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  ) : initials(p.full_name)}
                </div>
                <div className="min-w-0">
                  {isEveryone
                    ? <>
                        <p className="text-sm text-white">@everyone</p>
                        <p className="text-[10px] text-violet-400">Notify all participants</p>
                      </>
                    : <p className="text-sm text-white">{p.full_name}</p>
                  }
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Muted-by bar — group chats, manager+ only */}
      {mutedBy.length > 0 && (
        <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
          <p className="text-[11px] text-gray-500">
            Notifications off for: <span className="text-gray-400">{mutedBy.join(', ')}</span>
          </p>
        </div>
      )}

      {/* Input area */}
      <div className="px-3 py-3 border-t border-gray-800 bg-gray-950 flex items-end gap-2">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoSelect}
        />
        <button
          onClick={() => photoInputRef.current?.click()}
          disabled={uploadingPhoto || sending}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-colors flex-shrink-0 mb-px"
          aria-label="Send photo"
        >
          {uploadingPhoto ? (
            <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}
        </button>
        {gifEnabled && (
          <button
            onClick={openGifPicker}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors flex-shrink-0 mb-px"
            aria-label="Send GIF"
          >
            <span className="text-xs font-black text-gray-400">GIF</span>
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={autoResize}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          rows={1}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-2xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 resize-none leading-5"
          style={{ minHeight: 40, maxHeight: 120 }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || sending || uploadingPhoto}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 mb-px"
          aria-label="Send"
        >
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>

      {/* Reaction dismiss overlay */}
      {activeReactionMsgId && (
        <div className="fixed inset-0 z-30" onClick={() => setActiveReactionMsgId(null)} />
      )}

      {/* Reaction picker bar */}
      {activeReactionMsgId && (
        <div className="fixed bottom-20 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl px-4 py-2.5 flex gap-3 shadow-2xl pointer-events-auto">
            {REACTION_EMOJIS.map(emoji => {
              const activeMsg = messages.find(m => m.id === activeReactionMsgId)
              const reactedByMe = (activeMsg?.reactions ?? []).some(r => r.emoji === emoji && r.user_id === myId)
              return (
                <button
                  key={emoji}
                  onClick={() => handleReact(activeReactionMsgId, emoji)}
                  className={`text-2xl transition-transform active:scale-110 ${reactedByMe ? 'scale-110' : 'opacity-80 hover:opacity-100 hover:scale-110'}`}
                >
                  {emoji}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={closeLightbox}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={lightboxImgRef}
            src={lightboxUrl}
            alt="Photo"
            className="max-w-full max-h-full object-contain"
            style={{
              transform: `translate(${lightboxTransform.tx}px, ${lightboxTransform.ty}px) scale(${lightboxTransform.scale})`,
              transformOrigin: '0 0',
              transition: lightboxTransform.scale === 1 ? 'transform 0.2s' : 'none',
            }}
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-6 right-4 text-white/60 hover:text-white"
            onClick={closeLightbox}
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Info / Mute Sheet */}
      {showInfo && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowInfo(false)}
        >
          <div
            className="bg-gray-900 rounded-t-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <p className="text-white font-bold text-base truncate">{convName}</p>
              <button onClick={() => setShowInfo(false)} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4">
              <button
                onClick={toggleMute}
                disabled={togglingMute}
                className="w-full flex items-center justify-between bg-gray-800 hover:bg-gray-750 rounded-2xl px-4 py-3.5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    {isMuted ? (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </>
                    ) : (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </>
                    )}
                  </svg>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-white">
                      {isMuted ? 'Notifications Off' : 'Notifications On'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {isMuted ? 'Tap to turn notifications back on' : 'Tap to turn off notifications'}
                    </p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 ${isMuted ? 'bg-gray-600' : 'bg-violet-600'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full mt-0.5 transition-transform ${isMuted ? 'translate-x-0.5' : 'translate-x-5'}`} />
                </div>
              </button>
            </div>
            <div className="h-6" />
          </div>
        </div>
      )}

      {/* GIF Picker */}
      {gifOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setGifOpen(false)}
        >
          <div
            className="bg-gray-900 rounded-t-2xl flex flex-col"
            style={{ height: '60vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
              <input
                value={gifSearch}
                onChange={e => handleGifSearch(e.target.value)}
                placeholder="Search GIFs…"
                autoFocus
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
              />
              <button onClick={() => setGifOpen(false)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {loadingGifs ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : gifs.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-sm">
                    {gifSearch ? 'No GIFs found' : 'GIFs unavailable'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {gifs.map(gif => (
                    <button
                      key={gif.id}
                      onClick={() => selectGif(gif)}
                      className="aspect-square rounded-xl overflow-hidden bg-gray-800 hover:ring-2 hover:ring-violet-500 transition-all"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={gif.previewUrl || gif.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-center text-[10px] text-gray-700 pb-3">Powered by Tenor</p>
          </div>
        </div>
      )}
    </div>
  )
}
