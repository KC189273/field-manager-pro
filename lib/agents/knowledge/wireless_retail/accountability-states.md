---
sources:
  - app/api/accountability/[id]/route.ts
  - app/api/accountability/[id]/approve/route.ts
  - app/api/accountability/[id]/reject/route.ts
  - app/api/accountability/[id]/conversation-complete/route.ts
  - app/api/accountability/[id]/force-send/route.ts
  - app/api/accountability/[id]/remind/route.ts
features:
  - accountability-status-transitions
  - needs-revision
  - rejection-notes
permissions:
  - "only original author can resubmit"
  - "rejection notes required"
verified: 2026-07-22
---
# Accountability Document States — "Why can't I send / approve this doc?"

## Symptom: "Document is not pending approval"
You're trying to approve or reject an accountability doc but it won't let you.

### Why It Happens
The document's status is not `pending_approval`. It may have already been approved, rejected, or is still in draft. Only documents in `pending_approval` status can be approved or rejected.

### Possible causes:
1. **Already approved** — someone else approved it before you.
2. **Needs revision** — the approver sent it back for changes (see below).
3. **Still in draft** — the author hasn't submitted it yet.

### How to Fix
Check the document's current status on the Accountability page. If it's already been handled, no action is needed.

---

## Symptom: "Document is not in revision state" / "Only the document author can resubmit"
You're trying to edit and resubmit a doc that was sent back for revision.

### Why It Happens
Two possible causes:
1. The document's status is not `needs_revision` — it may have been re-approved or is in a different state.
2. You're not the original author. Only the person who created the doc can resubmit after revision. If a DM wrote it, only that DM can fix and resubmit.

### How to Fix
- If you're the author: the doc should show "Needs Revision" status. Open it, make the requested changes to the title/notes/expectations, and resubmit.
- If you're not the author: contact the original author and ask them to resubmit.

---

## Symptom: "Document is not approved" / "Document is not yet approved"
You're trying to send the doc to the employee, mark the conversation complete, or send a reminder, but it's blocked.

### Why It Happens
These actions require the doc to be in `approved` status:
- **Send to employee** (force-send)
- **Mark conversation complete**
- **Send acknowledgment reminder**

If the doc is still pending approval or in revision, these are blocked.

### How to Fix
The document needs to go through the approval chain first. Wait for the approver to approve it, then you can send/remind.

---

## Symptom: "Document has already been acknowledged"
You're trying to send a reminder but the employee already acknowledged it.

### Why It Happens
The employee clicked the acknowledgment link in their email and confirmed they received the document. Once acknowledged, reminders are no longer available.

---

## Symptom: "Rejection notes are required"
You're trying to reject a doc but didn't provide a reason.

### Why It Happens
When rejecting (either for revision or full rejection), you must include notes explaining why. This is required so the author knows what to fix.

### How to Fix
Enter your rejection reason/notes and try again.

## When to Report as a Bug
If a document is stuck in a state that doesn't match its actual history (e.g., shows "pending approval" but was already approved), or if the approval chain isn't routing to the correct person, report it with the document details.
