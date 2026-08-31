---
sources:
  - app/employee-record/page.tsx
  - app/api/employee-record/route.ts
  - app/api/employee-record/export/route.ts
features:
  - employee-record
  - time-validation
  - wage-dispute
permissions:
  - "ops_manager, owner, sales_director, developer"
verified: 2026-08-31
---
# Employee Record

## What It Is
A comprehensive per-employee timeline that combines time punches, edits, flags, accountability documentation, geofence overrides, and time-off requests in chronological order. Used for wage dispute validation and DM accountability review.

## Who Can Access
- Ops Manager, Owner, Sales Director, Developer only
- Field Leaders and below do NOT have access

## How to Use
1. Navigate to Employee Record from the More menu
2. Select an employee from the list (search by name, username, or manager)
3. Default view shows the current pay period — adjust date range with the From/To pickers
4. Use filter pills to narrow: All, Shifts, Edits, Accountability, Flags, Overrides, Time Off
5. Tap any shift to expand and see full details (GPS, breaks, method, edit history)

## What's Shown

### Shifts
- Date, clock in/out times, gross/net hours, break time
- Method: "Live" (GPS clock) vs "Manual" (manual entry by a manager)
- GPS coordinates at clock in and out
- Store location
- Whether the shift was edited (amber highlight)
- Geofence override indicator

### Edit History
- Original vs new clock in/out times
- Who made the edit and when
- Edit note/reason

### Accountability Documents
- Documented Conversations, Verbal/Written/Final Notices
- Title, notes, status (pending/approved), acknowledgment status
- Author name

### Flags
- All flag types (missing clock out, overtime, late clock in, geofence exit, etc.)
- Whether resolved and by whom

### Geofence Overrides
- Store, reason, distance from store
- Who approved the override

### Time-Off Requests
- Date range, reason, status (pending/approved/denied)
- Approver name

## Export
- Click "Export Excel" to download a multi-sheet Excel workbook:
  - **Summary** sheet: employee info and period statistics
  - **Shift Detail** sheet: every shift with dates, times, method, GPS, edit flags
  - **Edit History** sheet: all timecard modifications with before/after values
  - **Documentation & Flags** sheet: all accountability docs, flags, overrides, and time-off combined chronologically

## Payroll Detailed Export
On the Payroll page, a new "Detailed Excel" button sits alongside the existing ADP CSV download:
- **Summary** sheet: same reg/OT hours per employee
- **Shift Detail** sheet: every shift for all employees with date, times, method (Live/Manual), edited flag, store, and notes
- Manual entries highlighted in purple, edited shifts highlighted in amber
