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
  const [chatOpen, setChatOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (d) setSession(d)
    })
  }, [])

  useEffect(() => {
    if (!session) return
    fetch('/api/support/chat').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.conversation) {
        setConversationId(d.conversation.id)
        setStatus(d.conversation.status)
        setMessages(d.messages.filter((m: Message) => m.role !== 'system'))
        if (d.conversation.status === 'active') setChatOpen(true)
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

    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', body: userMsg, created_at: new Date().toISOString() }])

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

  function openChat() {
    setChatOpen(true)
    if (status === 'resolved' || status === 'escalated') startNewConversation()
  }

  function quickAsk(question: string) {
    openChat()
    setInput(question)
    // Auto-send after a tick so the chat is open
    setTimeout(() => {
      setInput('')
      setSending(true)
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', body: question, created_at: new Date().toISOString() }])
      fetch('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, conversationId }),
      }).then(r => r.json()).then(data => {
        if (data.conversationId) setConversationId(data.conversationId)
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', body: data.reply, created_at: new Date().toISOString() }])
        if (data.escalated) setStatus('escalated')
        else if (data.resolved) setStatus('resolved')
      }).catch(() => {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', body: 'Connection error.', created_at: new Date().toISOString() }])
      }).finally(() => setSending(false))
    }, 200)
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role as 'employee'} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Help & Support</h1>
        <p className="text-sm text-gray-400 mb-6">Get instant help from our AI Assistant or browse common topics.</p>

        {/* Quick help cards */}
        <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">Common Questions</p>
        <div className="space-y-2 mb-6">
          {[
            { q: "I can't clock in", icon: '⏰' },
            { q: "I can't see my schedule", icon: '📅' },
            { q: 'How do I edit a timecard?', icon: '📋' },
            { q: "Why can't I see a floater's timecard?", icon: '👥' },
            { q: 'How do I request time off?', icon: '🏖️' },
            { q: 'How do I submit a checklist?', icon: '✅' },
          ].map(item => (
            <button
              key={item.q}
              onClick={() => quickAsk(item.q)}
              className="w-full flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:bg-gray-800/80 transition-colors text-left"
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-sm text-gray-300 flex-1">{item.q}</span>
              <svg className="w-4 h-4 text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

      </div>

      {/* Floating AI Assistant button */}
      {!chatOpen && (
        <button
          onClick={openChat}
          className="fixed bottom-24 right-4 z-40 bg-violet-600 hover:bg-violet-500 text-white rounded-full shadow-lg shadow-violet-900/50 pl-4 pr-5 py-3 flex items-center gap-2 transition-all active:scale-95"
        >
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
            </svg>
          </div>
          <span className="text-sm font-semibold">AI Assistant</span>
        </button>
      )}

      {/* Chat popup — slides up from bottom */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setChatOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-gray-900 rounded-t-2xl flex flex-col"
            style={{ height: '80vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>

            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-violet-600 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white">AI Assistant</p>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <p className="text-[10px] text-gray-500">Online</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(status === 'resolved' || status === 'escalated') && (
                  <button onClick={startNewConversation} className="text-[10px] bg-violet-600 hover:bg-violet-500 text-white px-2.5 py-1 rounded-lg font-semibold">
                    New Question
                  </button>
                )}
                <button onClick={() => setChatOpen(false)} className="w-8 h-8 rounded-full hover:bg-gray-800 flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {/* Welcome message */}
              {messages.length === 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-gray-200">
                    <p className="font-medium mb-1">Hey{session?.fullName ? ` ${session.fullName.split(' ')[0]}` : ''}!</p>
                    <p>I'm the FMP AI Assistant. Tell me what's going on and I'll help you figure it out step by step. If I can't solve it, I'll connect you with the dev team.</p>
                  </div>
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
                  <p className="text-amber-300 text-sm font-medium">Escalated to the dev team</p>
                  <p className="text-amber-400/70 text-xs mt-1">They have the full conversation and all the steps you tried. They'll follow up with you directly.</p>
                </div>
              )}

              {status === 'resolved' && (
                <div className="bg-green-900/20 border border-green-800/40 rounded-xl px-4 py-3 text-center">
                  <p className="text-green-300 text-sm font-medium">Glad that worked!</p>
                  <p className="text-green-400/70 text-xs mt-1">Tap "New Question" if you need anything else.</p>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {(status === 'active' || status === 'new') && (
              <div className="px-4 py-3 border-t border-gray-800">
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder="Type your question..."
                    rows={1}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 resize-none max-h-24"
                    style={{ minHeight: 40 }}
                    autoFocus
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}
