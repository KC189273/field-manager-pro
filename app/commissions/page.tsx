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
  accessory_revenue: string
}

const EMPTY_DAY = {
  new_activations: 0, byod: 0, reacts: 0, promo10: 0,
  upgrades: 0, hsi: 0, bts: 0, mim_lines: 0,
  home_internet: 0, complete_protection: 0, hd_video: 0,
  accessory_revenue: '',
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── July 2026 Comp Plan ──────────────────────────────────────────────────────

interface Tier {
  voiceRate: number
  upgradeRate: number
  pct: string
  color: string
  level: number
}

function getTier(accessoryRevenue: number): Tier {
  if (accessoryRevenue >= 4500) return { voiceRate: 5.20, upgradeRate: 3.90, pct: '130%', color: 'text-emerald-400', level: 130 }
  if (accessoryRevenue >= 3000) return { voiceRate: 4.80, upgradeRate: 3.60, pct: '120%', color: 'text-emerald-400', level: 120 }
  if (accessoryRevenue >= 2000) return { voiceRate: 4.40, upgradeRate: 3.30, pct: '110%', color: 'text-green-400', level: 110 }
  if (accessoryRevenue >= 1250) return { voiceRate: 4.00, upgradeRate: 3.00, pct: '100%', color: 'text-white', level: 100 }
  if (accessoryRevenue >= 750)  return { voiceRate: 3.00, upgradeRate: 2.25, pct: '75%', color: 'text-amber-400', level: 75 }
  return { voiceRate: 2.00, upgradeRate: 1.50, pct: '50%', color: 'text-red-400', level: 50 }
}

function getVoiceBoostRate(tierLevel: number, voiceBoxes: number): number | null {
  if (tierLevel < 110 || voiceBoxes < 50) return null
  if (tierLevel >= 130) return voiceBoxes >= 75 ? 9.10 : 6.50
  if (tierLevel >= 120) return voiceBoxes >= 75 ? 8.40 : 6.00
  return voiceBoxes >= 75 ? 7.00 : 5.00 // 110%
}

function getNextTier(accessoryRevenue: number): { target: number; label: string } | null {
  if (accessoryRevenue >= 4500) return null
  if (accessoryRevenue >= 3000) return { target: 4500, label: '130%' }
  if (accessoryRevenue >= 2000) return { target: 3000, label: '120%' }
  if (accessoryRevenue >= 1250) return { target: 2000, label: '110%' }
  if (accessoryRevenue >= 750) return { target: 1250, label: '100%' }
  return { target: 750, label: '75%' }
}

function calcCommission(entries: Entry[]) {
  // Monthly totals
  let totalNewAct = 0, totalByod = 0, totalReacts = 0, totalPromo10 = 0
  let totalUpgrades = 0, totalHsi = 0, totalBts = 0, totalMimLines = 0
  let totalHomeInternet = 0, totalCP = 0, totalHdVideo = 0
  let totalAccessoryRevenue = 0

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
  }

  // Voice activations that get paid at voice rate
  const totalVoiceActivations = totalNewAct + totalByod + totalReacts

  // Voice box count for threshold: New Act + BYOD + Reacts + Promo10 - BTS
  const voiceBoxes = Math.max(0, totalNewAct + totalByod + totalReacts + totalPromo10 - totalBts)

  // Get tier based on accessory revenue
  const tier = getTier(totalAccessoryRevenue)

  // Check voice boost
  const voiceBoostRate = getVoiceBoostRate(tier.level, voiceBoxes)
  const effectiveVoiceRate = voiceBoostRate ?? tier.voiceRate
  const voiceBoostActive = voiceBoostRate !== null

  // Tier-rated commissions (multiplier is already baked into the rates)
  const voiceCommission = totalVoiceActivations * effectiveVoiceRate
  const upgradeCommission = totalUpgrades * tier.upgradeRate
  const hsiBoxCommission = totalHsi * tier.upgradeRate
  const btsCommission = totalBts * tier.upgradeRate
  const mimBoxCommission = totalMimLines * tier.upgradeRate

  const tierRatedTotal = voiceCommission + upgradeCommission + hsiBoxCommission + btsCommission + mimBoxCommission

  // Bonus stack (NOT affected by multiplier — flat rates)
  const promo10Commission = totalPromo10 * 2
  const mimSpiffCommission = totalMimLines * 10
  const hsiSpiffCommission = totalHsi * 10
  const attachmentCommission = (totalCP + totalHdVideo) * 1
  const homeInternetCommission = totalHomeInternet * 10

  const bonusStackTotal = promo10Commission + mimSpiffCommission + hsiSpiffCommission +
    attachmentCommission + homeInternetCommission

  // MiM penalty
  const mimPenalty = totalMimLines === 0 ? -100 : 0

  const totalCommission = tierRatedTotal + bonusStackTotal + mimPenalty

  return {
    totalNewAct, totalByod, totalReacts, totalPromo10,
    totalVoiceActivations, voiceBoxes,
    totalUpgrades, totalHsi, totalBts, totalMimLines,
    totalHomeInternet, totalCP, totalHdVideo, totalAccessoryRevenue,
    tier, effectiveVoiceRate, voiceBoostActive, voiceBoostRate,
    voiceCommission, upgradeCommission, hsiBoxCommission, btsCommission, mimBoxCommission,
    tierRatedTotal,
    promo10Commission, mimSpiffCommission, hsiSpiffCommission,
    attachmentCommission, homeInternetCommission, bonusStackTotal,
    mimPenalty, totalCommission,
  }
}

