# Appointment Errors — "This appointment has already been updated" and other issues

## Symptom: "This appointment has already been updated"
You're trying to confirm, decline, or respond to an appointment but get this error.

### Why It Happens
The appointment's status changed since you loaded the page. Someone else (or the system) already updated it. This commonly happens when:
1. You opened the appointment details, walked away, and came back to act on it — but it was already confirmed/declined.
2. The 24-hour auto-expiry ran and expired the appointment before you confirmed.
3. The customer cancelled while you were looking at the details.

### How to Fix
Refresh the page to see the current status. If the appointment was expired or cancelled, it can't be recovered — the customer would need to book a new one.

---

## Symptom: "No proposal to respond to"
A customer is trying to respond to a barber's proposed alternative time, but gets this error.

### Why It Happens
When a barber declines an appointment, they can optionally propose an alternative date/time. If the barber declined WITHOUT proposing an alternative, there's nothing for the customer to respond to.

### How to Fix
The customer needs to book a new appointment from scratch with a different time.

---

## Symptom: "Not awaiting your response" / "Not awaiting manager decision"
You're trying to take an action on an appointment but the system says it's not waiting for you.

### Why It Happens
The appointment workflow expects actions in a specific order:
1. Customer books → status: `pending`
2. Barber confirms or declines → status: `confirmed` or `declined`
3. If barber proposes alternative → awaiting customer response
4. Barber marks complete → status: `completed`

If you try to do step 3 when the appointment is still in step 1, or step 4 when it's in step 2, you get blocked.

### How to Fix
Check the appointment's current status and take the appropriate action for that status.

---

## Symptom: "Barber not found" / "Barber profile not found"
An action fails because the barber profile doesn't exist.

### Why It Happens
The barber's user account exists but their `barber_profiles` record is missing. This can happen if:
1. The profile creation failed during account setup.
2. The user's role was changed to "barber" but no profile was created.

### How to Fix
The shop owner should check the barber's profile in Shop Setup. If the profile is missing, it may need to be recreated by contacting support.

## When to Report as a Bug
- "This appointment has already been updated" when you're sure nobody else acted on it and it hasn't expired.
- "Barber profile not found" for a barber who was properly set up.
- Any appointment stuck in a status that doesn't match reality.
