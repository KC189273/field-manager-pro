---
sources:
  - app/api/flags/route.ts
  - app/flags/page.tsx
  - app/api/clock/in/route.ts
  - app/api/clock/out/route.ts
  - app/api/clock/break/route.ts
  - app/api/gps/breadcrumb/route.ts
  - app/api/cron/auto-clockout/route.ts
  - app/api/time-off/route.ts
  - app/api/dm-store-visits/route.ts
features:
  - flags
  - late-clock-in-flag
  - overtime-flag
  - flag-deduplication
permissions:
  - "manager+ view"
  - "employees cannot see"
  - "auto-created on late/OT"
verified: 2026-09-01
---
# Flags

## What are flags?
Flags are alerts that highlight issues requiring management attention. Some are created automatically by the system, others manually by DMs.

## Automatic flag types:
- **Late Clock-In**: created when an employee clocks in after their scheduled start time. Shows exactly how many minutes late.
- **Overtime**: created when an employee's net hours exceed 40 in a week (on clock-out). Shows total hours logged.

- **Missing Clock-In Photo**: created when an employee clocks in without a uniform photo (when photo requirement is enabled).
- **Break Long**: created when a break exceeds 45 minutes.
- **Break Multiple**: created when an employee takes 2+ breaks in a single shift.
- **Geofence Exit**: created when an employee is auto-clocked out for leaving the store geofence.
- **Auto Clock-Out**: created when an employee is auto-clocked out at 9:00 PM CST by the nightly cron job.
- **Time Off Request**: created when an employee submits a time-off request, so it appears in the approver's flags list.
- **Visit Without Coaching**: created when a DM submits a quick store visit without including coaching.

These flags are created by the system — no one manually creates them.

## Deduplication
All automatic flags are deduplicated before insertion. If a flag of the same type already exists for the same shift (or same user + type + date when there is no shift), the system skips creating a duplicate. This prevents resolved flags from being re-created.

## Manual flags:
DMs and above can create flags manually to document performance issues or other concerns.

## Who can see flags?
| Role | Can see |
|------|---------|
| Employee | Cannot see the Flags page |
| DM (manager) | Flags for their direct reports |
| Field Leader / Ops Manager | All flags in the org |
| SD, Owner, Developer | All flags |

## Can flags be resolved?
Yes. DMs and above can mark a flag as resolved. The flag remains in history but is no longer shown in the active flags count on the dashboard.

## Why does the dashboard show a flag count?
The dashboard shows the number of unresolved flags from the last 7 days. For DMs, this is scoped to their team. For SD/Owner, it's org-wide.