function calcDayPayout(entry: Entry, effectiveVoiceRate: number, tier: Tier) {
  const voiceActs = (entry.new_activations ?? 0) + (entry.byod ?? 0) + (entry.reacts ?? 0)
  const voice = voiceActs * effectiveVoiceRate
  const upgrades = (entry.upgrades ?? 0) * tier.upgradeRate
  const hsiBox = (entry.hsi ?? 0) * tier.upgradeRate
  const bts = (entry.bts ?? 0) * tier.upgradeRate
  const mimBox = (entry.mim_lines ?? 0) * tier.upgradeRate
  const tierTotal = voice + upgrades + hsiBox + bts + mimBox

  // Bonus stack (flat)
  const promo10 = (entry.promo10 ?? 0) * 2
  const mimSpiff = (entry.mim_lines ?? 0) * 10
  const hsiSpiff = (entry.hsi ?? 0) * 10
  const attachments = ((entry.complete_protection ?? 0) + (entry.hd_video ?? 0)) * 1
  const homeInternet = (entry.home_internet ?? 0) * 10

  return tierTotal + promo10 + mimSpiff + hsiSpiff + attachments + homeInternet
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
      })
    } else {
      setForm({ ...EMPTY_DAY })
    }
  }, [selectedDate, entries])

  async function handleSave() {
    setSaving(true)
    await fetch('/api/commissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_date: selectedDate, ...form, accessory_revenue: Number(form.accessory_revenue) || 0 }),
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
  }
  const dayPayout = calcDayPayout(todayEntry, commission.effectiveVoiceRate, commission.tier)

  const nextTier = getNextTier(commission.totalAccessoryRevenue)

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
      <NavBar role={session.role as 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'} fullName={session.fullName} />

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
                  <p className="text-xs text-gray-400">Payout Tier</p>
                  <p className={`text-lg font-bold ${commission.tier.color}`}>{commission.tier.pct}</p>
                  {commission.voiceBoostActive && (
                    <p className="text-xs text-cyan-400 font-semibold mt-1">Voice Boost: ${commission.effectiveVoiceRate.toFixed(2)}</p>
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
                {numInput('promo10', 'Promo10 AAL', '$2 flat / counts toward voice')}
              </div>
            </div>

            {/* Products */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Products</p>
                <p className="text-xs text-gray-500">${commission.tier.upgradeRate.toFixed(2)}/line</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {numInput('upgrades', 'Upgrades')}
                {numInput('hsi', 'HSI', '+$10 SPIFF per account')}
                {numInput('bts', 'BTS', 'Subtracts from voice count')}
                {numInput('mim_lines', 'MiM Lines', '+$10 SPIFF per line')}
              </div>
            </div>

            {/* Bonus Stack */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-1">Bonus Stack</p>
              <p className="text-[10px] text-gray-600 mb-3">Not affected by multiplier</p>
              <div className="grid grid-cols-2 gap-3">
                {numInput('home_internet', 'Home Internet', '$10/account flat')}
                {numInput('complete_protection', 'Complete Protection', '$1/attachment')}
                {numInput('hd_video', 'HD Video', '$1/attachment')}
              </div>
            </div>

            {/* Accessories */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-3">Accessory Revenue</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input type="number" inputMode="decimal" step="0.01" min="0"
                  value={form.accessory_revenue || ''}
                  onChange={e => setForm(f => ({ ...f, accessory_revenue: e.target.value }))}
                  placeholder="0.00" className={inputCls + ' pl-7 text-left'} />
              </div>
            </div>

            <button onClick={handleSave} disabled={saving}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm">
              {saving ? 'Saving...' : 'Save Entry'}
            </button>
          </div>
        )}

        {/* ── MONTHLY SUMMARY ── */}
        {tab === 'summary' && (
          <div className="py-4 space-y-4">
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />

            {/* Total Commission */}
            <div className="bg-gradient-to-r from-violet-600/20 to-purple-600/20 border border-violet-500/30 rounded-2xl p-5 text-center">
              <p className="text-xs text-violet-300 uppercase tracking-wide font-semibold">{monthLabel} Estimated Commission</p>
              <p className="text-4xl font-bold text-white mt-2">${commission.totalCommission.toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-1">
                Tier-rated: ${commission.tierRatedTotal.toFixed(2)} + Bonus stack: ${commission.bonusStackTotal.toFixed(2)}
              </p>
            </div>

            {/* Key Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                <p className="text-2xl font-bold text-cyan-400">{commission.voiceBoxes}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Voice Boxes</p>
                {commission.voiceBoostActive && (
                  <p className="text-[10px] text-emerald-400 font-semibold mt-0.5">${commission.effectiveVoiceRate.toFixed(2)} BOOST</p>
                )}
                {!commission.voiceBoostActive && commission.voiceBoxes >= 50 && commission.tier.level < 110 && (
                  <p className="text-[10px] text-amber-400 mt-0.5">Need 110% tier</p>
                )}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                <p className={`text-2xl font-bold ${commission.tier.color}`}>{commission.tier.pct}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Payout Tier</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                <p className="text-2xl font-bold text-violet-400">${commission.totalAccessoryRevenue.toFixed(0)}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">Acc. Revenue</p>
              </div>
            </div>

            {/* Next Tier Progress */}
            {nextTier && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">${commission.totalAccessoryRevenue.toFixed(0)} of ${nextTier.target.toLocaleString()}</p>
                  <p className="text-xs font-semibold text-violet-400">Next: {nextTier.label}</p>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (commission.totalAccessoryRevenue / nextTier.target) * 100)}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-1">${(nextTier.target - commission.totalAccessoryRevenue).toFixed(0)} to go</p>
              </div>
            )}

            {/* Voice Boost Status */}
            <div className={`bg-gray-900 border rounded-2xl p-4 ${commission.voiceBoostActive ? 'border-emerald-700/50' : 'border-gray-800'}`}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Voice Boost</p>
                {commission.voiceBoostActive ? (
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-900/40 px-2 py-0.5 rounded-full">${commission.effectiveVoiceRate.toFixed(2)}/BOX</span>
                ) : (
                  <span className="text-xs text-gray-500">Inactive</span>
                )}
              </div>
              {commission.tier.level < 110 && (
                <p className="text-xs text-gray-500 mt-2">Requires 110% tier ($2,000+ accessories) to unlock</p>
              )}
              {commission.tier.level >= 110 && !commission.voiceBoostActive && (
                <p className="text-xs text-gray-500 mt-2">{50 - commission.voiceBoxes} more voice boxes for ${getVoiceBoostRate(commission.tier.level, 50)?.toFixed(2)}/box boost</p>
              )}
              {commission.voiceBoostActive && commission.voiceBoxes < 75 && (
                <p className="text-xs text-gray-300 mt-2">{75 - commission.voiceBoxes} more for ${getVoiceBoostRate(commission.tier.level, 75)?.toFixed(2)}/box</p>
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
                <p className="text-xs text-red-400/70 mt-2">Sell at least 1 MiM line this month to avoid the -$100 penalty</p>
              )}
            </div>

            {/* Commission Breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Tier-Rated Items ({commission.tier.pct})</p>
              </div>
              {[
                ['Voice Activations', `${commission.totalVoiceActivations} x $${commission.effectiveVoiceRate.toFixed(2)}`, commission.voiceCommission],
                ['Upgrades', `${commission.totalUpgrades} x $${commission.tier.upgradeRate.toFixed(2)}`, commission.upgradeCommission],
                ['HSI (box rate)', `${commission.totalHsi} x $${commission.tier.upgradeRate.toFixed(2)}`, commission.hsiBoxCommission],
                ['BTS', `${commission.totalBts} x $${commission.tier.upgradeRate.toFixed(2)}`, commission.btsCommission],
                ['MiM (box rate)', `${commission.totalMimLines} x $${commission.tier.upgradeRate.toFixed(2)}`, commission.mimBoxCommission],
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
                <span className="text-sm text-gray-400">Tier-Rated Subtotal</span>
                <span className="text-sm font-semibold text-white">${commission.tierRatedTotal.toFixed(2)}</span>
              </div>

              <div className="px-4 py-3 border-t border-gray-700">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Bonus Stack (flat rates)</p>
              </div>
              {[
                ['Promo10 AAL', `${commission.totalPromo10} x $2`, commission.promo10Commission],
                ['MiM SPIFF', `${commission.totalMimLines} x $10/line`, commission.mimSpiffCommission],
                ['HSI SPIFF', `${commission.totalHsi} x $10/acct`, commission.hsiSpiffCommission],
                ['Attachments', `${commission.totalCP + commission.totalHdVideo} x $1`, commission.attachmentCommission],
                ['Home Internet', `${commission.totalHomeInternet} x $10`, commission.homeInternetCommission],
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
                <span className="text-sm text-gray-400">Bonus Stack Subtotal</span>
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
                  const dp = calcDayPayout(e, commission.effectiveVoiceRate, commission.tier)
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
