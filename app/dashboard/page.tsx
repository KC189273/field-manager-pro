import { redirect } from 'next/navigation'
import { getSession, canViewTeam, canSubmitExpense } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import NavBar from '@/components/NavBar'
import { daysUntilDeadline, nextWeekStart, formatWeekRange } from '@/lib/schedule'

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const canTeam = canViewTeam(session.role)
  const canExpenses = canSubmitExpense(session.role)
  const isDev = session.role === 'developer'
  const orgId = (!isDev && session.org_id) ? session.org_id : null

  // Week start (Monday)
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1))
  weekStart.setHours(0, 0, 0, 0)
  const nextMon = nextWeekStart()
  const nextMonStr = nextMon.toISOString().split('T')[0]

  // Run all queries in parallel
  const [
    activeShift,
    weekShifts,
    nextSchedule,
    flagRow,
    clockedInRow,
    teamRow,
    pendingExpRow,
    myPendingRow,
  ] = await Promise.all([
    // Own active shift
    queryOne<{ id: string; clock_in_at: string; clock_in_address: string | null }>(
      `SELECT id, clock_in_at, clock_in_address FROM shifts WHERE user_id = $1 AND clock_out_at IS NULL LIMIT 1`,
      [session.id]
    ),
    // Own shifts this week
    query<{ duration_seconds: number }>(
      `SELECT EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) as duration_seconds
       FROM shifts WHERE user_id = $1 AND clock_in_at >= $2 ORDER BY clock_in_at DESC`,
      [session.id, weekStart.toISOString()]
    ),
    // Next week schedule
    queryOne<{ days_working: number[] }>(
      `SELECT days_working FROM schedules WHERE user_id = $1 AND week_start = $2`,
      [session.id, nextMonStr]
    ),
    // Open flags (management)
    canTeam
      ? queryOne<{ count: string }>(
          orgId
            ? `SELECT COUNT(*) as count FROM flags f JOIN users u ON u.id = f.user_id WHERE f.resolved = FALSE AND u.org_id = $1`
            : `SELECT COUNT(*) as count FROM flags WHERE resolved = FALSE`,
          orgId ? [orgId] : []
        )
      : Promise.resolve(null),
    // Employees clocked in right now (management)
    canTeam
      ? queryOne<{ count: string }>(
          orgId
            ? `SELECT COUNT(*) as count FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.clock_out_at IS NULL AND u.role NOT IN ('developer','owner') AND u.org_id = $1`
            : `SELECT COUNT(*) as count FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.clock_out_at IS NULL AND u.role NOT IN ('developer','owner')`,
          orgId ? [orgId] : []
        )
      : Promise.resolve(null),
    // Team size (management)
    canTeam
      ? queryOne<{ count: string }>(
          orgId
            ? `SELECT COUNT(*) as count FROM users WHERE is_active = TRUE AND role NOT IN ('developer') AND org_id = $1`
            : `SELECT COUNT(*) as count FROM users WHERE is_active = TRUE AND role NOT IN ('developer')`,
          orgId ? [orgId] : []
        )
      : Promise.resolve(null),
    // Pending expenses for org (management — needs approval)
    canTeam
      ? queryOne<{ count: string; total: string }>(
          orgId
            ? `SELECT COUNT(*) as count, COALESCE(SUM(e.amount), 0)::text as total FROM expenses e JOIN users u ON u.id = e.user_id WHERE e.status = 'pending' AND u.org_id = $1`
            : `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0)::text as total FROM expenses WHERE status = 'pending'`,
          orgId ? [orgId] : []
        )
      : Promise.resolve(null),
    // Own pending expenses
    canExpenses
      ? queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM expenses WHERE user_id = $1 AND status = 'pending'`,
          [session.id]
        )
      : Promise.resolve(null),
  ])

  // Derived values
  const clocked = !!activeShift
  const totalSeconds = weekShifts.reduce((s, r) => s + Number(r.duration_seconds), 0)
  const totalHours = (totalSeconds / 3600).toFixed(1)
  const clockedInFor = activeShift
    ? formatDuration((Date.now() - new Date(activeShift.clock_in_at).getTime()) / 1000)
    : null

  const daysLeft = daysUntilDeadline()
  const scheduleSubmitted = !!nextSchedule
  const scheduleOverdue = daysLeft < 0

  const flagCount = parseInt(flagRow?.count ?? '0')
  const clockedInCount = parseInt(clockedInRow?.count ?? '0')
  const teamCount = parseInt(teamRow?.count ?? '0')
  const pendingExpCount = parseInt(pendingExpRow?.count ?? '0')
  const pendingExpTotal = parseFloat(pendingExpRow?.total ?? '0')
  const myPendingCount = parseInt(myPendingRow?.count ?? '0')

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 space-y-3 max-w-lg mx-auto">
        {/* Greeting */}
        <div className="mb-1">
          <p className="text-gray-400 text-sm">Good {getTimeOfDay()}</p>
          <h1 className="text-2xl font-bold text-white">{session.fullName.split(' ')[0]}</h1>
        </div>

        {/* ── Clock hero ── */}
        <a
          href="/clock"
          className={`block rounded-2xl p-5 border transition-colors ${
            clocked
              ? 'bg-green-950 border-green-800 hover:border-green-700'
              : 'bg-gray-900 border-gray-800 hover:border-gray-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                {clocked ? 'Clocked In' : 'Not Clocked In'}
              </p>
              <p className={`text-2xl font-bold mt-0.5 ${clocked ? 'text-green-400' : 'text-gray-500'}`}>
                {clocked ? clockedInFor : '—'}
              </p>
              {activeShift?.clock_in_address && (
                <p className="text-xs text-gray-500 mt-1 truncate max-w-[200px]">
                  {activeShift.clock_in_address}
                </p>
              )}
            </div>
            <span
              className={`px-4 py-2 rounded-xl font-semibold text-sm ${
                clocked ? 'bg-red-600 text-white' : 'bg-violet-600 text-white'
              }`}
            >
              {clocked ? 'Clock Out' : 'Clock In'}
            </span>
          </div>
        </a>

        {/* ── This week + Schedule (2-col) ── */}
        <div className="grid grid-cols-2 gap-3">
          <a
            href="/timecards"
            className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-4 transition-colors"
          >
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">This Week</p>
            <p className="text-2xl font-bold text-white">
              {totalHours}
              <span className="text-sm font-normal text-gray-400 ml-1">hrs</span>
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {weekShifts.length} shift{weekShifts.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-violet-500 mt-3">Timecards →</p>
          </a>

          <a
            href="/schedule"
            className={`rounded-2xl p-4 border transition-colors ${
              !scheduleSubmitted && scheduleOverdue
                ? 'bg-red-950 border-red-800 hover:border-red-700'
                : !scheduleSubmitted && daysLeft <= 2
                ? 'bg-amber-950 border-amber-700 hover:border-amber-600'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Schedule</p>
            {scheduleSubmitted ? (
              <>
                <p className="text-lg font-bold text-green-400">Submitted</p>
                <p className="text-xs text-gray-600 mt-1">
                  {nextSchedule!.days_working.length} day{nextSchedule!.days_working.length !== 1 ? 's' : ''} selected
                </p>
              </>
            ) : (
              <>
                <p className={`text-lg font-bold ${scheduleOverdue ? 'text-red-400' : daysLeft <= 2 ? 'text-amber-400' : 'text-white'}`}>
                  {scheduleOverdue ? 'Overdue' : `${daysLeft}d left`}
                </p>
                <p className="text-xs text-gray-500 mt-1">{formatWeekRange(nextMon)}</p>
              </>
            )}
            <p className="text-xs text-violet-500 mt-3">Schedule →</p>
          </a>
        </div>

        {/* ── Expenses ── */}
        {canExpenses && (
          <a
            href="/expenses"
            className={`block rounded-2xl p-4 border transition-colors ${
              (canTeam ? pendingExpCount : myPendingCount) > 0
                ? 'bg-yellow-950/40 border-yellow-800/60 hover:border-yellow-700/60'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Expenses</p>
                {canTeam ? (
                  pendingExpCount > 0 ? (
                    <>
                      <p className="text-xl font-bold text-yellow-400">
                        {pendingExpCount} pending
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        ${pendingExpTotal.toFixed(2)} awaiting approval
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-bold text-white">All clear</p>
                      <p className="text-xs text-gray-600 mt-0.5">No pending expenses</p>
                    </>
                  )
                ) : (
                  myPendingCount > 0 ? (
                    <>
                      <p className="text-xl font-bold text-yellow-400">
                        {myPendingCount} pending
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Awaiting approval</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-bold text-white">All clear</p>
                      <p className="text-xs text-gray-600 mt-0.5">No pending expenses</p>
                    </>
                  )
                )}
              </div>
              <p className="text-xs text-violet-500 mt-1">Expenses →</p>
            </div>
          </a>
        )}

        {/* ── Management section ── */}
        {canTeam && (
          <>
            {/* Flags + Live (2-col) */}
            <div className="grid grid-cols-2 gap-3">
              <a
                href="/flags"
                className={`rounded-2xl p-4 border transition-colors ${
                  flagCount > 0
                    ? 'bg-amber-950 border-amber-800 hover:border-amber-700'
                    : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Open Flags</p>
                <p className={`text-2xl font-bold ${flagCount > 0 ? 'text-amber-400' : 'text-white'}`}>
                  {flagCount}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {flagCount === 0 ? 'All clear' : 'Need review'}
                </p>
                <p className="text-xs text-violet-500 mt-3">Flags →</p>
              </a>

              <a
                href="/map"
                className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-4 transition-colors"
              >
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Live</p>
                <p className="text-2xl font-bold text-white">{clockedInCount}</p>
                <p className="text-xs text-gray-600 mt-1">on the clock</p>
                <p className="text-xs text-violet-500 mt-3">Live Map →</p>
              </a>
            </div>

            {/* Team */}
            <a
              href="/team"
              className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-4 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Team</p>
                  <p className="text-xl font-bold text-white">
                    {teamCount}
                    <span className="text-sm font-normal text-gray-400 ml-1">active members</span>
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {clockedInCount} clocked in now
                  </p>
                </div>
                <p className="text-xs text-violet-500">Team →</p>
              </div>
            </a>
          </>
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
