import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { getSession, canViewTeam, canSubmitExpense } from '@/lib/auth'

export const dynamic = 'force-dynamic'
import { query, queryOne } from '@/lib/db'
import NavBar from '@/components/NavBar'
import WelcomeBanner from '@/components/WelcomeBanner'
import PhotoPromptBanner from '@/components/PhotoPromptBanner'

// Cache org-wide aggregate counts for 30s — these change infrequently and are
// safe to serve slightly stale. User-specific data (shift, hours, tasks) is NOT cached.
const getCachedAggregates = unstable_cache(
  async (orgId: string | null, managerId: string, role: string) => {
    const [flagRow, clockedInRow, teamRow, pendingExpRow] = await Promise.all([
      queryOne<{ count: string }>(
        role === 'manager'
          ? `SELECT COUNT(*) as count FROM flags f JOIN users u ON u.id = f.user_id WHERE f.resolved = FALSE AND f.created_at >= NOW() - INTERVAL '7 days' AND u.manager_id = $1`
          : orgId
          ? `SELECT COUNT(*) as count FROM flags f JOIN users u ON u.id = f.user_id WHERE f.resolved = FALSE AND f.created_at >= NOW() - INTERVAL '7 days' AND u.org_id = $1`
          : `SELECT COUNT(*) as count FROM flags WHERE resolved = FALSE AND created_at >= NOW() - INTERVAL '7 days'`,
        role === 'manager' ? [managerId] : orgId ? [orgId] : []
      ).catch(() => null),
      queryOne<{ count: string }>(
        orgId
          ? `SELECT COUNT(*) as count FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.clock_out_at IS NULL AND u.role NOT IN ('developer','owner','sales_director') AND u.org_id = $1`
          : `SELECT COUNT(*) as count FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.clock_out_at IS NULL AND u.role NOT IN ('developer','owner','sales_director')`,
        orgId ? [orgId] : []
      ).catch(() => null),
      queryOne<{ count: string }>(
        orgId
          ? `SELECT COUNT(*) as count FROM users WHERE is_active = TRUE AND role NOT IN ('developer') AND org_id = $1`
          : `SELECT COUNT(*) as count FROM users WHERE is_active = TRUE AND role NOT IN ('developer')`,
        orgId ? [orgId] : []
      ).catch(() => null),
      queryOne<{ count: string; total: string }>(
        orgId
          ? `SELECT COUNT(*) as count, COALESCE(SUM(e.amount), 0)::text as total FROM expenses e JOIN users u ON u.id = e.user_id WHERE e.status = 'pending' AND u.org_id = $1`
          : `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0)::text as total FROM expenses WHERE status = 'pending'`,
        orgId ? [orgId] : []
      ).catch(() => null),
    ])
    return { flagRow, clockedInRow, teamRow, pendingExpRow }
  },
  ['dashboard-aggregates'],
  { revalidate: 30 }
)

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const isEmployee = session.role === 'employee'
  const canTeam = canViewTeam(session.role)
  const canExpenses = canSubmitExpense(session.role)
  const isDev = session.role === 'developer'
  const orgId = (!isDev && session.org_id) ? session.org_id : null

  // Week start (Monday) — only needed for non-employees
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1))
  weekStart.setHours(0, 0, 0, 0)

  // Run queries in parallel — skip non-employee data for employees
  // Fetch cached aggregates in parallel with user-specific queries
  const aggregatesPromise = canTeam ? getCachedAggregates(orgId, session.id, session.role) : Promise.resolve(null)

  const [
    activeShift,
    weekShifts,
    ,  // flagRow — from cache below
    ,  // clockedInRow — from cache below
    ,  // teamRow — from cache below
    ,  // pendingExpRow — from cache below
    myPendingRow,
    upcomingShifts,
    myTasks,
  ] = await Promise.all([
    // Own active shift
    queryOne<{ id: string; clock_in_at: string; clock_in_address: string | null }>(
      `SELECT id, clock_in_at, clock_in_address FROM shifts WHERE user_id = $1 AND clock_out_at IS NULL LIMIT 1`,
      [session.id]
    ).catch(() => null),
    // Own shifts this week (skip for employees — not shown)
    isEmployee
      ? Promise.resolve([] as { duration_seconds: number }[])
      : query<{ duration_seconds: number }>(
          `SELECT EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) as duration_seconds
           FROM shifts WHERE user_id = $1 AND clock_in_at >= $2 ORDER BY clock_in_at DESC`,
          [session.id, weekStart.toISOString()]
        ).catch(() => [] as { duration_seconds: number }[]),
    // Open flags, clocked-in count, team size, pending expenses —
    // served from a 30s cache to avoid hitting DB on every dashboard load
    Promise.resolve(null), // placeholder — replaced below
    Promise.resolve(null),
    Promise.resolve(null),
    Promise.resolve(null),
    // Own pending expenses
    canExpenses
      ? queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM expenses WHERE user_id = $1 AND status = 'pending'`,
          [session.id]
        ).catch(() => null)
      : Promise.resolve(null),
    // Upcoming published scheduled shifts (employees only)
    isEmployee
      ? query<{ shift_date: string; start_time: string; end_time: string; role_note: string | null; store_address: string }>(
          `SELECT ss.shift_date::text, ss.start_time::text, ss.end_time::text, ss.role_note, sl.address AS store_address
           FROM scheduled_shifts ss
           JOIN dm_store_locations sl ON sl.id = ss.store_location_id
           INNER JOIN scheduled_shifts_publish ssp
             ON ssp.store_location_id = ss.store_location_id
             AND ssp.week_start = date_trunc('week', ss.shift_date)::date
           WHERE ss.employee_id = $1
             AND ss.shift_date >= CURRENT_DATE
           ORDER BY ss.shift_date, ss.start_time`,
          [session.id]
        ).catch(() => [] as { shift_date: string; start_time: string; end_time: string; role_note: string | null; store_address: string }[])
      : Promise.resolve([] as { shift_date: string; start_time: string; end_time: string; role_note: string | null; store_address: string }[]),
    // Tasks assigned to me — incomplete and current only
    // "Current" = has a due date not more than 30 days overdue, OR no due date and created within 90 days
    query<{ id: string; title: string; due_date: string | null }>(
      `SELECT t.id, t.title, t.due_date::text
       FROM tasks t
       LEFT JOIN task_completions tc ON tc.task_id = t.id
       WHERE t.assignee_id = $1
         AND tc.task_id IS NULL
         AND (
           (t.due_date IS NULL AND t.created_at >= NOW() - INTERVAL '90 days')
           OR t.due_date >= CURRENT_DATE - INTERVAL '30 days'
         )
       ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
       LIMIT 10`,
      [session.id]
    ).catch(() => [] as { id: string; title: string; due_date: string | null }[]),
  ])

  // Pull aggregate counts from the cached result
  const agg = await aggregatesPromise
  const flagRow = agg?.flagRow ?? null
  const clockedInRow = agg?.clockedInRow ?? null
  const teamRow = agg?.teamRow ?? null
  const pendingExpRow = agg?.pendingExpRow ?? null

  // Derived values
  const clocked = !!activeShift
  const totalSeconds = weekShifts.reduce((s, r) => s + Number(r.duration_seconds), 0)
  const totalHours = (totalSeconds / 3600).toFixed(1)
  const clockedInFor = activeShift
    ? formatDuration((Date.now() - new Date(activeShift.clock_in_at).getTime()) / 1000)
    : null

  const flagCount = parseInt(flagRow?.count ?? '0')
  const clockedInCount = parseInt(clockedInRow?.count ?? '0')
  const teamCount = parseInt(teamRow?.count ?? '0')
  const pendingExpCount = parseInt(pendingExpRow?.count ?? '0')
  const pendingExpTotal = parseFloat(pendingExpRow?.total ?? '0')
  const myPendingCount = parseInt(myPendingRow?.count ?? '0')

  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-2 pb-20 space-y-2 max-w-lg mx-auto">
        <WelcomeBanner role={session.role} />
        <PhotoPromptBanner />

        {/* Greeting */}
        <div>
          <p className="text-gray-400 text-xs">Good {getTimeOfDay()}</p>
          <h1 className="text-xl font-bold text-white">{session.fullName.split(' ')[0]}</h1>
        </div>

        {/* ── Clock hero ── */}
        <a
          href="/clock"
          className={`block rounded-2xl p-4 border transition-colors ${
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
              <p className={`text-xl font-bold mt-0.5 ${clocked ? 'text-green-400' : 'text-gray-500'}`}>
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

        {/* ── Assigned Tasks ── */}
        {myTasks.length > 0 && (
          <a
            href="/tasks"
            className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl overflow-hidden transition-colors"
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-800/60">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">My Tasks</p>
              <p className="text-xs text-violet-500">View all →</p>
            </div>
            <div className="divide-y divide-gray-800/50">
              {myTasks.map(task => {
                const now = new Date()
                const dueDate = task.due_date ? new Date(task.due_date) : null
                const isOverdue = dueDate && dueDate < now
                const isDueToday = dueDate && dueDate.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) === now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
                return (
                  <div key={task.id} className="flex items-center justify-between px-4 py-2 gap-3">
                    <p className="text-sm text-white truncate">{task.title}</p>
                    {dueDate && (
                      <p className={`text-xs shrink-0 font-medium ${isOverdue ? 'text-red-400' : isDueToday ? 'text-amber-400' : 'text-gray-500'}`}>
                        {isOverdue ? '⚠ ' : ''}{fmtDueShort(dueDate)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </a>
        )}

        {session.role === 'employee' ? (
          <>
            {/* ── Employee: upcoming schedule (read-only) ── */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="flex items-center px-4 pt-3 pb-2 border-b border-gray-800/60">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Upcoming Shifts</p>
              </div>
              {upcomingShifts.length === 0 ? (
                <div className="px-4 py-3">
                  <p className="text-sm text-gray-500">No upcoming shifts posted yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800/50">
                  {upcomingShifts.slice(0, 4).map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2">
                      <div>
                        <p className="text-sm font-medium text-white">{formatShiftDate(s.shift_date)}</p>
                        <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[180px]">{s.store_address}</p>
                        {s.role_note && <p className="text-xs text-violet-400 mt-0.5">{s.role_note}</p>}
                      </div>
                      <p className="text-xs text-gray-400 shrink-0 ml-3">
                        {fmtShiftTime(s.start_time)} – {fmtShiftTime(s.end_time)}
                      </p>
                    </div>
                  ))}
                  {upcomingShifts.length > 4 && (
                    <div className="px-4 py-2">
                      <p className="text-xs text-gray-600">+{upcomingShifts.length - 4} more shifts</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Employee: checklist link ── */}
            <a
              href="/checklist"
              className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-4 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Daily Tasks</p>
                  <p className="text-base font-bold text-white">Opening / Closing</p>
                  <p className="text-xs text-gray-500 mt-0.5">Checklist</p>
                </div>
                <p className="text-xs text-violet-500">View →</p>
              </div>
            </a>
          </>
        ) : (
          <>
            {/* ── This week ── */}
            <a
              href="/timecards"
              className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-3 transition-colors"
            >
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">This Week</p>
              <p className="text-xl font-bold text-white">
                {totalHours}
                <span className="text-sm font-normal text-gray-400 ml-1">hrs</span>
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {weekShifts.length} shift{weekShifts.length !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-violet-500 mt-2">Timecards →</p>
            </a>

            {/* ── Store Scheduling (DM and above only) ── */}
            <a
              href="/staff-schedule"
              className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-3 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Store Scheduling</p>
                  <p className="text-base font-bold text-white">Manage Shifts</p>
                  <p className="text-xs text-gray-600 mt-0.5">View and edit store schedules</p>
                </div>
                <p className="text-xs text-violet-500 shrink-0 ml-3">Schedule →</p>
              </div>
            </a>

            {/* ── Expenses ── */}
            {canExpenses && (
              <a
                href="/expenses"
                className={`block rounded-2xl p-3 border transition-colors ${
                  (canTeam && session.role !== 'manager' ? pendingExpCount : myPendingCount) > 0
                    ? 'bg-yellow-950/40 border-yellow-800/60 hover:border-yellow-700/60'
                    : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Expenses</p>
                    {canTeam && session.role !== 'manager' ? (
                      pendingExpCount > 0 ? (
                        <>
                          <p className="text-lg font-bold text-yellow-400">{pendingExpCount} pending</p>
                          <p className="text-xs text-gray-500 mt-0.5">${pendingExpTotal.toFixed(2)} awaiting approval</p>
                        </>
                      ) : (
                        <>
                          <p className="text-lg font-bold text-white">All clear</p>
                          <p className="text-xs text-gray-600 mt-0.5">No pending expenses</p>
                        </>
                      )
                    ) : (
                      myPendingCount > 0 ? (
                        <>
                          <p className="text-lg font-bold text-yellow-400">{myPendingCount} pending</p>
                          <p className="text-xs text-gray-500 mt-0.5">Awaiting approval</p>
                        </>
                      ) : (
                        <>
                          <p className="text-lg font-bold text-white">All clear</p>
                          <p className="text-xs text-gray-600 mt-0.5">No pending expenses</p>
                        </>
                      )
                    )}
                  </div>
                  <p className="text-xs text-violet-500 mt-1">Expenses →</p>
                </div>
              </a>
            )}

            {/* ── Management: Flags + Live (2-col) ── */}
            {canTeam && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href="/flags"
                    className={`rounded-2xl p-3 border transition-colors ${
                      flagCount > 0
                        ? 'bg-amber-950 border-amber-800 hover:border-amber-700'
                        : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Open Flags</p>
                    <p className={`text-xl font-bold ${flagCount > 0 ? 'text-amber-400' : 'text-white'}`}>
                      {flagCount}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {flagCount === 0 ? 'All clear' : 'Need review'}
                    </p>
                    <p className="text-xs text-violet-500 mt-2">Flags →</p>
                  </a>

                  <a
                    href="/map"
                    className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-3 transition-colors"
                  >
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Live</p>
                    <p className="text-xl font-bold text-white">{clockedInCount}</p>
                    <p className="text-xs text-gray-600 mt-0.5">on the clock</p>
                    <p className="text-xs text-violet-500 mt-2">Live Map →</p>
                  </a>
                </div>

                {/* Team */}
                <a
                  href="/team"
                  className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-3 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Team</p>
                      <p className="text-lg font-bold text-white">
                        {teamCount}
                        <span className="text-sm font-normal text-gray-400 ml-1">active members</span>
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">{clockedInCount} clocked in now</p>
                    </div>
                    <p className="text-xs text-violet-500">Team →</p>
                  </div>
                </a>
              </>
            )}
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

function formatShiftDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtDueShort(d: Date): string {
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'America/Chicago' })
  const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/Chicago' })
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${month} ${day} ${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtShiftTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}
