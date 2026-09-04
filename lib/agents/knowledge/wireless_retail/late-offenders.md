---
sources:
  - app/api/reports/late-offenders/route.ts
  - app/dm-engagement/page.tsx
  - app/dashboard/page.tsx
features:
  - late-offenders-dashboard
permissions:
  - "DMs see their own team's late offenders"
  - "ops_field_leader/ops_manager/owner/developer see all employees"
verified: 2026-09-04
---
# Late Offenders Dashboard

## What is the Late Offenders dashboard?
A tab in DM Engagement that shows employees with repeat late clock-ins. It helps leadership identify patterns and track accountability progression.

## Who can see it?
DMs, Field Leaders, Ops Managers, Owners, Sales Directors, and Developers. DMs see only their direct reports. Leadership sees all employees with a DM filter dropdown.

## Where is it?
- **DM Engagement → Late tab** — full detailed view
- **Dashboard → Flags card** — shows a "X repeat late" badge linking to the Late tab

## What does it show?
Each employee row displays:
- **Employee name** with a late count badge (yellow for 2-3, red for 4+)
- **DM name** — who manages this employee
- **Average minutes late** across all late clock-ins in the period
- **DM time edits** — how many times the DM edited this employee's time (could indicate the DM is covering for lates)
- **Last accountability doc level** — Documented, Verbal, Written, or Final
- **Next recommended level** — what the next accountability step should be

## How do I drill into details?
Tap any employee row to expand it. The detail view shows:
- Every individual late clock-in date and details
- Every DM time edit with before/after times and notes

## What time period does it cover?
Configurable: 7, 30, 60, or 90 days. Default is 30 days.

## What counts as a repeat offender?
An employee needs **2 or more** late clock-in flags in the selected period to appear on this list. Late clock-ins have a 5-minute grace period — only employees clocking in more than 5 minutes after their scheduled time get flagged.

## What are the accountability levels?
The system tracks a progression: **Documented Conversation → Verbal → Written → Final**. The dashboard shows where each employee currently is and recommends the next level.
