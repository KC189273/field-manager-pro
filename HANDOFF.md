# Field Manager Pro — Context Handoff

**Live:** https://fieldmanagerpro.app
**Stack:** Next.js 16.2.1 App Router, TypeScript, Tailwind v4, Supabase PostgreSQL, Mapbox GL JS, Resend, ExcelJS, Vercel Cron
**Deploy:** `npx vercel --prod` from project root

---

## Role Hierarchy
`employee` → `manager` / `ops_manager` → `owner` → `developer`

- `isManager(role)` = manager or ops_manager only (NOT owner or developer)
- `isOwner(role)` = owner only
- Per-route `canManageShifts` = `isManager || isOwner || role === 'developer'`

---

## What's Been Built

### Timecards (`/app/timecards/page.tsx`)
- **All employees view** — default for managers+, shows every employee's total hours for the week with a 10h+ flag (likely forgot to clock out)
- **Individual view** — drill down into day-by-day breakdown
- **Live hours** — open shifts update in real time every 60 seconds using `setInterval`
- **Pay codes** — managers can add PTO (with hours, rolls into total) or Sick (marker only, not paid) per day; employees can view their own
- **Day badges** — blue "PTO" and red "Sick" badges appear on days with pay codes
- **On-demand download** — owner/ops_manager/developer can pick a date range and get a 3-sheet Excel emailed to them

### Pay Codes (`/app/api/pay-codes/route.ts`)
- `pay_codes` table auto-created on first GET (`ensureTable()` with `CREATE TABLE IF NOT EXISTS`)
- GET supports `?userId=` (individual) or `?team=true` (manager view) with date filtering
- POST creates a code (managers+ only); DELETE removes by id

### Map (`/app/map/page.tsx` + `/app/api/map/route.ts`)
- Historical view: green clock-in, red clock-out, purple GPS ping markers + indigo path lines
- Every GPS breadcrumb is shown (no 15-minute interval filter)
- Defaults to today's date in both From/To fields to avoid showing all historical data on load
- **Live mode** — "Live" toggle button shows pulsing green markers for all currently clocked-in employees, polls `/api/map/live` every 30 seconds, displays name label and last-seen time

### Payroll Reports
- **Weekly cron** — Monday 4am CST via Vercel cron (`/app/api/cron/payroll-report/route.ts`)
- **On-demand** — POST to `/app/api/reports/timecard-download/route.ts`
- Both produce a 3-sheet Excel workbook:
  1. **Payroll Summary** — Employee, Org, Work Hours, PTO Hours, Sick Days, Total Paid Hours (=C+D), Hourly Rate, Est. Pay (=F*G), Corrections
  2. **Time Detail** — shift-level breakdown
  3. **PTO & Sick** — all pay codes for the period

### DM Store Visit Checklist (`/app/dm-checklist/page.tsx`)
- **Visible to:** manager, ops_manager, owner, developer only
- **4-tab layout:**
  1. **New Checklist** — full survey form (see field breakdown below)
  2. **Dashboard** — submission counts by manager and by store, date range filter
  3. **Download Report** — Excel download, one tab per visit, filterable by DM / RDM / date range
  4. **Manage Stores** — owner/developer only; add or deactivate store locations in-app

#### Form Field Breakdown
- **Visit Details:** Store Address (dropdown from `dm_store_locations`), Employee(s) Working (free text), DM Name (auto-populated from logged-in user, read-only), Assigned RDM (dropdown), Reason for Visit (dropdown), Additional Comments (free text)
- **Pre-Visit Planning:** 3 free text fields
- **Scorecard Review:** Letter Grade dropdown (A / B / D / F — no C, quartile-based grading), 3 free text fields
- **Sales Interaction:** Yes/No dropdown — if **No**, HEART and Sales Process sections are skipped entirely
- **HEART Sales Model** *(shown only if live interaction = Yes)*: 5 Yes/No dropdowns
- **Sales Process Execution** *(shown only if live interaction = Yes)*: 3 Yes/No dropdowns + Evaluation Comments free text
- **Operations Quick Check:** 5 Yes/No dropdowns + Operational Notes free text
- **Coaching:** 3 free text fields
- **Impact & Commitments:** 4 fields (2 free text, 2 short input)
- **Additional CC Emails:** optional, comma-separated, shown with helper text

