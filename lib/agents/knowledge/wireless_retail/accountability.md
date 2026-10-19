---
sources:
  - app/api/accountability/route.ts
  - app/api/accountability/[id]/approve/route.ts
  - app/api/accountability/[id]/reject/route.ts
  - app/api/accountability/termination/route.ts
  - app/api/accountability/self-quit/route.ts
  - app/accountability/page.tsx
features:
  - accountability-docs
  - documented-conversation
  - approval-chain
  - termination
  - self-quit
  - acknowledgment
permissions:
  - "DMs/SD/owner/dev can author"
  - "DMs+ can submit self-quits"
  - "ops_field_leader/ops_manager view only for docs, can submit self-quits"
  - "employees receive only"
  - "DMs can only doc direct reports"
verified: 2026-10-19
---
# Accountability Documents

## What are accountability docs?
Accountability documents track employee conversations and disciplinary notices. They follow a progression: **Documented Conversation → Verbal Warning → Written Warning → Final Warning → Termination**.

## Documented Conversations
Documented Conversations are informal records for situations that don't rise to the level of a formal write-up (verbal/written/final). They serve as a paper trail.

- **No approval required** — saves immediately
- **No acknowledgment required** from the employee
- **Multiple employees** can be selected at once — each receives an individual document
- **Employee is notified** via push + email with the full conversation text
- **DM gets a retained copy** via email
- **Pattern detection**: If an employee accumulates 3+ documented conversations in 30 days, the system sends a push notification to the DM and leadership recommending escalation to a Verbal Notice
- Visible in the employee's accountability history with teal/cyan styling

## Who can create accountability docs?
- **DMs (managers)** can create docs for their direct reports.
- **Sales Directors** can create docs for DMs and employees.
- **Owners** and **Developers** can create docs for anyone.
- **Field Leaders / Ops Managers** can view docs but cannot author them.
- **Employees** receive docs but cannot create them.

## How do I create an accountability doc? (DMs)
1. Go to **Accountability** from the nav.
2. Tap **New Document**.
3. Choose the type: **Documented Conversation**, Verbal, Written, or Final.
4. For Documented Conversation: select one or more employees, enter the topic and conversation details, then submit.
5. For Verbal/Written/Final: select the employee, fill in the reason and details, then submit. Written and Final go into the approval workflow.

## How does the approval chain work?
Each doc requires approval from someone above the author:
- DM creates → SD or Owner approves
- SD creates → Owner approves
- Owner creates → auto-approved

Once approved, the employee receives the notice via email with an acknowledgment link.

## How does the employee acknowledge?
The employee receives an email with a unique link. Clicking the link opens a page where they can read the notice and tap **Acknowledge**. This is recorded with a timestamp.

## What about terminations?
Termination is the final step after a Final Warning (or can be initiated directly by the SD/Owner):
- A termination creates a Word document (.docx) with the employee's full accountability history.
- The terminated employee is marked `is_active = FALSE` and `is_hidden = TRUE`.
- They are removed from all active views but their data is preserved.
- A formal termination notice email is sent to the employee and all management.

## Self-Quit / Resignations
For employees who resign or self-quit, use the dedicated **Self-Quit** tab in Accountability:

1. Go to **Accountability** → **Self-Quit** tab
2. Select the employee
3. Enter the **reason for leaving** (resignation letter, verbal notice, no-show, etc.)
4. Set the **last day worked** (optional)
5. Toggle **2-week notice given** (Yes/No) — used for bonus eligibility tracking
6. Toggle **Rehireable** (Yes/No)
7. Add **notes about the employee** — work ethic, attitude, strengths, concerns
8. Optionally attach evidence (resignation letter, text screenshot, photo)
9. Submit — account is **immediately deactivated** (no approval needed)

**Key features:**
- **No approval workflow** — employee already quit, no need for approval chain
- **No email to the employee** — they already know they quit
- **Auto-deactivation** — account is set to inactive, hidden, and terminated on submission
- **Leadership notified** via push + email with full details
- **DM gets a retained copy** via email
- **2-week notice tracking** — for bonus eligibility reporting
- **Rehireable flag** — for future hiring decisions
- **DM notes** — record how the employee performed

### Self-Quit Report
Below the submission form on the Self-Quit tab, there's a **Self-Quit Report** showing:
- **Summary stats**: total self-quits, how many gave 2-week notice, how many are rehireable
- **All records** with employee name, date, submitter, notice status, rehire status, reason, and notes
- Badges: green "2-WK" for 2-week notice, red "NO NOTICE" for no notice, cyan "REHIRE" or gray "NO REHIRE"

### Who can submit self-quits?
DMs, Field Leaders, Ops Managers, SD, Owner, and Developer. DMs can only submit for their direct reports.

## Attaching Evidence
All accountability documents (documented conversations, verbal, written, final) support optional file attachments. When creating a document, you can upload photos, PDFs, screenshots, or other files as evidence. The attachment is stored with the document permanently.

**Common uses:** incident photos, resignation letters, text message screenshots, written employee statements, camera footage stills.

## What happens during a DM transfer?
When an employee moves to a different DM, accountability docs can be transferred. The doc's `transferred_to` field is updated so the new DM inherits the documentation history.

## Who can view accountability docs?
| Role | Can view |
|------|---------|
| Employee | Only docs addressed to them (via email link) |
| DM | Docs for their direct reports |
| Field Leader / Ops Manager | All docs in the org (view only, cannot author) |
| SD | All docs in the org |
| Owner, Developer | All docs |
