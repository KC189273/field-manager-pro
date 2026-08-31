---
sources:
  - app/api/dm-store-visits/route.ts
  - app/api/dm-store-visits/upload-url/route.ts
  - app/api/dm-coaching-checklist/route.ts
  - app/dm-visit/page.tsx
features:
  - dm-store-visits
  - quick-visit
  - coaching-checklist
  - remote-coaching
  - visit-photos
  - ai-coaching-grades
permissions:
  - "manager+ can submit"
  - "ops_field_leader+ can submit remote coaching"
  - "SD+ view all visits"
verified: 2026-08-31
---
# DM Store Visits

## What types of visits are there?
Three types:
1. **Quick Visit** — a brief store check-in with notes and optional photos.
2. **Quick Visit w/ DM Coaching** — includes everything in Quick Visit plus a structured coaching checklist. AI-graded automatically.
3. **Remote Coaching** — a phone-based coaching session (~15 minutes) with service analysis review, coaching conversation, commitments, and MLB/store priorities. AI-graded automatically.

## How do I log a store visit?
1. Go to **DM Store Visit** from the nav.
2. Select the store you're visiting.
3. Choose the visit type (Quick Visit or Quick Visit w/ Coaching).
4. Fill in the visit details:
   - Employees working
   - Reason for visit
   - Additional comments
   - Pre-visit observations
5. Optionally upload photos.
6. If doing coaching, complete the coaching checklist:
   - **Observe**: 6 Yes/No observation items
   - **Role Play**: notes from role play exercise
   - **Knowledge Check**: assessment notes
   - **Commitments Gained**: what the employee committed to
   - **Follow-Up**: planned follow-up actions
7. Submit.

## Who can see store visits?
- **DMs** can see their own visits.
- **Field Leader, Ops Manager, SD, Owner, Developer** can see all visits across the org.
- **Employees** cannot see DM Store Visits.

There is a visit dashboard showing visit counts and types over time, visible to SD and above.

## Can I attach photos to a visit?
Yes. You can upload photos during the visit. Photos are stored and displayed as thumbnails in the visit detail. Tap a thumbnail to view the full-size image.

## How do I see the coaching data from a visit?
When viewing a Quick Visit w/ Coaching, the coaching checklist data (observe, role play, knowledge check, commitments, follow-up) appears in the visit detail modal.

## How do I submit a Remote Coaching?
1. Go to **DM Store Visit** → tap the **Remote Coaching** tab.
2. Fill in: store, rep being coached, assigned RDM.
3. **Previous Commitment Follow Up** — if there was a prior coaching, note whether the commitment was completed (Yes/Partially/No) and the result.
4. **Service Analysis Review** — select 2 PM or 5 PM review, note if completed properly, transaction count, transactions documented, and themes identified.
5. **Coaching Conversation** — what strength you recognized, what you learned from the rep, Skill or Will identification, coaching provided, behavior change needed, impact.
6. **Commitments** — customer follow-up commitment and sales commitment for rest of shift.
7. **MLB / Store Priorities** — MLB strength, opportunity, current letter grade (A-F), top 3 priorities, main store focus.
8. Submit.

## Are coaching visits graded?
Yes. Both Quick Visit w/ Coaching and Remote Coaching submissions are automatically graded by AI. See the **AI Coaching Grades** help doc for details on how grading works, what the 5 categories are, and how to improve your grade.
