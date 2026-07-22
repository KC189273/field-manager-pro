# Schedule Publishing — "Why can't I publish / copy the schedule?"

## Symptom: "Cannot publish: X shifts still need employees assigned"
You're trying to publish a weekly schedule but get an error about unassigned shifts.

### Why It Happens
The system checks every shift for the selected store and week. If any shift has no employee assigned to it (the employee_id is blank), publishing is blocked. This prevents publishing incomplete schedules that would confuse employees.

### How to Fix
1. Go to **Store Schedule**.
2. Look through each day for shifts that don't have an employee assigned.
3. Either assign an employee to each shift, or delete the unassigned shifts.
4. Try publishing again.

---

## Symptom: "No shifts to publish"
You tap Publish but nothing happens and you see this error.

### Why It Happens
There are no shifts created for this store and week combination. You need to add at least one shift before publishing.

### How to Fix
Add shifts for your employees first, then publish.

---

## Symptom: "This week already has shifts. Remove them first before copying."
You're trying to copy last week's schedule but the target week already has shifts.

### Why It Happens
The copy feature only works on a blank week. If the target week already has any shifts (even one), copying is blocked to prevent accidentally overwriting work.

### How to Fix
Two options:
1. **Delete existing shifts** for that week first, then copy. Go to each shift and remove it.
2. **Build the schedule manually** instead of copying — add shifts one by one.

---

## Symptom: "No shifts found in the previous week to copy"
You're trying to copy but there's nothing to copy from.

### Why It Happens
The previous week has no shifts for this store. There's nothing to duplicate.

### How to Fix
Build the schedule manually for this week.

---

## Symptom: "This employee has approved time off on that date"
You're trying to add a shift for an employee but it's blocked.

### Why It Happens
The employee has an approved time-off request covering that date. The system prevents scheduling someone on a day they have approved time off. If the time off is partial-day, the error message includes the specific time range: "This employee has approved time off from [start] to [end] on that date."

### How to Fix
- **If the time off is correct:** Schedule a different employee for that day.
- **If the time off was a mistake:** The employee needs to cancel their time-off request (if still pending/approved), then you can schedule them.
- **For partial-day time off:** You can schedule the employee outside of the blocked time range.

## When to Report as a Bug
If you're getting "Cannot publish" errors but every shift looks like it has an employee assigned, or if the time-off block fires for dates that don't have approved time off, report it with the store name, week, and employee name.
