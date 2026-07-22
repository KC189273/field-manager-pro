---
sources:
  - app/api/supply-requests/route.ts
  - app/api/facility-tickets/route.ts
  - app/api/merch-orders/route.ts
  - app/api/team/users/route.ts
features:
  - ops-collab-flag
permissions:
  - "gives DMs org-wide visibility for supplies/facilities/merch"
  - "removes submit ability"
verified: 2026-07-22
---
# Ops Collab Flag — "What does 'Ops Collab' mean on my profile?"

## Symptom
A DM sees "Ops Collab" on their Team page profile, or an admin toggled this flag and wants to know what it does.

## Why It Exists
The `is_ops_collab` flag gives a DM (manager role) elevated visibility for operational features — specifically supply requests, facility tickets, and merch orders. Normally a DM only sees requests from their own team. With ops collab enabled, they see requests across the entire org, similar to an ops manager.

## What Changes When Ops Collab is ON

| Feature | Normal DM | Ops Collab DM |
|---------|-----------|---------------|
| **Supply Requests** | Sees own team's requests only | Sees all org requests |
| **Facility Tickets** | Sees own team's tickets only | Sees all org tickets |
| **Merch Orders** | Sees own team's orders only | Sees all org orders |
| **Who can submit** | Can submit supply/facility/merch | Cannot submit (becomes a reviewer, like ops manager) |

Note: with ops collab ON, the DM loses the ability to submit new supply requests and merch orders themselves — they become a reviewer/approver for the whole org instead.

## How to Enable / Disable
1. Go to **Team**.
2. Find the DM and tap to edit.
3. Toggle the **Ops Collab** switch.
4. Save.

Only SD, owner, and developer can change this flag.

## When to Report as a Bug
If a DM has ops collab enabled but still only sees their own team's requests, or if the flag is on but they can't approve requests from other teams, report it.
