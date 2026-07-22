---
sources:
  - app/api/dm-schedule/route.ts
  - app/dm-schedule/page.tsx
features:
  - dm-schedule
  - auto-save
  - blur-save
permissions:
  - "DMs edit own"
  - "SD/owner/dev view all"
verified: 2026-07-22
---
# DM Schedule

## What is the DM Schedule?
A weekly planner where DMs plan which stores they'll visit each day, with reasons for each visit. This is separate from the employee schedule — it's the DM's own field plan.

## How do I fill out my schedule?
1. Go to **DM Schedule** from the nav.
2. You'll see Monday through Sunday.
3. For each day, toggle whether you're working.
4. Tap **Add Location** to add a store visit.
5. Select the store from the dropdown.
6. Type your reason/plan for visiting that store (e.g., "Go over MIM gaps with Chris").
7. Repeat for additional stores that day.

## How does saving work?
- **Store selection** saves automatically after 2 seconds.
- **Notes/reasons** save when you tap out of the text field (on blur). If you type a note and immediately navigate away without tapping out, it may not save.
- There is also a **Save** button you can tap manually to force a save.
- A "Saved" indicator appears briefly when the save completes.

**Tip:** After typing your reason, tap on a different field or area of the screen before navigating to another week. This ensures the note is saved.

## Can I plan multiple weeks ahead?
Yes. Use the arrow buttons to navigate to future weeks and fill in your schedule in advance.

## Who can see my DM Schedule?
| Role | Can see |
|------|---------|
| DM (manager) | Their own schedule only |
| Sales Director | All DMs' schedules |
| Owner | All DMs' schedules |
| Developer | All DMs' schedules |

The SD/Owner view includes a dropdown to filter by specific DM.

## Why did my schedule entries disappear?
If your stores and notes didn't save, you may have navigated to a different week too quickly. The auto-save fires when you tap out of the reason field. If you switch weeks before tapping out, the save may not have completed. Always wait for the "Saved" indicator or tap the Save button before changing weeks.
