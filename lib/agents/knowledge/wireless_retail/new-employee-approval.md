# New Employee Approval — "Why can't my new employee log in?"

## Symptom
A DM created a new employee account, but the employee can't log in. They enter their username and password and get "Invalid credentials."

## Why It Happens
When a DM creates a new employee, the account starts with `approval_status = 'pending_approval'` and `is_active = false`. The login check requires `is_active = true` — so the employee literally cannot log in until their account is approved by someone above the DM.

This is different from a wrong password. The login page shows the same "Invalid credentials" error for all three cases:
1. Username doesn't exist
2. Password is wrong
3. Account is not active (pending approval or deactivated)

The employee has no way to tell which case they're in from the error message alone.

## How to Fix

### For the DM:
You created the employee, but someone above you needs to approve them.
1. Tell your SD or owner that you have a new employee pending approval.
2. They go to **Team** page and find the user with "Pending" status.
3. They tap the user and tap **Approve**.
4. Once approved, the account becomes active and the employee can log in.

### For the SD / Owner:
1. Go to **Team**.
2. Look for users with a **Pending** badge.
3. Tap the user to review their info.
4. Tap **Approve** to activate the account. A welcome email with login credentials is sent.

### For the employee:
Your account is waiting for approval from your DM's supervisor. Ask your DM to follow up. Once approved, you'll receive a welcome email with your login info.

## After Approval — First Login
Once approved, the employee logs in with their username and temporary password. The app automatically redirects them to the **Change Password** page where they must set a new password before using the app.

## When to Report as a Bug
If a user's approval_status shows "approved" and is_active is true, but they still can't log in, that's a real credentials issue — not an approval problem. Have them try "Forgot Password" to reset.
