import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import NavBar from '@/components/NavBar'
import { daysUntilDeadline, nextWeekStart, formatWeekRange } from '@/lib/schedule'

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const isManager = session.role === 'manager' || session.role === 'ops_manager'
  const isDeveloper = session.role === 'developer'

  // Active shift
  const activeShift = await queryOne<{
    id: string
    clock_in_at: string
    clock_in_address: string | null
  }>(`SELECT id, clock_in_at, clock_in_address FROM shifts WHERE user_id = $1 AND clock_out_at IS NULL LIMIT 1`, [session.id])

  // Next week schedule
  const nextMon = nextWeekStart()
  const nextMonStr = nextMon.toISOString().split('T')[0]
  const nextSchedule = await queryOne<{ days_working: number[] }>(
    `SELECT days_working FROM schedules WHERE user_id = $1 AND week_start = $2`,
    [session.id, nextMonStr]
  )
  const daysLeft = daysUntilDeadline()
  const scheduleSubmitted = !!nextSchedule
  const overdue = daysLeft < 0

  // Unresolved flags (managers/dev only)
  let flagCount = 0
  if (isManager || isDeveloper) {
    const result = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM flags WHERE resolved = FALSE`
    )
    flagCount = parseInt(result?.count ?? '0')
  }

  // Recent shifts this week
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1))
  weekStart.setHours(0, 0, 0, 0)

  const weekShifts = await query<{ clock_in_at: string; clock_out_at: string | null; duration_seconds: number }>(
    `SELECT clock_in_at, clock_out_at, EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) as duration_seconds
     FROM shifts WHERE user_id = $1 AND clock_in_at >= $2 ORDER BY clock_in_at DESC`,
    [session.id, weekStart.toISOString()]
  )

  const totalSeconds = weekShifts.reduce((sum, s) => sum + Number(s.duration_seconds), 0)
  const totalHours = (totalSeconds / 3600).toFixed(1)

  const clocked = !!activeShift
  const clockedInFor = activeShift
    ? formatDuration((Date.now() - new Date(activeShift.clock_in_at).getTime()) / 1000)
    : null

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 space-y-4 max-w-lg mx-auto">
        {/* Greeting */}
        <div>
          <p className="text-gray-400 text-sm">Good {getTimeOfDay()}</p>
          <h1 className="text-2xl font-bold text-white">{session.fullName.split(' ')[0]}</h1>
        </div>

        {/* Clock status card */}
        <div className={`rounded-2xl p-5 border ${clocked ? 'bg-green-950 border-green-800' : 'bg-gray-900 border-gray-800'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-400">{clocked ? 'Clocked In' : 'Not Clocked In'}</p>
              {clockedInFor && <p className="text-2xl font-bold text-green-400 mt-0.5">{clockedInFor}</p>}
              {activeShift?.clock_in_address && (
                <p className="text-xs text-gray-500 mt-1 truncate max-w-[200px]">{activeShift.clock_in_address}</p>
              )}
            </div>
            <a
              href="/clock"
              className={`px-4 py-2 rounded-xl font-semibold text-sm transition-colors ${
                clocked
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-violet-600 hover:bg-violet-500 text-white'
              }`}
            >
              {clocked ? 'Clock Out' : 'Clock In'}
            </a>
          </div>
        </div>

        {/* This week hours */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
          <p className="text-sm font-medium text-gray-400 mb-1">This Week</p>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-white">{totalHours}</span>
            <span className="text-gray-400 mb-0.5">hours</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">{weekShifts.length} shift{weekShifts.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Schedule alert */}
        {session.role === 'employee' && !scheduleSubmitted && (
          <div className={`rounded-2xl p-5 border ${overdue ? 'bg-red-950 border-red-800' : daysLeft <= 2 ? 'bg-amber-950 border-amber-700' : 'bg-gray-900 border-gray-800'}`}>
            <p className="text-sm font-medium text-gray-300">
              {overdue
                ? '⚠ Schedule Past Due'
                : daysLeft <= 2
                  ? `⚡ Schedule Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
                  : `📅 Schedule Due in ${daysLeft} days`}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatWeekRange(nextMon)}
            </p>
            <a
              href="/schedule"
              className="mt-3 inline-block bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              Submit Schedule
            </a>
          </div>
        )}

        {scheduleSubmitted && session.role === 'employee' && (
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-sm font-medium text-gray-400">Next Week Schedule</p>
            <p className="text-green-400 font-semibold mt-0.5">✓ Submitted</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {nextSchedule!.days_working.length} day{nextSchedule!.days_working.length !== 1 ? 's' : ''} selected
            </p>
          </div>
        )}

        {/* Flags (managers/dev) */}
        {(isManager || isDeveloper) && flagCount > 0 && (
          <a href="/flags" className="block bg-amber-950 border border-amber-700 rounded-2xl p-5">
            <p className="text-amber-400 font-semibold">⚠ {flagCount} unresolved flag{flagCount !== 1 ? 's' : ''}</p>
            <p className="text-xs text-gray-400 mt-0.5">Tap to review</p>
          </a>
        )}
      </div>
    </div>
  )
}

function getTimeOfDay(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
