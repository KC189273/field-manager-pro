---
sources:
  - app/api/clock/in/route.ts
  - app/api/clock/out/route.ts
  - app/api/gps/breadcrumb/route.ts
  - app/clock/page.tsx
  - app/api/clock/my-stores/route.ts
features:
  - clock-in
  - clock-out
  - gps-tracking
  - geofencing
  - auto-clockout-geofence
  - handoff-notes
  - late-clock-in-flag
permissions:
  - "all retail roles can clock in/out"
  - "employees must select a store"
  - "employees must be within 300 feet of selected store to clock in"
  - "DMs and above are exempt from geofence check"
  - "late clock-in flag has no grace period"
verified: 2026-08-07
---
# Clock In / Clock Out

## How do I clock in?
1. Tap **Clock** from the bottom nav or dashboard.
2. Select your **store location** from the dropdown. This is required.
3. Tap **Clock In**. Your GPS location and time are recorded automatically.
4. You'll see a confirmation with your clock-in time and store.

**Geofencing:** You must be within **300 feet** of the store you selected to clock in. If you're too far away, you'll see a message showing how far you are. Move closer and try again. GPS must be enabled — if location can't be determined, clock-in is blocked.

> DMs, SDs, owners, and ops managers are **not** subject to the geofence check.

## How do I clock out?
1. Tap **Clock** from the bottom nav.
2. Optionally enter a **Handoff Note** — a message that gets pushed to your DM instantly. Use it to flag anything the next shift needs to know.
3. Tap **Clock Out**. Your shift duration is calculated automatically.

## What happens on clock-out?
Several things happen automatically when you clock out:
- Any active break is ended automatically.
- If you're an **employee** and your projected weekly hours are 45+, your DM gets an OT alert push notification. At 50+, the owner gets notified too.
- If you're a **DM**, an AI End-of-Day Recap email is generated and sent to you and your leadership.
- If your weekly hours exceed 40, an overtime flag is created and your DM is emailed.

## Auto clock-out (geofence exit)
If you leave your store's geofence (300 feet) for more than **10 consecutive minutes**, the system will automatically clock you out. When this happens:
- You'll get a push notification telling you that you were auto clocked out.
- Your DM also gets notified.
- A `geofence_exit` flag is created showing how far you were and how long you were outside.
- Any active break is ended automatically.

This only applies to **employees**. DMs and above are not monitored.

## Why does it say "Already clocked in"?
You have an active shift that hasn't been clocked out. You can only have one active shift at a time. Go to Clock and tap Clock Out first, then clock in again.

## Why did I get flagged for being late?
If you have a scheduled shift and you clock in after the scheduled start time, the system automatically creates a `late_clock_in` flag. The flag shows exactly how many minutes late you were (e.g., "clocked in at 9:03 AM, scheduled for 9:00 AM (3 min late)"). This is automatic — your DM didn't manually create it.

**There is no grace period.** Even 1 minute late creates a flag. The comparison is exact: your clock-in time vs. your scheduled start time.

## What is a handoff note?
When clocking out, you can type a short note in the Handoff Note field. This sends an instant push notification to your DM with your message. Use it for things like "register 2 is acting up" or "we're low on SIM cards."

## I can't see the store dropdown / no stores listed
Your DM needs to assign stores to your district. Contact your DM or the SD to make sure stores are set up in Store Locations.

## GPS isn't working
1. Open your phone's Settings.
2. Find Field Manager Pro in the app list.
3. Make sure **Location** is set to "Always" or "While Using."
4. On Android, also check that Location Services are turned on globally.
5. Try closing and reopening the app.

GPS is **required** for employees to clock in (needed for geofence verification). If your device can't get a GPS fix, you won't be able to clock in until location is available.

## "You are too far from the store"
This means your GPS location is more than 300 feet from the store you selected. Common causes:
- You selected the wrong store — double-check the dropdown.
- GPS is inaccurate indoors — try stepping outside briefly and retrying.
- You're genuinely not at the store yet — move closer and try again.
The error message shows your exact distance from the store in feet.
