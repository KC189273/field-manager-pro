---
sources:
  - app/api/shifts/route.ts
  - app/timecards/page.tsx
features:
  - timecards
  - time-corrections
  - edit-history
  - dm-edit-activity
permissions:
  - "employees view own only"
  - "DMs view/edit team but not own"
  - "SD+ edit any including locked"
  - "floaters filtered by manager_id"
verified: 2026-07-22
---
# Timecards

## How do I view my hours?
Go to **Timecards** from the nav. You'll see a weekly view with:
- Each day's shift(s) with clock-in and clock-out times
- Gross hours, break deductions, and net hours
- Store location for each shift
- A weekly total at the top

Use the arrow buttons to navigate between weeks.

## How are hours calculated?
- **Gross Time** = clock-out minus clock-in
- **Break Deducted** = total break time (all breaks summed)
- **Net Hours** = gross time minus breaks — this is your payroll time
- **Overtime** = anything over 40 net hours per week

## Can I edit my own timecard?
**No.** Employees cannot edit their own timecards. If you see an error in your hours, contact your DM.

**DMs also cannot edit their own timecards.** If a DM tries to edit their own shift, they'll see: "DMs cannot adjust their own timecards. Please contact your Sales Director to make changes."

## Who can edit timecards?
| Role | Can edit |
|------|---------|
| Employee | Their own: No |
| DM (manager) | Their team's: Yes (with a note required). Their own: No |
| Sales Director | Anyone's: Yes (even after DM locks timecards for payroll) |
| Owner | Anyone's: Yes |
| Developer | Anyone's: Yes |

## What does "Corrected" mean on a timecard?
A shift marked "⚠ Corrected" was edited after the original clock-in/out. The edit shows:
- Who made the correction
- The reason note they provided
- If edit history tracking is active: the original time vs. the new time, and the hour difference (+/-)

## How do I correct an employee's timecard? (DMs)
1. Go to **Timecards** and find the employee.
2. Tap on the shift you need to correct.
3. Tap the **Edit** button (pencil icon).
4. Adjust the clock-in and/or clock-out time.
5. Enter a **reason note** — this is required.
6. Save. The employee receives an email notification about the correction.

## Why can't I see a floater's timecard?
See the **Floater Timecards** help doc for the full explanation. In short: timecards are filtered by `manager_id`. If the floater is assigned to a different DM, you won't see their timecard. The SD needs to change the floater's manager assignment on the Team page.

## DM Edit Activity (SD and above)
The timecards page includes a collapsible **DM Edit Activity** section visible to SD, owner, ops manager, and developer. It shows how many time corrections and manual entries each DM made during the selected week, including net hours added or removed.
