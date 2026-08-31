---
sources:
  - app/api/supply-requests/route.ts
  - app/api/facility-tickets/route.ts
  - app/supply-requests/page.tsx
  - app/facilities/page.tsx
features:
  - supply-requests
  - facility-tickets
  - photo-required-tickets
permissions:
  - "all retail roles submit supply requests"
  - "DMs approve/reject for their team only"
  - "DMs mark delivered to close out"
  - "field leaders/ops managers can view but take no action"
  - "facility photo required"
verified: 2026-08-31
---
# Supply Requests & Facility Tickets

## Supply Requests

### How do I request supplies?
1. Go to **Supplies** from the nav.
2. Tap **New Request**.
3. Enter the item name, quantity, and select an urgency level (Level 1 = within 24 hours, Level 2 = within 72 hours, Level 3 = within 1 week).
4. Take a photo of what's needed (required).
5. Submit. Your DM is notified via push and email.

### What's the supply request lifecycle?
1. **Pending** — submitted, waiting for DM to review.
2. **Approved** — DM approved the request. DM handles ordering outside the app.
3. **Delivered** — DM confirms supplies arrived at the store. Request is closed.

Or: **Rejected** — DM did not approve (reason provided via push notification).

### Who handles supply requests?
- **Employees** and **DMs** can submit requests.
- **DMs** approve or reject requests for their own team only.
- **DMs** mark requests as delivered when supplies arrive.
- **Field leaders / Ops managers** can view supply requests for visibility but do not take action in the app. Ordering is handled outside the app via Google Forms.

### My supply request was rejected — why?
Your DM decided not to approve it. You'll receive a push notification with the reason. If you disagree, talk to your DM directly.

### I submitted a request but haven't heard back
Check the status in the Supplies tab. If it's still "Pending," your DM hasn't reviewed it yet. Follow up with your DM directly.

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