#### On Submit
- All fields required except Additional CC Emails
- Timestamp recorded at submission (`submitted_at TIMESTAMPTZ`)
- Email sent via Resend to: DM (email on file in system) + selected RDM + any CC addresses
- RDM email map:
  - Kalee Heinzman → Kalee.Heinzman2@T-Mobile.com
  - Don Woods → Donald.Woods22@T-Mobile.com
  - Jeff Goodman → Jeffery.Goodman2@T-Mobile.com
  - Gary Meier → Garry.Meier2@T-Mobile.com
  - Zac Okerstrom → Zachary.2.Okerstrom@T-Mobile.com

#### Dashboard Logic
- **Manager:** sees only their own submission count, filterable by date range, broken down by store
- **Ops Manager / Owner / Developer:** sees all managers' counts sorted by manager name and by store, with date range filter
- Total submissions summary card always shown at bottom

#### Report Download
- Direct browser download (no email), `.xlsx` format
- One worksheet tab per store visit, formatted with dark header rows
- Filters: From date, To date, DM (ops+ only), RDM
- HEART/Sales Process rows only appear on tabs where a live interaction was observed

#### API Routes
- `GET/POST/PATCH /api/dm-store-locations` — manage store location dropdown
- `GET/POST /api/dm-store-visits` — fetch visits (dashboard) or submit new checklist
- `GET /api/dm-store-visits/report` — stream Excel file download

#### Supabase Tables
- `dm_store_locations` — id, address, active (bool), created_at. Seeded with all 45 locations. Shared across orgs (no org_id — locations are universal).
- `dm_store_visits` — full checklist submission, includes org_id for multi-tenant scoping. HEART/Sales fields are nullable (null when live_interaction_observed = false). Indexed on org_id, submitted_by_id, submitted_at.

#### Migration File
- `migrations/001_dm_store_visits.sql` — run once in Supabase SQL Editor to create both tables and seed all 45 store locations.

### Other
- Manual time entries by manager → email notification sent to employee
- `appendOrgFilter(orgFilter, params, alias)` in `/lib/org.ts` for multi-tenant WHERE clauses
- PostgreSQL `DATE` columns serialize as `"2026-04-09T00:00:00.000Z"` — always use `.slice(0, 10)` for string comparison

---

## Key Technical Notes

**Stable useCallback deps** — Never use `Date` objects (e.g., `monday`, `sunday`) as `useCallback`/`useEffect` deps. They're recreated every render causing infinite loops. Use the derived string values (`from`, `to`) instead.

**Loading flicker fix** — Only show the loading spinner when `loading && shifts.length === 0 && payCodes.length === 0` so the day grid doesn't disappear on every refetch.

**Open shift duration** — Use client-side `Date.now()` for open shifts: `(Date.now() - new Date(shift.clock_in_at).getTime()) / 1000`. Don't rely on server-side `NOW()` for live display.

**Map race condition** — Fixed by pre-filling today's date so the initial auto-load and any manual Load calls use the same date range.

**DM Checklist conditional fields** — HEART and Sales Process fields are conditionally rendered in the form (`live_interaction_observed === 'Yes'`) and nulled out in the POST payload when not shown. Never rely on required HTML attributes alone for hidden fields — they are explicitly set to null before submission.

**DM Checklist auth hook** — `/app/dm-checklist/page.tsx` uses `useUser()` from `@/lib/hooks/useUser` and expects `user.role`, `user.name`, `user.email`, and `user.org_id`. Verify these field names match your actual hook if behavior is unexpected.
