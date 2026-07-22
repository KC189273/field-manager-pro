---
sources:
  - app/api/clock/out/route.ts
  - app/api/ot-watch/route.ts
  - app/api/cron/ot-tracker/route.ts
features:
  - overtime-alerts
  - ot-thresholds
  - salary-exemption
  - floater-ot
permissions:
  - "40h flag to DM"
  - "45h projected to SD"
  - "50h projected to owner"
  - "salary employees exempt"
verified: 2026-07-22
---
# Overtime Alerts

## How does overtime tracking work?
The system tracks overtime at multiple thresholds:

### On clock-out (automatic):
- **40+ hours/week (net)**: An **overtime flag** is created. Your DM and org leadership receive email and push notification alerts.
- **45+ hours projected**: Your DM gets a push notification saying "SD APPROVAL NEEDED." The projection includes worked hours + remaining scheduled hours for the week.
- **50+ hours projected**: The owner gets a push notification saying "OWNER APPROVAL NEEDED."

### Salary employees:
Employees with `pay_type = salary` are exempt from overtime checks. No flags or alerts are created for salaried employees on clock-out.

### Floaters:
Floater OT alerts go to ALL DMs (not just the assigned DM), since floaters work across districts.

## Who gets OT notifications?
| Threshold | Who is notified |
|-----------|----------------|
| 40h actual | DM + ops managers + SD + owner (email + push) |
| 45h projected | DM (push), SD if actual is 45+ |
| 50h projected | DM (push), Owner if actual is 50+ |

## OT Watch panel
On the **Timecards** page, DMs see an **OT Watch** section showing:
- Each employee's worked hours this week
- Remaining scheduled hours
- Projected total
- Floaters are included and labeled with a "Floater" badge

This helps DMs proactively manage schedules before employees hit overtime.

## Why did I get an OT alert?
Check the employee's weekly hours on the Timecards page. The alert is based on their actual hours worked plus their remaining scheduled shifts for the week. If the projection exceeds 45h, the system sends the alert automatically on clock-out.

To prevent overtime: adjust the employee's schedule for the remaining days of the week, or get approval from the SD/Owner as required.
