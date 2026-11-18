---
sources:
  - app/api/workforce/route.ts
  - app/api/workforce/employee/route.ts
  - app/workforce/page.tsx
  - app/api/payroll/lock/route.ts
  - app/api/cron/payroll-autolock/route.ts
features:
  - workforce-hub
  - timecard-autolock
  - timecard-unlock
permissions:
  - "DMs see their own district only"
  - "Ops+, SD, Owner, Developer see full org with market drill-down"
  - "Time edit available for DM+ with appropriate permissions"
verified: 2026-11-18
---
# Workforce Hub

## What is the Workforce page?
A comprehensive drill-down dashboard that shows scheduling, staffing, and time data across the entire organization. Available from the More menu → Workforce.

## Who can see it?
- **DMs**: See their own district (their stores and direct reports only)
- **Ops Managers, Field Leaders, SD, Owner, Developer**: See full org with market-level drill-down

## How does the drill-down work?
The page has 5 levels, each showing progressively more detail:

1. **Org Level** — Summary cards (stores open, scheduled hours, time exceptions) + DM table showing worked/scheduled per day
2. **Market Level** — Same view filtered to one market (Milwaukee, Iowa, Illinois, Minnesota). Markets are auto-detected from store addresses.
3. **DM Level** — Store table showing staffing per day per store for that DM
4. **Store Level** — Employee schedule grid showing each employee's shifts for the week
5. **Employee Level** — Individual day-by-day breakdown with scheduled vs worked times, coworkers on shift

## Navigation
- **Filter dropdowns** at the top: Market → DM → Store → Employee (cascading)
- **Search bar**: Find any employee, store, or DM by name
- **Breadcrumb trail**: Click any level to go back
- **Week navigation**: Arrow buttons to move between weeks, "Today" button to return to current week
- Click any row in a table to drill down one level

## Time Edit
From any level, click an employee and their shifts. On the Employee Level view, each shift has an "Edit Time" button that opens an inline editor to adjust clock in/out times with a required reason note. This respects all existing permission logic (DMs can edit their team, ops+ can edit anyone, locked period bypass for ops+).

## Summary Cards
Shown at every level, scoped to the current filter:
- **Stores Open** — X of Y (Z closed today)
- **Scheduled Hours** — Total scheduled hours + employee count
- **Time Exceptions** — Manual entries count

## Timecard Auto-Lock
Timecards automatically lock every **Sunday at 8 PM CST**. DMs no longer need to manually submit — the system locks for all DMs automatically.

- DMs receive a push notification when their timecards are locked
- Ops Managers and Owners are notified that timecards have been locked
- After lock, DMs cannot edit timecards for that period

## Unlock/Lock Controls (Ops Manager, Owner, Developer)
On the Payroll page, Ops Managers can:
- **Unlock All Timecards** — Unlocks all DMs for the current period (amber button)
- **Lock All Timecards** — Re-locks all DMs for the current period
- **Per-DM Unlock** — Unlock button next to each DM in the review list

When unlocked, DMs and managers can edit timecards again. The ops manager can re-lock when done.

## How do I edit time for an employee?
1. Go to **Workforce** from the nav
2. Drill down to the employee (use search or click through Market → DM → Store → Employee)
3. Find the shift you want to edit
4. Click **Edit Time**
5. Adjust the clock in/out times
6. Enter a reason (required)
7. Click **Save Edit**

## What happened to the DM "Lock & Submit" button?
It was removed. Timecards now auto-lock at 8 PM CST every Sunday. DMs should review their team's hours before Sunday evening. If edits are needed after the lock, contact the Ops Manager to unlock.
