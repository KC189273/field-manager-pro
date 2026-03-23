// Returns the Monday of the current week
export function currentWeekStart(from = new Date()): Date {
  const d = new Date(from)
  const day = d.getDay() // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// Returns the Monday of the next week
export function nextWeekStart(from = new Date()): Date {
  const curr = currentWeekStart(from)
  curr.setDate(curr.getDate() + 7)
  return curr
}

// Deadline = Friday before next week's Monday (3 days prior)
export function nextWeekDeadline(from = new Date()): Date {
  const next = nextWeekStart(from)
  const deadline = new Date(next)
  deadline.setDate(deadline.getDate() - 3) // Friday
  deadline.setHours(23, 59, 59, 999)
  return deadline
}

// Days until next week's submission deadline
export function daysUntilDeadline(from = new Date()): number {
  const deadline = nextWeekDeadline(from)
  const now = new Date(from)
  const diff = deadline.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

// Whether the next week schedule is past due
export function isScheduleOverdue(from = new Date()): boolean {
  return daysUntilDeadline(from) < 0
}

export function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function dayIndexToName(idx: number): string {
  return DAY_NAMES[idx] ?? ''
}

// Returns date for each day of a week given its Monday
export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
}
