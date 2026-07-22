---
sources:
  - app/api/cron/auto-clockout/route.ts
features:
  - auto-clockout
permissions:
  - "runs 9 PM CST daily"
  - "all active shifts auto-ended"
verified: 2026-07-22
---
# Auto Clock-Out — "Why was I automatically clocked out?"

## Symptom
You open the app and find you're no longer clocked in, or you see a shift on your timecard that ended at exactly 9:00 PM with the note "Auto clocked out at 9:00 PM CST."

## Why It Happens
The system runs an automatic clock-out every night at **9:00 PM CST** (3:00 AM UTC). Any employee still clocked in at that time is automatically clocked out. This is a safety net to prevent shifts from running overnight due to forgotten clock-outs.

When auto-clockout triggers:
1. Your shift is ended with clock-out time set to 9:00 PM CST.
2. The note "Auto clocked out at 9:00 PM CST" is added to the shift.
3. An `auto_clock_out` flag is created on your record.
4. Your DM receives a push notification: "[Your name] was automatically clocked out at 9:00 PM CST. Please review and adjust if needed."
5. You receive a push notification: "You were automatically clocked out at 9:00 PM. Please contact your manager if your hours need adjustment."
6. Any active break is ended before the clock-out.

## How to Fix
- **If you actually worked past 9 PM:** Contact your DM. They can edit your timecard to set the correct clock-out time (with a reason note required).
- **If you forgot to clock out:** The 9 PM time is probably close enough, or your DM can adjust it to when you actually left.
- **To prevent this:** Always clock out when you leave. Set a reminder if needed.

## When to Report as a Bug
If you were auto-clocked out significantly before 9 PM CST, or if auto-clockout fires on a day you weren't working, that's a bug. Report it with the date and your actual schedule.
