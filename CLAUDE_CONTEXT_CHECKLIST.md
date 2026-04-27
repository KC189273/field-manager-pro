# Field Manager Pro — Context Transfer
## Feature: Opening / Closing Checklist

Use this file to get up to speed before building the Opening / Closing Checklist feature.

---

## Project Overview

**Field Manager Pro** is a B2B SaaS field team management web app.
- Live at: https://fieldmanagerpro.app
- GitHub: https://github.com/KC189273/field-manager-pro
- Hosted on Vercel. Database on Supabase (PostgreSQL).

---

## Tech Stack

- **Framework:** Next.js (App Router, TypeScript, Tailwind v4)
- **Database:** Supabase PostgreSQL — transaction pooler at `aws-1-us-east-1.pooler.supabase.com:6543`
- **Auth:** Custom JWT stored in `fmp-session` cookie. Helper: `getSession(req)` from `@/lib/auth`
- **Email:** Resend, from `noreply@fieldmanagerpro.app`
- **Middleware:** `proxy.ts` in root (NOT middleware.ts — that causes a build error). New public routes must be added to `PUBLIC_PATHS` in proxy.ts.
- **Multi-tenant:** All queries must filter by `org_id`. Use `getOrgFilter` / `appendOrgFilter` from `@/lib/org`

---

## Role Hierarchy

```
employee → manager → ops_manager → sales_director → owner → developer
```

Helper functions in `@/lib/auth`:
- `isManager(role)` = manager or ops_manager only
- `isOwner(role)` = owner only
- `canViewTeam(role)` = isManager || owner || sales_director || developer

**NavBar access for checklist:** ALL roles can see and access `/checklist` — it is in the "General" section with no role gating.

---

## Current State of the Checklist Page

The route `/checklist` already exists as a "Coming Soon" placeholder:

**File:** `app/checklist/page.tsx`

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

interface Session {
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

export default function ChecklistPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => { if (d) setSession(d) })
  }, [router])

  if (!session) return null

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-violet-600/20 flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Opening / Closing Checklist</h1>
        <p className="text-gray-500 text-sm">This feature is coming soon.</p>
      </div>
    </div>
  )
}
```

No API routes exist yet for this feature. No database tables exist yet.

---

## Feature to Build: Opening / Closing Checklist

The goal is to replace the placeholder with a fully functional Opening / Closing Checklist. The feature does not yet have a defined spec — that is what needs to be designed and built out.

### Context / Intent

- Employees and managers use this to complete a structured checklist when opening or closing a store/location.
- There should be separate Opening and Closing checklists.
- Checklist items should be configurable (managers/owners define the items; employees complete them).
- Submissions should be timestamped and tied to the user and their org.
- Managers should be able to see completed checklists from their team.

### Questions to answer during design:
1. Who creates/edits checklist items? (Owner? Manager?)
2. Who completes checklists? (All roles? Employees + managers?)
3. Should checklist completions be date-scoped (one per day per type)?
4. Should there be a photo attachment option per item?
5. Should managers receive a notification when a checklist is submitted?
6. Should incomplete/missing checklists generate a flag?

---

## Existing Patterns to Follow

### API Route pattern (`app/api/[feature]/route.ts`):
```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pool = getPool()
  const { orgId, clause } = getOrgFilter(session)
  const { rows } = await pool.query(
    `SELECT * FROM some_table WHERE ${clause} ORDER BY created_at DESC`,
    [orgId]
  )
  return NextResponse.json(rows)
}
```

### Page pattern (client component):
- Fetch session from `/api/auth/me`
- Redirect to `/login` if not authenticated
- Show `<NavBar role={session.role} fullName={session.fullName} />`
- Dark theme: `bg-gray-950`, cards: `bg-gray-900 border border-gray-800 rounded-2xl`
- Primary color: violet (`bg-violet-600`, `text-violet-400`, `ring-violet-500`)

### Database:
- Always include `org_id` column on new tables for multi-tenant isolation
- Use `getPool()` from `@/lib/db` for all queries
- Run migrations as raw SQL (no ORM)

---

## Key Files for Reference

| File | Purpose |
|------|---------|
| `app/checklist/page.tsx` | Current placeholder — replace this |
| `app/tasks/page.tsx` | Good reference for list + complete pattern |
| `app/flags/page.tsx` | Good reference for manager review pattern |
| `app/expenses/page.tsx` | Good reference for submit + review pattern |
| `app/dm-visit/page.tsx` | Good reference for structured form submission |
| `components/NavBar.tsx` | Nav with role-based access |
| `lib/auth.ts` | `getSession`, role helpers |
| `lib/org.ts` | `getOrgFilter` for multi-tenant queries |
| `lib/db.ts` | `getPool` for DB access |
| `proxy.ts` | Auth middleware — add new API routes here if public |

---

## UI Style Reference

The app uses a dark mobile-first design:
- Background: `bg-gray-950`
- Cards: `bg-gray-900 border border-gray-800 rounded-2xl p-4`
- Primary accent: `violet-600` / `violet-400`
- Text: `text-white` (headings), `text-gray-400` (labels), `text-gray-500` (hints)
- Success: `green-500`, Warning: `amber-500`, Error: `red-500`
- Buttons: `bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl py-3`
- Bottom nav bar present on all authenticated pages (`pb-20 pt-14`)

---

## Important Rules

1. **Do NOT create `middleware.ts`** — this project uses `proxy.ts`. Having both causes a build error.
2. **Always filter by `org_id`** — never return data across organizations.
3. **Run `npm run build`** before declaring anything complete — catches TypeScript errors.
4. **New API routes** do not need to be added to `PUBLIC_PATHS` in proxy.ts (they're protected by default). Only add to PUBLIC_PATHS if the route needs to be unauthenticated.
