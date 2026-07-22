---
sources:
  - app/settings/page.tsx
  - app/api/push/preferences/route.ts
  - lib/apns.ts
features:
  - notification-toggles
  - push-setup
permissions:
  - "25 toggle types"
  - "role-filtered preferences"
verified: 2026-07-22
---
# Notifications

## How do I manage my notifications?
Go to **Settings** from the nav. Scroll down to the notification toggles. Each toggle controls a specific type of notification.

## Available notification toggles by role:

### Everyone (all retail roles):
- **Task Assigned** — when a task is assigned to you
- **Schedule Published** — when your weekly schedule is published (employees and DMs)
- **Time Off Requests** — submissions and approval decisions
- **Shift Swaps** — swap requests and approvals
- **Clock Events** — clock reminders, auto-clockout, OT warnings

### Managers (DMs) and above:
- **Task Completed** — when someone completes a task you assigned
- **Schedule Changes** — schedule reminders, overstaffing alerts
- **Checklists** — opening/closing checklist submissions (DMs only)
- **Accountability Docs** — new docs, approvals, escalations
- **Overtime Flags** — when employees hit overtime thresholds
- **Supply Requests** — supply orders and escalations
- **Facility Tickets** — maintenance requests and updates
- **Termination Notices** — management copy emails for termination notices

### SD / Owner / Developer:
- **DM End-of-Day Recaps** — AI-generated daily recap when each DM clocks out
- **Morning Digest** — daily morning summary email
- **Weekly Report** — end-of-week summary report
- **Payroll Report** — weekly payroll Excel spreadsheet email
- **Payroll** — payroll reminders and approval requests
- **Expense Submitted** — expense submissions for approval (SD/Owner/Ops)
- **DM Clock-Out Alerts** — push notification when a DM clocks out
- **DM Tomorrow's Focus** — copy of AI coaching suggestions sent to DMs
- **Weekly Coaching Insights** — AI coaching insights email sent Sundays

### Developer only:
- **App Health / Ops Alerts** — daily ops check email and health push notifications
- **DB Health Report** — monthly database health report
- **Monthly Expense Report** — monthly expense Excel email

## Push Notifications Setup
1. When first opening the app, allow push notifications when prompted.
2. If you missed the prompt:
   - **iOS**: Settings > Notifications > Field Manager Pro > Allow Notifications
   - **Android**: Settings > Apps > Field Manager Pro > Notifications > Enable

## Email Notifications
Most alert types also send companion emails. Toggle individual types in Settings to control which emails you receive.

## I'm getting too many notifications
Go to Settings and turn off the specific notification types you don't need. You can keep push on but turn off individual event types (e.g., turn off "Supply Requests" if you don't handle supplies).

## I'm not getting any notifications
1. Check Settings in the app — make sure the toggle for that notification type is ON.
2. Check your phone's notification settings for Field Manager Pro.
3. On Android, make sure the app is not in battery optimization / restricted mode.
4. Try logging out and back in to re-register for push notifications.
