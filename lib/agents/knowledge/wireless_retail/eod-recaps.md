---
sources:
  - lib/dm-eod-recap.ts
  - app/api/clock/out/route.ts
features:
  - eod-recaps
  - gps-store-visit-times
permissions:
  - "generated on DM clock-out"
  - "ops+ can toggle notification preference"
verified: 2026-07-22
---
# AI End-of-Day Recaps

## What is the EOD Recap?
When a DM clocks out, the system automatically generates an AI-powered summary email of their day. It includes:
- A narrative recap of the day's activities
- GPS store visit tracking: which stores were visited, arrival time, departure time, and time spent at each store
- An Excel attachment with detailed data

## How are store visits calculated?
The system analyzes GPS breadcrumbs from the DM's shift:
1. **Stop detection**: identifies locations where the DM stayed within a 300-foot radius for 30+ minutes.
2. **Store matching**: matches each stop to known store locations within 500 feet.
3. The result is a table showing: Store | Arrived | Left | Time at Store | Total

## Who receives the EOD Recap?
- The **DM** who clocked out receives it directly.
- **Ops managers, SD, Owner, Developer** can receive copies if they have the "DM End-of-Day Recaps" notification preference enabled in Settings.

## Can I turn it off?
The recap always generates for the DM on clock-out. Leadership can toggle the "DM End-of-Day Recaps" notification in **Settings > Notifications** to stop receiving copies.

## Why doesn't my recap show any store visits?
- Your GPS may not have been tracking during your shift. Check that Location Services are enabled.
- You may not have stayed at any store long enough (30+ minutes within 300 feet) for a "stop" to register.
- The stores must be in the system with GPS coordinates for matching to work.
