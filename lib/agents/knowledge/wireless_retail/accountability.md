# Accountability Documents

## What are accountability docs?
Accountability documents are formal disciplinary notices. They follow a progression: **Verbal Warning → Written Warning → Final Warning → Termination**.

## Who can create accountability docs?
- **DMs (managers)** can create docs for their direct reports.
- **Sales Directors** can create docs for DMs and employees.
- **Owners** and **Developers** can create docs for anyone.
- **Ops Managers** can view docs but cannot author them.
- **Employees** receive docs but cannot create them.

## How do I create an accountability doc? (DMs)
1. Go to **Accountability** from the nav.
2. Tap **New Document**.
3. Select the employee.
4. Choose the type: Verbal, Written, or Final.
5. Fill in the reason and details.
6. Submit. The doc goes into the approval workflow.

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

## What happens during a DM transfer?
When an employee moves to a different DM, accountability docs can be transferred. The doc's `transferred_to` field is updated so the new DM inherits the documentation history.

## Who can view accountability docs?
| Role | Can view |
|------|---------|
| Employee | Only docs addressed to them (via email link) |
| DM | Docs for their direct reports |
| Ops Manager | All docs in the org (view only, cannot author) |
| SD | All docs in the org |
| Owner, Developer | All docs |
