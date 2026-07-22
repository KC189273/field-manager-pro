'use client'

import { useState, useEffect, useRef } from 'react'
import NavBar from '@/components/NavBar'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  body: string
  created_at: string
}

interface Session {
  id: string; fullName: string; role: string
}

export default function HelpPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [status, setStatus] = useState<'active' | 'resolved' | 'escalated' | 'new'>('new')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (d) setSession(d)
    })
  }, [])

  // Load existing conversation
  useEffect(() => {
    if (!session) return
    fetch('/api/support/chat').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.conversation) {
        setConversationId(d.conversation.id)
        setStatus(d.conversation.status)
        setMessages(d.messages.filter((m: Message) => m.role !== 'system'))
      }
    })
  }, [session])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || sending) return
    const userMsg = input.trim()
    setInput('')
    setSending(true)

    // Optimistically add user message
    const tempId = crypto.randomUUID()
    setMessages(prev => [...prev, { id: tempId, role: 'user', body: userMsg, created_at: new Date().toISOString() }])

    try {
      const res = await fetch('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, conversationId }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Something went wrong' }))
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', body: err.error || 'Something went wrong. Please try again.', created_at: new Date().toISOString() }])
        setSending(false)
        return
      }

      const data = await res.json()
      if (data.conversationId) setConversationId(data.conversationId)

      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', body: data.reply, created_at: new Date().toISOString() }])

      if (data.escalated) setStatus('escalated')
      else if (data.resolved) setStatus('resolved')
    } catch {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', body: 'Connection error. Please try again.', created_at: new Date().toISOString() }])
    } finally {
      setSending(false)
    }
  }

  function startNewConversation() {
    setConversationId(null)
    setMessages([])
    setStatus('new')
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  return (
    <div className="fixed inset-0 bg-gray-950 flex flex-col pt-14">
      <NavBar role={session.role as 'employee'} fullName={session.fullName} />

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Help & Support</h1>
          <p className="text-xs text-gray-500">Ask anything about Field Manager Pro</p>
        </div>
        {(status === 'resolved' || status === 'escalated') && (
          <button onClick={startNewConversation} className="text-xs bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
            New Question
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-full bg-violet-900/40 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm font-medium">How can I help?</p>
            <p className="text-gray-600 text-xs mt-1 max-w-xs">Ask about timecards, scheduling, clock-in issues, or anything else in the app.</p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
              msg.role === 'user'
                ? 'bg-violet-600 text-white rounded-br-sm'
                : 'bg-gray-800 text-gray-200 rounded-bl-sm'
            }`}>
              <p className="whitespace-pre-wrap">{msg.body}</p>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {status === 'escalated' && (
          <div className="bg-amber-900/20 border border-amber-800/40 rounded-xl px-4 py-3 text-center">
            <p className="text-amber-300 text-sm font-medium">Escalated to Shaun</p>
            <p className="text-amber-400/70 text-xs mt-1">He has the full conversation and will follow up with you directly.</p>
          </div>
        )}

        {status === 'resolved' && (
          <div className="bg-green-900/20 border border-green-800/40 rounded-xl px-4 py-3 text-center">
            <p className="text-green-300 text-sm font-medium">Issue resolved</p>
            <p className="text-green-400/70 text-xs mt-1">Glad we could help! Tap "New Question" if you need anything else.</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {status === 'active' || status === 'new' ? (
        <div className="px-4 py-3 border-t border-gray-800 bg-gray-950">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Describe your issue..."
              rows={1}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 resize-none max-h-24"
              style={{ minHeight: 40 }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 flex items-center justify-center flex-shrink-0 transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
