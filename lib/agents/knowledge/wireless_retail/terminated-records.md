---
sources:
  - app/api/terminated-records/route.ts
  - app/terminated-records/page.tsx
features:
  - terminated-employee-records
  - timecard-export
  - certification-letter
permissions:
  - "owner, ops_manager, ops_field_leader, sales_director, developer can access"
  - "DMs and employees cannot access"
  - "no need to reactivate terminated employees"
verified: 2026-08-31
---
# Terminated Employee Records

## How do I pull records for a terminated employee?
1. Go to **Team** page
2. Tap **"Terminated Records"** (purple link in the top right)
3. Find the employee by searching by name, email, or manager
4. Tap **Export** next to their name

An Excel file downloads with the complete record.

## What's in the export?
The Excel has 3 sheets:

1. **Certification Letter** — formal document certifying the records are accurate, from the organization's automated GPS-verified timekeeping system. Includes employee details, record summary, and signature lines.
2. **Timecard Detail** — every shift with date, clock in/out times, hours worked, breaks, store location, GPS coordinates. Sortable with filters.
3. **Edit History** — audit trail of any timecard modifications (who changed what, when). If no edits, it confirms all entries are original.

## Do I need to reactivate the employee?
No. The export works regardless of account status. You do not need to toggle is_active or any other setting.

## Is the export logged?
Yes. Every export is logged with who downloaded it, when, which employee, and how many shifts/hours. This is for compliance purposes.

## Who can access this?
Owners, Sales Directors, Field Leaders, Ops Managers, and Developers. DMs and employees cannot access terminated records.
