---
sources:
  - app/api/map/route.ts
  - app/api/map/live/route.ts
  - app/api/gps/breadcrumb/route.ts
  - app/map/page.tsx
features:
  - live-map
  - gps-breadcrumbs
  - store-visit-detection
permissions:
  - "SD/owner/developer only"
verified: 2026-07-22
---
# Live Map & GPS Tracking

## What is the Live Map?
A real-time map showing the GPS locations of all currently clocked-in employees. It refreshes every 10 seconds.

## Who can see the Live Map?
Only **Sales Directors, Owners, and Developers**. DMs, ops managers, and employees cannot see the Live Map.

If you don't see "Map" in your nav, it's because your role doesn't have access.

## How does GPS tracking work?
When an employee clocks in:
1. Their GPS coordinates are recorded at clock-in.
2. GPS breadcrumbs are tracked throughout their shift (the app periodically sends location updates).
3. GPS coordinates are recorded again at clock-out.

This data is used for:
- The Live Map
- Store visit detection (matching GPS stops to store locations)
- DM End-of-Day Recap emails (showing which stores were visited and for how long)

## How does store visit detection work?
The system looks at GPS breadcrumbs during a shift and identifies "stops" — locations where someone stayed within a 300-foot radius for 30+ minutes. Those stops are matched to known store locations within 500 feet. This shows up in EOD recap emails as a table of stores visited with arrival time, departure time, and duration.

## GPS isn't working on my phone
1. Go to your phone's **Settings > Privacy > Location Services**.
2. Find **Field Manager Pro** and set it to **Always** (iOS) or **Allow all the time** (Android).
3. Make sure Location Services are turned on globally.
4. If using Android, also check that **Google Location Accuracy** (or similar) is enabled.
5. Restart the app.

GPS accuracy can vary indoors or in areas with poor signal. The app records whatever coordinates are available.
