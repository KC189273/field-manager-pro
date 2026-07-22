---
sources:
  - app/api/shift-swaps/route.ts
  - app/api/shift-swaps/[id]/route.ts
  - app/shift-swaps/page.tsx
features:
  - shift-swaps
permissions:
  - "employee-only creation"
  - "same-DM constraint"
  - "DM approves"
verified: 2026-07-22
---
# Shift Swaps

## How do I request a shift swap?
1. Go to **Shift Swaps** from the nav.
2. Select one of your upcoming published shifts to swap.
3. Choose the coworker you want to swap with and select one of their shifts.
4. Submit the swap request. Your DM is notified.

## Who approves shift swaps?
Your DM (manager) approves or denies all swap requests. You'll get a notification when the decision is made.

## Why can't I swap with that person?
Shift swaps can only happen between employees **under the same DM**. If the person you want to swap with reports to a different DM, the swap is blocked. The error message is: "Can only swap with employees under the same manager."

## Other reasons a swap might fail:
- **"Cannot swap with yourself"** — you selected your own shift on both sides.
- **"One of these shifts already has a pending swap request"** — one of the shifts is already part of another pending swap. Wait for that swap to be approved or denied first.
- **Only employees can create swaps.** DMs and above cannot use the swap feature — they edit schedules directly.

## What happens when a swap is approved?
Both employees' schedules are updated to reflect the swapped shifts. Both receive push notifications.

## What if I need coverage but can't find a swap?
Contact your DM directly. They can edit the schedule to reassign shifts without needing a swap request.
