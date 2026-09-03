'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

interface Session {
  id: string; fullName: string; role: string; org_id?: string | null
}

interface Entry {
  id: string; entry_date: string
  new_activations: number; byod: number; reacts: number; promo10: number
  upgrades: number; hsi: number; bts: number; mim_lines: number
  home_internet: number; complete_protection: number; hd_video: number
  accessory_revenue: string; total_revenue: string
}

const EMPTY_DAY = {
  new_activations: 0, byod: 0, reacts: 0, promo10: 0,
  upgrades: 0, hsi: 0, bts: 0, mim_lines: 0,
  home_internet: 0, complete_protection: 0, hd_video: 0,
  accessory_revenue: '', total_revenue: '',
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── September 2026 Comp Plan ────────────────────────────────────────────────

// Revenue Multiplier — based on TOTAL monthly revenue generated
function getMultiplier(totalRevenue: number): { pct: number; label: string; color: string } {
  if (totalRevenue >= 5000) return { pct: 1.30, label: '130%', color: 'text-emerald-400' }
  if (totalRevenue >= 3500) return { pct: 1.20, label: '120%', color: 'text-emerald-400' }
  if (totalRevenue >= 2500) return { pct: 1.20, label: '120%', color: 'text-emerald-400' }
  if (totalRevenue >= 1500) return { pct: 1.00, label: '100%', color: 'text-white' }
  if (totalRevenue >= 1000) return { pct: 0.75, label: '75%', color: 'text-amber-400' }
  return { pct: 0.50, label: '50%', color: 'text-red-400' }
}

function getNextMultiplierTier(totalRevenue: number): { target: number; label: string } | null {
  if (totalRevenue >= 5000) return null
  if (totalRevenue >= 3500) return { target: 5000, label: '130%' }
  if (totalRevenue >= 2500) return { target: 3500, label: '120%+' }
  if (totalRevenue >= 1500) return { target: 2500, label: '120%' }
  if (totalRevenue >= 1000) return { target: 1500, label: '100%' }
  return { target: 1000, label: '75%' }
}

// Voice Boost — requires $2,500 accessory revenue + 50 voice boxes
function getVoiceBoostRate(accessoryRevenue: number, voiceBoxes: number): number | null {
  if (accessoryRevenue < 2500 || voiceBoxes < 50) return null
  return voiceBoxes >= 75 ? 8 : 6
}

const BASE_VOICE_RATE = 5
const BASE_UPGRADE_RATE = 3

function calcCommission(entries: Entry[]) {
  let totalNewAct = 0, totalByod = 0, totalReacts = 0, totalPromo10 = 0
  let totalUpgrades = 0, totalHsi = 0, totalBts = 0, totalMimLines = 0
  let totalHomeInternet = 0, totalCP = 0, totalHdVideo = 0
  let totalAccessoryRevenue = 0, totalTotalRevenue = 0

  for (const e of entries) {
    totalNewAct += e.new_activations ?? 0
    totalByod += e.byod ?? 0
    totalReacts += e.reacts ?? 0
    totalPromo10 += e.promo10 ?? 0
    totalUpgrades += e.upgrades ?? 0
    totalHsi += e.hsi ?? 0
    totalBts += e.bts ?? 0
    totalMimLines += e.mim_lines ?? 0
    totalHomeInternet += e.home_internet ?? 0
    totalCP += e.complete_protection ?? 0
    totalHdVideo += e.hd_video ?? 0
    totalAccessoryRevenue += Number(e.accessory_revenue) || 0
    totalTotalRevenue += Number(e.total_revenue) || 0
  }

  // Voice activations paid at voice rate (excludes Promo10)
  const totalVoiceActivations = totalNewAct + totalByod + totalReacts

  // Voice box count for Voice Boost threshold (includes Promo10)
  const voiceBoxes = totalNewAct + totalByod + totalReacts + totalPromo10

  // Revenue Multiplier (based on total revenue)
  const multiplier = getMultiplier(totalTotalRevenue)

  // Voice Boost (requires $2,500 accessory revenue)
  const voiceBoostRate = getVoiceBoostRate(totalAccessoryRevenue, voiceBoxes)
  const baseVoiceRate = voiceBoostRate ?? BASE_VOICE_RATE
  const voiceBoostActive = voiceBoostRate !== null

  // Apply multiplier to base rates
  const effectiveVoiceRate = baseVoiceRate * multiplier.pct
  const effectiveUpgradeRate = BASE_UPGRADE_RATE * multiplier.pct

  // Tier-rated commissions (base rate x multiplier)
  const voiceCommission = totalVoiceActivations * effectiveVoiceRate
  const upgradeCommission = totalUpgrades * effectiveUpgradeRate
  const hsiBoxCommission = totalHsi * effectiveUpgradeRate
  const btsCommission = totalBts * effectiveUpgradeRate

  const tierRatedTotal = voiceCommission + upgradeCommission + hsiBoxCommission + btsCommission

  // Bonus Accelerator (flat rates — NOT affected by multiplier)
  const promo10Commission = totalPromo10 * 2
  const mimSpiffCommission = totalMimLines * 10
  const attachmentCommission = (totalCP + totalHdVideo) * 1
  const homeInternetCommission = totalHomeInternet * 15

  const bonusStackTotal = promo10Commission + mimSpiffCommission +
    attachmentCommission + homeInternetCommission

  // MiM penalty
  const mimPenalty = totalMimLines === 0 ? -100 : 0

  const totalCommission = tierRatedTotal + bonusStackTotal + mimPenalty

  return {
    totalNewAct, totalByod, totalReacts, totalPromo10,
    totalVoiceActivations, voiceBoxes,
    totalUpgrades, totalHsi, totalBts, totalMimLines,
    totalHomeInternet, totalCP, totalHdVideo, totalAccessoryRevenue, totalTotalRevenue,
    multiplier, baseVoiceRate, effectiveVoiceRate, effectiveUpgradeRate,
    voiceBoostActive, voiceBoostRate,
    voiceCommission, upgradeCommission, hsiBoxCommission, btsCommission,
    tierRatedTotal,
    promo10Commission, mimSpiffCommission,
    attachmentCommission, homeInternetCommission, bonusStackTotal,
    mimPenalty, totalCommission,
  }
}

function calcDayPayout(entry: Entry, effectiveVoiceRate: number, effectiveUpgradeRate: number) {
  const voiceActs = (entry.new_activations ?? 0) + (entry.byod ?? 0) + (entry.reacts ?? 0)
  const voice = voiceActs * effectiveVoiceRate
  const upgrades = (entry.upgrades ?? 0) * effectiveUpgradeRate
  const hsiBox = (entry.hsi ?? 0) * effectiveUpgradeRate
  const bts = (entry.bts ?? 0) * effectiveUpgradeRate
  const tierTotal = voice + upgrades + hsiBox + bts

  // Bonus Accelerator (flat)
  const promo10 = (entry.promo10 ?? 0) * 2
  const mimSpiff = (entry.mim_lines ?? 0) * 10
  const attachments = ((entry.complete_protection ?? 0) + (entry.hd_video ?? 0)) * 1
  const homeInternet = (entry.home_internet ?? 0) * 15

  return tierTotal + promo10 + mimSpiff + attachments + homeInternet
}

export default function CommissionsPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [month, setMonth] = useState(currentMonth)
  const [entries, setEntries] = useState<Entry[]>([])
  const [selectedDate, setSelectedDate] = useState(todayLocal)
  const [form, setForm] = useState({ ...EMPTY_DAY })
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'entry' | 'summary'>('entry')

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => { if (d) setSession(d) })
  }, [router])

  const loadEntries = useCallback(() => {
    if (!session) return
    fetch(`/api/commissions?month=${month}`)
      .then(r => r.json())
      .then(d => setEntries(d.entries ?? []))
  }, [session, month])

  useEffect(() => { loadEntries() }, [loadEntries])

  useEffect(() => {
    const existing = entries.find(e => e.entry_date === selectedDate)
    if (existing) {
      setForm({
        new_activations: existing.new_activations,
        byod: existing.byod,
        reacts: existing.reacts,
        promo10: existing.promo10,
        upgrades: existing.upgrades,
        hsi: existing.hsi,
        bts: existing.bts,
        mim_lines: existing.mim_lines,
        home_internet: existing.home_internet,
        complete_protection: existing.complete_protection,
        hd_video: existing.hd_video,
        accessory_revenue: String(existing.accessory_revenue),
        total_revenue: String(existing.total_revenue),
      })
    } else {
      setForm({ ...EMPTY_DAY })
    }
  }, [selectedDate, entries])

  const [clearing, setClearing] = useState<'day' | 'month' | null>(null)

  async function handleClearDay() {
    if (!confirm('Clear this day\'s entry? This cannot be undone.')) return
    setClearing('day')
    await fetch(`/api/commissions?date=${selectedDate}`, { method: 'DELETE' })
    setForm({ ...EMPTY_DAY })
    await loadEntries()
    setClearing(null)
  }

  async function handleClearMonth() {
    const label = new Date(month + '-15').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!confirm(`Clear ALL entries for ${label}? This cannot be undone.`)) return
    setClearing('month')
    await fetch(`/api/commissions?month=${month}`, { method: 'DELETE' })
    setForm({ ...EMPTY_DAY })
    await loadEntries()
    setClearing(null)
  }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/commissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_date: selectedDate, ...form,
        accessory_revenue: Number(form.accessory_revenue) || 0,
        total_revenue: Number(form.total_revenue) || 0,
      }),
    })
    await loadEntries()
    setSaving(false)
  }

  const commission = useMemo(() => calcCommission(entries), [entries])

  const todayEntry: Entry = {
    id: '', entry_date: selectedDate,
    new_activations: form.new_activations, byod: form.byod, reacts: form.reacts, promo10: form.promo10,
    upgrades: form.upgrades, hsi: form.hsi, bts: form.bts, mim_lines: form.mim_lines,
    home_internet: form.home_internet, complete_protection: form.complete_protection, hd_video: form.hd_video,
    accessory_revenue: String(form.accessory_revenue || 0),
    total_revenue: String(form.total_revenue || 0),
  }
  const dayPayout = calcDayPayout(todayEntry, commission.effectiveVoiceRate, commission.effectiveUpgradeRate)

  const nextTier = getNextMultiplierTier(commission.totalTotalRevenue)

  if (!session) return null

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-500'
  const labelCls = 'text-xs text-gray-400 mb-1'

  function numInput(key: keyof typeof form, label: string, sublabel?: string) {
    return (
      <div>
        <p className={labelCls}>{label}</p>
        {sublabel && <p className="text-[10px] text-gray-600 mb-1">{sublabel}</p>}
        <input
          type="number"
          inputMode="numeric"
          min="0"
          value={form[key] || ''}
          onChange={e => setForm(f => ({ ...f, [key]: parseInt(e.target.value) || 0 }))}
          placeholder="0"
          className={inputCls}
        />
      </div>
    )
  }

  const monthLabel = new Date(month + '-15').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role as 'employee' | 'manager' | 'ops_field_leader' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'} fullName={session.fullName} />

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 bg-gray-950 sticky top-14 z-30">
        {[
          { id: 'entry' as const, label: 'Daily Entry' },
          { id: 'summary' as const, label: 'Monthly Summary' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors border-b-2 ${
              tab === t.id ? 'border-violet-500 text-violet-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-xl mx-auto px-4">

        {/* ── DAILY ENTRY ── */}
        {tab === 'entry' && (
          <div className="py-4 space-y-4">
            {/* Date picker */}
            <div className="flex items-center gap-3">
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 flex-1" />
              <button onClick={() => setSelectedDate(todayLocal())}
                className="text-xs text-violet-400 hover:text-violet-300 font-semibold px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl">Today</button>
            </div>

            {/* Daily Payout Card */}
            <div className="bg-gradient-to-r from-violet-600/20 to-purple-600/20 border border-violet-500/30 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-violet-300 uppercase tracking-wide font-semibold">Today&apos;s Estimated Payout</p>
                  <p className="text-3xl font-bold text-white mt-1">${dayPayout.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Multiplier</p>
                  <p className={`text-lg font-bold ${commission.multiplier.color}`}>{commission.multiplier.label}</p>
                  {commission.voiceBoostActive && (
                    <p className="text-xs text-cyan-400 font-semibold mt-1">Voice Boost: ${commission.baseVoiceRate}/box</p>
                  )}
                </div>
              </div>
            </div>

            {/* Voice Activations */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Voice Activations</p>
                <p className="text-xs text-gray-500">${commission.effectiveVoiceRate.toFixed(2)}/box</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {numInput('new_activations', 'New Activations', 'New lines')}
                {numInput('byod', 'BYOD', 'Bring your own device')}
                {numInput('reacts', 'Reactivations', 'Reacts')}
                {numInput('promo10', 'Promo10 AAL', '$2 flat / counts toward voice boost')}
              </div>
            </div>

            {/* Products */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Products</p>
                <p className="text-xs text-gray-500">${commission.effectiveUpgradeRate.toFixed(2)}/line</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {numInput('upgrades', 'Upgrades')}
                {numInput('hsi', 'HSI')}
                {numInput('bts', 'BTS')}
              </div>
            </div>

            {/* Bonus Accelerator */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-1">Bonus Accelerator</p>
              <p className="text-[10px] text-gray-600 mb-3">Not affected by multiplier</p>
              <div className="grid grid-cols-2 gap-3">
                {numInput('mim_lines', 'MiM Lines', '$10/line flat')}
                {numInput('home_internet', 'Home Internet', '$15/account flat')}
                {numInput('complete_protection', 'Complete Protection', '$1/attachment')}
                {numInput('hd_video', 'HD Video', '$1/attachment')}
              </div>
            </div>

            {/* Revenue */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-3">Revenue</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className={labelCls}>Total Revenue</p>
                  <p className="text-[10px] text-gray-600 mb-1">Drives your multiplier</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input type="number" inputMode="decimal" step="0.01" min="0"
                      value={form.total_revenue || ''}
                      onChange={e => setForm(f => ({ ...f, total_revenue: e.target.value }))}
                      placeholder="0.00" className={inputCls + ' pl-7 text-left'} />
                  </div>
                </div>
                <div>
                  <p className={labelCls}>Accessory Revenue</p>
                  <p className="text-[10px] text-gray-600 mb-1">$2,500 unlocks Voice Boost</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input type="number" inputMode="decimal" step="0.01" min="0"
                      value={form.accessory_revenue || ''}
                      onChange={e => setForm(f => ({ ...f, accessory_revenue: e.target.value }))}
                      placeholder="0.00" className={inputCls + ' pl-7 text-left'} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                {saving ? 'Saving...' : 'Save Entry'}
              </button>
              <button onClick={handleClearDay} disabled={clearing === 'day'}
                className="px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 text-gray-400 hover:text-red-400 font-semibold rounded-xl transition-colors text-sm">
                {clearing === 'day' ? '...' : 'Clear Day'}
              </button>
            </div>
          </div>
        )}

        {/* ── MONTHLY SUMMARY ── */}
        {tab === 'summary' && (
          <div className="py-4 space-y-4">
            <div className="flex gap-2">
              <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              {entries.length > 0 && (
                <button onClick={handleClearMonth} disabled={clearing === 'month'}
                  className="px-4 py-2 bg-red-900/40 hover:bg-red-900/60 disabled:opacity-60 border border-red-800/40 text-red-400 font-semibold rounded-xl transition-colors text-sm">
                  {clearing === 'month' ? '...' : 'Clear Month'}
                </button>
              )}
            </div>

            {/* Total Commission */}
            <div className="bg-gradient-to-r from-violet-600/20 to-purple-600/20 border border-violet-500/30 rounded-2xl p-5 text-center">
              <p className="text-xs text-violet-300 uppercase tracking-wide font-semibold">{monthLabel} Estimated Commission</p>
              <p className="text-4xl font-bold text-white mt-2">${commission.totalCommission.toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-1">
                Base + Multiplier: ${commission.tierRatedTotal.toFixed(2)} + Bonus: ${commission.bonusStackTotal.toFixed(2)}
              </p>
            </div>

            {/* Key Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                <p className="text-2xl font-bold text-cyan-400">{commission.voiceBoxes}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Voice Boxes</p>
                {commission.voiceBoostActive && (
                  <p className="text-[10px] text-emerald-400 font-semibold mt-0.5">${commission.baseVoiceRate}/BOX BOOST</p>
                )}
                {!commission.voiceBoostActive && commission.voiceBoxes >= 50 && commission.totalAccessoryRevenue < 2500 && (
                  <p className="text-[10px] text-amber-400 mt-0.5">Need $2,500 acc.</p>
                )}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                <p className={`text-2xl font-bold ${commission.multiplier.color}`}>{commission.multiplier.label}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Multiplier</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                <p className="text-2xl font-bold text-violet-400">${commission.totalTotalRevenue.toFixed(0)}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Total Rev.</p>
              </div>
            </div>

            {/* Next Multiplier Tier Progress */}
            {nextTier && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">${commission.totalTotalRevenue.toFixed(0)} of ${nextTier.target.toLocaleString()}</p>
                  <p className="text-xs font-semibold text-violet-400">Next: {nextTier.label}</p>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (commission.totalTotalRevenue / nextTier.target) * 100)}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-1">${(nextTier.target - commission.totalTotalRevenue).toFixed(0)} to go</p>
              </div>
            )}

            {/* Voice Boost Status */}
            <div className={`bg-gray-900 border rounded-2xl p-4 ${commission.voiceBoostActive ? 'border-emerald-700/50' : 'border-gray-800'}`}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Voice Boost</p>
                {commission.voiceBoostActive ? (
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-900/40 px-2 py-0.5 rounded-full">${commission.baseVoiceRate}/BOX x {commission.multiplier.label}</span>
                ) : (
                  <span className="text-xs text-gray-500">Inactive</span>
                )}
              </div>
              {commission.totalAccessoryRevenue < 2500 && (
                <p className="text-xs text-gray-500 mt-2">Requires $2,500 accessory revenue to unlock (${commission.totalAccessoryRevenue.toFixed(0)} / $2,500)</p>
              )}
              {commission.totalAccessoryRevenue >= 2500 && !commission.voiceBoostActive && (
                <p className="text-xs text-gray-500 mt-2">{50 - commission.voiceBoxes} more voice boxes for $6/box boost</p>
              )}
              {commission.voiceBoostActive && commission.voiceBoxes < 75 && (
                <p className="text-xs text-gray-300 mt-2">{75 - commission.voiceBoxes} more for $8/box</p>
              )}
            </div>

            {/* MiM Status */}
            <div className={`bg-gray-900 border rounded-2xl p-4 ${commission.totalMimLines > 0 ? 'border-gray-800' : 'border-red-700/50'}`}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">MiM Minimum</p>
                {commission.totalMimLines > 0 ? (
                  <span className="text-xs font-bold text-green-400 bg-green-900/40 px-2 py-0.5 rounded-full">{commission.totalMimLines} Lines</span>
                ) : (
                  <span className="text-xs font-bold text-red-400 bg-red-900/40 px-2 py-0.5 rounded-full">-$100 PENALTY</span>
                )}
              </div>
              {commission.totalMimLines === 0 && (
                <p className="text-xs text-red-400/70 mt-2">Sell at least 1 MiM account this month to avoid the -$100 penalty</p>
              )}
            </div>

            {/* Commission Breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Base Pay x {commission.multiplier.label} Multiplier</p>
              </div>
              {[
                ['Voice Activations', `${commission.totalVoiceActivations} x $${commission.baseVoiceRate} x ${commission.multiplier.label}`, commission.voiceCommission],
                ['Upgrades', `${commission.totalUpgrades} x $${BASE_UPGRADE_RATE} x ${commission.multiplier.label}`, commission.upgradeCommission],
                ['HSI', `${commission.totalHsi} x $${BASE_UPGRADE_RATE} x ${commission.multiplier.label}`, commission.hsiBoxCommission],
                ['BTS', `${commission.totalBts} x $${BASE_UPGRADE_RATE} x ${commission.multiplier.label}`, commission.btsCommission],
              ].filter(([, , val]) => (val as number) > 0).map(([label, detail, val]) => (
                <div key={label as string} className="flex items-center justify-between px-4 py-2 border-b border-gray-800/50 last:border-0">
                  <div>
                    <span className="text-sm text-gray-300">{label as string}</span>
                    <span className="text-xs text-gray-600 ml-2">{detail as string}</span>
                  </div>
                  <span className="text-sm font-semibold text-white">${(val as number).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700 bg-gray-800/50">
                <span className="text-sm text-gray-400">Base + Multiplier Subtotal</span>
                <span className="text-sm font-semibold text-white">${commission.tierRatedTotal.toFixed(2)}</span>
              </div>

              <div className="px-4 py-3 border-t border-gray-700">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Bonus Accelerator (flat rates)</p>
              </div>
              {[
                ['Promo10 AAL', `${commission.totalPromo10} x $2`, commission.promo10Commission],
                ['MiM Lines', `${commission.totalMimLines} x $10/line`, commission.mimSpiffCommission],
                ['Attachments', `${commission.totalCP + commission.totalHdVideo} x $1`, commission.attachmentCommission],
                ['Home Internet', `${commission.totalHomeInternet} x $15`, commission.homeInternetCommission],
              ].filter(([, , val]) => (val as number) > 0).map(([label, detail, val]) => (
                <div key={label as string} className="flex items-center justify-between px-4 py-2 border-b border-gray-800/50 last:border-0">
                  <div>
                    <span className="text-sm text-gray-300">{label as string}</span>
                    <span className="text-xs text-gray-600 ml-2">{detail as string}</span>
                  </div>
                  <span className="text-sm font-semibold text-white">+${(val as number).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700 bg-gray-800/50">
                <span className="text-sm text-gray-400">Bonus Accelerator Subtotal</span>
                <span className="text-sm font-semibold text-white">${commission.bonusStackTotal.toFixed(2)}</span>
              </div>

              {commission.mimPenalty < 0 && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700">
                  <span className="text-sm text-red-400">No MiM Penalty</span>
                  <span className="text-sm font-bold text-red-400">${commission.mimPenalty.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-3 border-t-2 border-violet-500 bg-violet-600/10">
                <span className="text-sm font-bold text-white">Estimated Total Commission</span>
                <span className="text-lg font-bold text-white">${commission.totalCommission.toFixed(2)}</span>
              </div>
            </div>

            {/* Daily History */}
            {entries.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800">
                  <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Daily History</p>
                </div>
                {entries.map(e => {
                  const dp = calcDayPayout(e, commission.effectiveVoiceRate, commission.effectiveUpgradeRate)
                  const dayVoice = (e.new_activations ?? 0) + (e.byod ?? 0) + (e.reacts ?? 0) + (e.promo10 ?? 0)
                  const dayDate = new Date(e.entry_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  return (
                    <button key={e.entry_date} type="button"
                      onClick={() => { setSelectedDate(e.entry_date); setTab('entry') }}
                      className="w-full flex items-center justify-between px-4 py-2.5 border-b border-gray-800/50 last:border-0 hover:bg-gray-800/50 transition-colors text-left">
                      <div>
                        <span className="text-sm text-gray-300">{dayDate}</span>
                        <span className="text-xs text-gray-600 ml-2">{dayVoice}v</span>
                      </div>
                      <span className="text-sm font-semibold text-violet-400">${dp.toFixed(2)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
