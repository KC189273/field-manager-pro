---
sources:
  - app/api/supply-requests/route.ts
  - app/api/facility-tickets/route.ts
  - app/supply-requests/page.tsx
  - app/facilities/page.tsx
features:
  - supply-requests
  - facility-tickets
  - auto-escalation
  - photo-required-tickets
permissions:
  - "all retail roles submit"
  - "DMs approve own team"
  - "ops+ approve any"
  - "facility photo required"
  - "48h auto-escalation"
verified: 2026-07-22
---
# Supply Requests & Facility Tickets

## Supply Requests

### How do I request supplies?
1. Go to **Supplies** from the nav.
2. Tap **New Request**.
3. Enter the item name, quantity, and select an urgency level (1 = low, 2 = medium, 3 = high).
4. Submit. Your DM is notified.

### What's the supply request lifecycle?
1. **Pending** — submitted, waiting for DM to order.
2. **Ordered** — DM confirmed the order is placed.
3. **Received** — the supplies arrived and were received.

### Who handles supply requests?
- **Employees** and **DMs** can submit requests.
- **DMs** can approve (mark as ordered) for their team's requests only.
- **Ops managers, SD, Owner, Developer** can approve any request.
- Only managers and above can mark items as received.

### What happens if nobody orders my supplies?
Supply requests auto-escalate after 48 hours if they're still in "pending" status. The escalation cron runs every 30 minutes and notifies the next level up.

---

## Facility Tickets

### How do I submit a facility ticket?
1. Go to **Facilities** from the nav.
2. Tap **New Ticket**.
3. Select your **store**.
4. Choose a **category** (e.g., plumbing, electrical, HVAC).
5. Enter a **title** describing the issue.
6. Select **urgency** (urgent or normal).
7. **Upload a photo** — this is required. The ticket will not submit without a photo.
8. Submit.

### Why won't my facility ticket submit?
The most common reason: **you didn't upload a photo**. A photo is required for all facility tickets. If the photo upload fails, check your internet connection and try again.

### Who can see facility tickets?
All retail roles can submit and view facility tickets. DMs and above can update ticket status.
