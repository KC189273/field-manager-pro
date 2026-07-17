'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function QrCode({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    import('qrcode').then(QRCode => {
      QRCode.toDataURL(url, { width: 200, margin: 0, color: { dark: '#000000', light: '#ffffff' } })
        .then((dataUrl: string) => setSrc(dataUrl))
        .catch(() => {})
    })
  }, [url])
  if (!src) return <div className="w-[200px] h-[200px] bg-zinc-200 rounded animate-pulse" />
  return <img src={src} alt="QR Code" width={200} height={200} />
}

interface BarberProfile {
  id: string; display_name: string; is_listed: boolean
}

interface Service {
  id: string; name: string; price: string; duration_minutes: number; is_active: boolean
}

interface Availability {
  day_of_week: number; start_time: string; end_time: string; is_available: boolean; block_index: number
}

export default function ShopSetupPage() {
  const router = useRouter()
  const [session, setSession] = useState<{ id: string; fullName: string; role: string; org_id: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // Shop settings
  const [shopName, setShopName] = useState('')
  const [shopCode, setShopCode] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [isListedAsBarber, setIsListedAsBarber] = useState(true)

  // Barber profile (for shop owner acting as barber)
  const [barberProfile, setBarberProfile] = useState<BarberProfile | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])
  const [venmo, setVenmo] = useState('')
  const [cashapp, setCashapp] = useState('')
  const [defaultDuration, setDefaultDuration] = useState(45)
  const [cleanupMinutes, setCleanupMinutes] = useState(15)

  // New service form
  const [newServiceName, setNewServiceName] = useState('')
  const [newServicePrice, setNewServicePrice] = useState('')
  const [newServiceDuration, setNewServiceDuration] = useState('45')

  // Weekly hours
  const [selectedWeek, setSelectedWeek] = useState<string>(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = day === 0 ? 6 : day - 1
    d.setDate(d.getDate() - diff)
    return d.toISOString().split('T')[0]
  })
  const [usingDefault, setUsingDefault] = useState(false)
  const [customWeeks, setCustomWeeks] = useState<string[]>([])
  const [cloning, setCloning] = useState(false)

  // Photos
  const [barberAvatarUrl, setBarberAvatarUrl] = useState<string | null>(null)
  const [portfolio, setPortfolio] = useState<Array<{ id: string; url: string | null; caption: string | null }>>([])
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingPortfolio, setUploadingPortfolio] = useState(false)
  const [photoCaption, setPhotoCaption] = useState('')

  const [tab, setTab] = useState<'shop' | 'services' | 'hours' | 'payment' | 'photos'>('shop')

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d) return
      if (d.role !== 'shop_owner' && d.role !== 'barber' && d.role !== 'developer') { router.replace('/dashboard'); return }
      setSession(d)
    })
  }, [router])

  const loadShop = useCallback(async () => {
    const res = await fetch('/api/barbershop/shop')
    if (res.ok) {
      const d = await res.json()
      if (d.shop) {
        setShopName(d.shop.shop_name)
        setShopCode(d.shop.shop_code)
        setAddress(d.shop.address ?? '')
        setPhone(d.shop.phone ?? '')
      }
    }
  }, [])

  const loadBarberProfile = useCallback(async () => {
    if (!session) return
    const res = await fetch(`/api/barbershop/barbers?orgId=${session.org_id}`)
    if (res.ok) {
      const d = await res.json()
      const mine = (d.barbers ?? []).find((b: BarberProfile & { user_id: string }) => b.user_id === session.id)
      if (mine) {
        setBarberProfile(mine)
        setIsListedAsBarber(mine.is_listed)
        setVenmo((mine as Record<string, string>).venmo_username ?? '')
        setCashapp((mine as Record<string, string>).cashapp_tag ?? '')
        setDefaultDuration((mine as Record<string, number>).default_duration ?? 45)
        setCleanupMinutes((mine as Record<string, number>).cleanup_minutes ?? 15)
        // Load services
        const svcRes = await fetch(`/api/barbershop/services?barberId=${mine.id}`)
        if (svcRes.ok) {
          const sd = await svcRes.json()
          setServices(sd.services ?? [])
        }
        // Load photos
        const photoRes = await fetch(`/api/barbershop/photos?barberId=${mine.id}&action=list`)
        if (photoRes.ok) {
          const pd = await photoRes.json()
          setBarberAvatarUrl(pd.avatarUrl ?? null)
          setPortfolio(pd.photos ?? [])
        }
        // Load availability for selected week
        const avRes = await fetch(`/api/barbershop/availability?barberId=${mine.id}&weekStart=${selectedWeek}`)
        if (avRes.ok) {
          const ad = await avRes.json()
          // Ensure block_index is present
          const avail = (ad.availability ?? []).map((a: Availability, i: number) => ({ ...a, block_index: a.block_index ?? i }))
          setAvailability(avail)
          setUsingDefault(ad.usingDefault ?? false)
          setCustomWeeks(ad.customWeeks ?? [])
        }
      }
    }
  }, [session, selectedWeek])

  useEffect(() => { if (session) { loadShop(); loadBarberProfile() } }, [session, loadShop, loadBarberProfile])

  async function saveShop() {
    setSaving(true)
    await fetch('/api/barbershop/shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_name: shopName, shop_code: shopCode, address, phone, is_listed_as_barber: isListedAsBarber }),
    })
    await loadShop()
    await loadBarberProfile()
    setSaving(false)
  }

  async function addService() {
    if (!newServiceName.trim() || !barberProfile) return
    await fetch('/api/barbershop/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barberId: barberProfile.id, name: newServiceName, price: Number(newServicePrice) || 0, duration_minutes: Number(newServiceDuration) || 45 }),
    })
    setNewServiceName(''); setNewServicePrice(''); setNewServiceDuration('45')
    await loadBarberProfile()
  }

  async function deleteService(serviceId: string) {
    if (!barberProfile) return
    await fetch('/api/barbershop/services', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: serviceId, barberId: barberProfile.id }),
    })
    await loadBarberProfile()
  }

  async function saveAvailability() {
    if (!barberProfile) return
    setSaving(true)
    // Save duration/cleanup to barber profile
    await fetch('/api/barbershop/shop', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barberId: barberProfile.id, default_duration: defaultDuration, cleanup_minutes: cleanupMinutes }),
    })
    // Save weekly hours
    await fetch('/api/barbershop/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barberId: barberProfile.id, availability, weekStart: selectedWeek }),
    })
    setUsingDefault(false)
    if (!customWeeks.includes(selectedWeek)) setCustomWeeks(prev => [selectedWeek, ...prev])
    setSaving(false)
  }

  async function clonePreviousWeek() {
    if (!barberProfile) return
    const prevWeek = new Date(selectedWeek + 'T12:00:00')
    prevWeek.setDate(prevWeek.getDate() - 7)
    const prevWeekStr = prevWeek.toISOString().split('T')[0]
    setCloning(true)
    await fetch('/api/barbershop/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barberId: barberProfile.id, availability: [], weekStart: selectedWeek, cloneFrom: prevWeekStr }),
    })
    await loadBarberProfile()
    setCloning(false)
  }

  async function savePayment() {
    if (!barberProfile) return
    setSaving(true)
    await fetch('/api/barbershop/shop', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barberId: barberProfile.id, venmo_username: venmo, cashapp_tag: cashapp }),
    })
    setSaving(false)
  }

  async function uploadAvatar(file: File) {
    if (!barberProfile) return
    setUploadingAvatar(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const res = await fetch(`/api/barbershop/photos?barberId=${barberProfile.id}&action=upload-avatar&ext=${ext}`)
      const { uploadUrl, key } = await res.json()
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      await fetch('/api/barbershop/photos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barberId: barberProfile.id, action: 'save-avatar', key }),
      })
      await loadBarberProfile()
    } catch { /* */ }
    setUploadingAvatar(false)
  }

  async function uploadPortfolioPhoto(file: File) {
    if (!barberProfile) return
    setUploadingPortfolio(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const res = await fetch(`/api/barbershop/photos?barberId=${barberProfile.id}&action=upload-portfolio&ext=${ext}`)
      const { uploadUrl, key } = await res.json()
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      await fetch('/api/barbershop/photos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barberId: barberProfile.id, action: 'add-portfolio', key, caption: photoCaption }),
      })
      setPhotoCaption('')
      await loadBarberProfile()
    } catch { /* */ }
    setUploadingPortfolio(false)
  }

  async function deletePortfolioPhoto(photoId: string) {
    if (!barberProfile) return
    await fetch('/api/barbershop/photos', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId, barberId: barberProfile.id }),
    })
    setPortfolio(prev => prev.filter(p => p.id !== photoId))
  }

  if (!session) return null

  const inputCls = 'w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  const labelCls = 'block text-xs text-zinc-400 mb-1 uppercase tracking-wide'

  return (
    <div className="min-h-screen bg-black pb-20 pt-14">
      <NavBar role={session.role as 'shop_owner'} fullName={session.fullName} />

      <div className="max-w-xl mx-auto px-4 py-4">
        <h1 className="text-xl font-bold text-blue-400 mb-4">Shop Setup</h1>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 mb-4 overflow-x-auto">
          {[
            { id: 'shop' as const, label: 'Shop Info' },
            { id: 'services' as const, label: 'Services' },
            { id: 'hours' as const, label: 'Hours' },
            { id: 'payment' as const, label: 'Payment' },
            { id: 'photos' as const, label: 'Photos' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}>{t.label}</button>
          ))}
        </div>

        {/* Shop Info */}
        {tab === 'shop' && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Shop Name *</label>
              <input value={shopName} onChange={e => setShopName(e.target.value)} className={inputCls} placeholder="Your shop name" />
            </div>
            <div>
              <label className={labelCls}>4-Letter Shop Code *</label>
              <input value={shopCode} onChange={e => setShopCode(e.target.value.toUpperCase().slice(0, 4))} maxLength={4}
                className={inputCls + ' text-center text-lg tracking-[0.3em] font-mono'} placeholder="ABCD" />
              <p className="text-xs text-zinc-600 mt-1">Customers will enter this code to find your shop</p>
            </div>
            <div>
              <label className={labelCls}>Address</label>
              <input value={address} onChange={e => setAddress(e.target.value)} className={inputCls} placeholder="123 Main St, City, State" />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="(555) 000-0000" />
            </div>
            <div>
              <label className={labelCls}>List Yourself as a Barber</label>
              <button onClick={() => setIsListedAsBarber(!isListedAsBarber)}
                className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border transition-colors ${
                  isListedAsBarber ? 'bg-blue-600/15 border-blue-500' : 'bg-zinc-900 border-zinc-700'
                }`}>
                <div className={`w-10 h-5 rounded-full relative shrink-0 transition-colors ${isListedAsBarber ? 'bg-blue-500' : 'bg-zinc-600'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all`} style={{ left: isListedAsBarber ? '22px' : '2px' }} />
                </div>
                <span className={`text-sm font-medium ${isListedAsBarber ? 'text-blue-400' : 'text-zinc-400'}`}>
                  {isListedAsBarber ? 'Customers can book with you' : 'Not listed as a barber'}
                </span>
              </button>
            </div>
            <button onClick={saveShop} disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm">
              {saving ? 'Saving...' : 'Save Shop Settings'}
            </button>

            {/* QR Code */}
            {shopCode.length === 4 && (
              <div className="bg-zinc-900 border border-blue-500/20 rounded-2xl p-5 text-center">
                <p className="text-xs text-blue-400 uppercase tracking-wide font-semibold mb-3">Customer QR Code</p>
                <div className="bg-white rounded-xl p-4 inline-block mb-3">
                  <QrCode url={`https://fieldmanagerpro.app/download?code=${shopCode}`} />
                </div>
                <p className="text-xs text-zinc-500 mb-1">Customers scan this to download the app and sign up with your shop code <span className="text-blue-400 font-mono font-bold">{shopCode}</span> pre-filled.</p>
                <p className="text-xs text-zinc-600">Print this and display it at your station or front counter.</p>
              </div>
            )}
          </div>
        )}

        {/* Services */}
        {tab === 'services' && (
          <div className="space-y-4">
            {!barberProfile ? (
              <p className="text-sm text-zinc-500 text-center py-8">Enable &quot;List Yourself as a Barber&quot; in Shop Info first</p>
            ) : (
              <>
                {services.map(svc => (
                  <div key={svc.id} className="bg-zinc-900 border border-blue-500/15 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white font-medium">{svc.name}</p>
                      <p className="text-xs text-zinc-500">${Number(svc.price).toFixed(2)} · {svc.duration_minutes} min</p>
                    </div>
                    <button onClick={() => deleteService(svc.id)} className="text-red-400 hover:text-red-300 text-xs font-semibold">Remove</button>
                  </div>
                ))}

                <div className="bg-zinc-900 border border-dashed border-blue-500/30 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide">Add Service</p>
                  <input value={newServiceName} onChange={e => setNewServiceName(e.target.value)} placeholder="Service name (e.g. Beard Trim)" className={inputCls} />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Price ($)</label>
                      <input type="number" value={newServicePrice} onChange={e => setNewServicePrice(e.target.value)} placeholder="25.00" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Duration (min)</label>
                      <input type="number" value={newServiceDuration} onChange={e => setNewServiceDuration(e.target.value)} placeholder="45" className={inputCls} />
                    </div>
                  </div>
                  <button onClick={addService} disabled={!newServiceName.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">
                    Add Service
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Hours */}
        {tab === 'hours' && (
          <div className="space-y-3">
            {!barberProfile ? (
              <p className="text-sm text-zinc-500 text-center py-8">Enable &quot;List Yourself as a Barber&quot; in Shop Info first</p>
            ) : (
              <>
                {/* Week Picker */}
                <div className="bg-zinc-900 border border-blue-500/20 rounded-xl p-4 mb-1">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-blue-400 uppercase tracking-wide font-semibold">Week Of</p>
                    {usingDefault && (
                      <span className="text-[10px] font-semibold text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full">Using Default Hours</span>
                    )}
                    {!usingDefault && selectedWeek !== '1970-01-01' && (
                      <span className="text-[10px] font-semibold text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded-full">Custom Hours Set</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => {
                      const d = new Date(selectedWeek + 'T12:00:00')
                      d.setDate(d.getDate() - 7)
                      setSelectedWeek(d.toISOString().split('T')[0])
                    }} className="text-zinc-400 hover:text-white p-1">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <div className="flex-1 text-center">
                      <p className="text-sm font-semibold text-white">
                        {new Date(selectedWeek + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' – '}
                        {(() => { const d = new Date(selectedWeek + 'T12:00:00'); d.setDate(d.getDate() + 6); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) })()}
                      </p>
                    </div>
                    <button onClick={() => {
                      const d = new Date(selectedWeek + 'T12:00:00')
                      d.setDate(d.getDate() + 7)
                      setSelectedWeek(d.toISOString().split('T')[0])
                    }} className="text-zinc-400 hover:text-white p-1">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </div>
                  {/* Clone previous week */}
                  <button onClick={clonePreviousWeek} disabled={cloning}
                    className="w-full mt-3 text-xs font-semibold text-blue-400 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-500/20 py-2 rounded-lg transition-colors disabled:opacity-50">
                    {cloning ? 'Cloning...' : 'Clone Previous Week\'s Hours'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-1">
                  <div>
                    <label className={labelCls}>Appt Duration (min)</label>
                    <input type="number" value={defaultDuration} onChange={e => setDefaultDuration(Number(e.target.value))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Cleanup Time (min)</label>
                    <input type="number" value={cleanupMinutes} onChange={e => setCleanupMinutes(Number(e.target.value))} className={inputCls} />
                  </div>
                </div>

                {DAY_NAMES.map((dayName, idx) => {
                  const dayBlocks = availability.filter(a => a.day_of_week === idx)
                  const hasBlocks = dayBlocks.length > 0
                  const isActive = dayBlocks.some(b => b.is_available)
                  // If no blocks exist, create a default one
                  if (!hasBlocks) dayBlocks.push({ day_of_week: idx, start_time: '09:00', end_time: '18:00', is_available: idx < 6, block_index: 0 })

                  return (
                    <div key={idx} className={`bg-zinc-900 border rounded-xl px-4 py-3 ${isActive ? 'border-blue-500/15' : 'border-zinc-800/50 opacity-50'}`}>
                      {/* Day header with toggle */}
                      <div className="flex items-center justify-between mb-1">
                        <button onClick={() => {
                          setAvailability(prev => {
                            const others = prev.filter(a => a.day_of_week !== idx)
                            const toggled = dayBlocks.map(b => ({ ...b, is_available: !isActive }))
                            return [...others, ...toggled].sort((a, b) => a.day_of_week - b.day_of_week || a.block_index - b.block_index)
                          })
                        }} className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${isActive ? 'bg-blue-600 border-blue-500' : 'border-zinc-600'}`}>
                            {isActive && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                          </div>
                          <span className="text-sm text-white font-medium">{dayName}</span>
                        </button>
                        {isActive && (
                          <button onClick={() => {
                            const nextIdx = Math.max(...dayBlocks.map(b => b.block_index), -1) + 1
                            setAvailability(prev => [...prev, { day_of_week: idx, start_time: '12:00', end_time: '17:00', is_available: true, block_index: nextIdx }]
                              .sort((a, b) => a.day_of_week - b.day_of_week || a.block_index - b.block_index))
                          }} className="text-[10px] text-blue-400 font-semibold hover:text-blue-300">+ Add Block</button>
                        )}
                      </div>

                      {/* Time blocks */}
                      {isActive && dayBlocks.filter(b => b.is_available).map((block, bi) => (
                        <div key={bi} className="flex items-center gap-2 mt-2">
                          <input type="time" value={block.start_time.slice(0, 5)}
                            onChange={e => setAvailability(prev =>
                              prev.map(a => a.day_of_week === idx && a.block_index === block.block_index ? { ...a, start_time: e.target.value } : a)
                            )}
                            className="bg-zinc-800 border border-zinc-700 text-white text-xs rounded-lg px-2 py-1.5 flex-1" />
                          <span className="text-zinc-600 text-xs">to</span>
                          <input type="time" value={block.end_time.slice(0, 5)}
                            onChange={e => setAvailability(prev =>
                              prev.map(a => a.day_of_week === idx && a.block_index === block.block_index ? { ...a, end_time: e.target.value } : a)
                            )}
                            className="bg-zinc-800 border border-zinc-700 text-white text-xs rounded-lg px-2 py-1.5 flex-1" />
                          {dayBlocks.filter(b => b.is_available).length > 1 && (
                            <button onClick={() => setAvailability(prev =>
                              prev.filter(a => !(a.day_of_week === idx && a.block_index === block.block_index))
                            )} className="text-red-400 hover:text-red-300 shrink-0">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}

                <button onClick={saveAvailability} disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm mt-2">
                  {saving ? 'Saving...' : 'Save Hours'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Payment */}
        {tab === 'payment' && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Venmo Username</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">@</span>
                <input value={venmo} onChange={e => setVenmo(e.target.value)} className={inputCls + ' pl-8'} placeholder="yourvenmo" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Cash App Tag</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                <input value={cashapp} onChange={e => setCashapp(e.target.value)} className={inputCls + ' pl-8'} placeholder="yourcashtag" />
              </div>
            </div>
            <p className="text-xs text-zinc-500">Customers will see payment buttons on their confirmation page. Tipping is always appreciated!</p>
            <button onClick={savePayment} disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm">
              {saving ? 'Saving...' : 'Save Payment Settings'}
            </button>
          </div>
        )}

        {/* Photos */}
        {tab === 'photos' && (
          <div className="space-y-6">
            {!barberProfile ? (
              <p className="text-sm text-zinc-500 text-center py-8">Enable &quot;List Yourself as a Barber&quot; in Shop Info first</p>
            ) : (
              <>
                {/* Profile Photo */}
                <div>
                  <p className="text-xs text-blue-400 uppercase tracking-wide font-semibold mb-3">Profile Photo</p>
                  <div className="bg-zinc-900 border border-blue-500/20 rounded-2xl p-5">
                    <div className="flex items-center gap-4">
                      <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0 border-2 border-blue-500/30">
                        {barberAvatarUrl ? (
                          <img src={barberAvatarUrl} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-white font-medium mb-1">
                          {barberAvatarUrl ? 'Change your profile photo' : 'Add a profile photo'}
                        </p>
                        <p className="text-xs text-zinc-500 mb-3">This is what customers see when choosing a barber</p>
                        <label className={`inline-flex items-center gap-2 text-sm font-semibold text-blue-400 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-500/20 px-4 py-2 rounded-lg cursor-pointer transition-colors ${uploadingAvatar ? 'opacity-50' : ''}`}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {uploadingAvatar ? 'Uploading...' : 'Upload Photo'}
                          <input type="file" accept="image/*" className="hidden" disabled={uploadingAvatar}
                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = '' }} />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Portfolio */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-blue-400 uppercase tracking-wide font-semibold">Portfolio ({portfolio.length})</p>
                  </div>

                  {/* Upload new */}
                  <div className="bg-zinc-900 border border-dashed border-blue-500/30 rounded-2xl p-4 mb-4">
                    <input value={photoCaption} onChange={e => setPhotoCaption(e.target.value)}
                      placeholder="Caption (optional)" className={inputCls + ' mb-3'} />
                    <label className={`flex items-center justify-center gap-2 w-full text-sm font-semibold text-blue-400 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-500/20 py-3 rounded-xl cursor-pointer transition-colors ${uploadingPortfolio ? 'opacity-50' : ''}`}>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      {uploadingPortfolio ? 'Uploading...' : 'Add Photo to Portfolio'}
                      <input type="file" accept="image/*" className="hidden" disabled={uploadingPortfolio}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadPortfolioPhoto(f); e.target.value = '' }} />
                    </label>
                  </div>

                  {/* Grid */}
                  {portfolio.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {portfolio.map(p => (
                        <div key={p.id} className="relative group">
                          <div className="aspect-square bg-zinc-800 rounded-xl overflow-hidden border border-blue-500/15">
                            {p.url && <img src={p.url} alt={p.caption ?? 'Portfolio'} className="w-full h-full object-cover" />}
                          </div>
                          {p.caption && (
                            <p className="text-xs text-zinc-400 mt-1 truncate">{p.caption}</p>
                          )}
                          <button onClick={() => deletePortfolioPhoto(p.id)}
                            className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/70 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-600 text-center py-4">No portfolio photos yet. Show off your best work!</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
