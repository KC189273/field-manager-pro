---
sources:
  - app/api/dm-schedule/route.ts
  - app/dm-schedule/page.tsx
features:
  - dm-schedule
  - weekly-planning
  - copy-last-week
  - today-summary
permissions:
  - "DMs view and edit their own schedule"
  - "ops_field_leader/ops_manager/SD/owner/dev view all DMs"
verified: 2026-09-13
---
# DM Schedule

## What is the DM Schedule?
A weekly planner where DMs plan which stores they'll visit each day, with reasons for each visit. Leadership uses it to see where DMs are working.

## How do DMs fill out their schedule?
1. Go to **More menu → DM Schedules**.
2. Tap **Edit Schedule** to enter edit mode.
3. For each day:
   - Toggle **Working/Off** with the button on the right.
   - Select a store from the dropdown and type a visit reason.
   - Tap **+ Add Store Visit** to add additional stores for that day.
   - Tap the X to remove a store visit.
4. Tap **Save Schedule** when done.

## Can I copy last week's schedule?
Yes. Tap **Copy Last Week** next to the Edit Schedule button. It pre-fills your current week with last week's plan. You can then adjust individual days before saving.

## What is the Today summary?
When you open DM Schedules, a card at the top shows your plan for today — which stores you're visiting and why. This gives you a quick reference without scrolling through the full week.

## Who can see my schedule?
- **You** see only your own schedule.
- **Field Leaders, Ops Managers, Owners, Sales Directors, Developers** see all DMs. They have a Today tab (who's working where today) and a Weekly View tab with DM filter chips.

## What about My Schedule?
My Schedule shows your clock-in/clock-out shifts. It is NOT where you plan store visits. If you are a DM and go to My Schedule, a banner will redirect you to DM Schedules for planning.

## Can I plan multiple stores in one day?
Yes. Each day supports multiple store visits. Tap **+ Add Store Visit** to add as many as you need.

## Can I edit or delete a visit after saving?
Yes. Tap **Edit Schedule** and you'll see your saved visits. Change stores, update reasons, remove visits with the X button, or toggle days off. Save again when done.
