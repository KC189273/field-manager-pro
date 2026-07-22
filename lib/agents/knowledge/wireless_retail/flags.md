---
sources:
  - app/api/flags/route.ts
  - app/flags/page.tsx
  - app/api/clock/in/route.ts
  - app/api/clock/out/route.ts
features:
  - flags
  - late-clock-in-flag
  - overtime-flag
permissions:
  - "manager+ view"
  - "employees cannot see"
  - "auto-created on late/OT"
verified: 2026-07-22
---
# Flags

## What are flags?
Flags are alerts that highlight issues requiring management attention. Some are created automatically by the system, others manually by DMs.

## Automatic flag types:
- **Late Clock-In**: created when an employee clocks in after their scheduled start time. Shows exactly how many minutes late.
- **Overtime**: created when an employee's net hours exceed 40 in a week (on clock-out). Shows total hours logged.

These flags are created by the system — no one manually creates them.

## Manual flags:
DMs and above can create flags manually to document performance issues or other concerns.

## Who can see flags?
| Role | Can see |
|------|---------|
| Employee | Cannot see the Flags page |
| DM (manager) | Flags for their direct reports |
| Ops Manager | All flags in the org |
| SD, Owner, Developer | All flags |

## Can flags be resolved?
Yes. DMs and above can mark a flag as resolved. The flag remains in history but is no longer shown in the active flags count on the dashboard.

## Why does the dashboard show a flag count?
The dashboard shows the number of unresolved flags from the last 7 days. For DMs, this is scoped to their team. For SD/Owner, it's org-wide.
