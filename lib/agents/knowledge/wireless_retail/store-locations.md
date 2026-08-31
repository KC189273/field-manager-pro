---
sources:
  - app/api/dm-store-locations/route.ts
  - app/api/cron/unmanned-store/route.ts
  - app/store-locations/page.tsx
features:
  - store-locations
  - store-hours
  - unmanned-store-alerts
permissions:
  - "owner/SD/developer can manage stores"
  - "DMs see assigned stores only"
  - "employees cannot see store list"
verified: 2026-08-31
---
# Store Locations

## What is the Store Locations page?
The Store Locations page (`/store-locations`) lets owners and developers manage all store locations. It's accessible from the More menu.

## Who can access it?
- **Owner, Sales Director, Developer**: Full access — add, edit, deactivate stores, set hours
- **DMs**: Cannot access the page (they see their assigned stores elsewhere)
- **Employees**: No access

## Features
- **Add Store**: Enter address, GPS coordinates auto-detected via Mapbox
- **Edit Store**: Update address, employee capacity, GPS coordinates, and store hours
- **Deactivate/Reactivate**: Soft-delete stores without losing data
- **Bulk Geocode**: Button to auto-detect GPS for all stores missing coordinates
- **Search**: Filter stores by address

## Store Hours
Each store has configurable hours per day of the week (Sun-Sat). Defaults: Mon-Sat 10 AM - 7 PM, Sun 12 PM - 5 PM. Individual days can be marked as closed.

Store hours are used by the **Unmanned Store Alert** system.

## Unmanned Store Alerts
An automated check runs every 30 minutes. If a store has no one clocked in during its scheduled open hours (with a 15-minute grace period after opening), an alert is sent:
- **Push notification** to the assigned DM and leadership (field leaders, ops managers, owners, developers)
- **Email** to the same group with store details
- **2-hour cooldown** per store to prevent repeated alerts
- Only fires for stores that are active, have hours set for the current day, and are not marked closed

## GPS & Geofencing
Store GPS coordinates are required for geofencing (clock-in radius enforcement). When adding a store, coordinates are auto-detected from the address. If geofencing is enabled in Settings, employees must be within the configured radius to clock in.
