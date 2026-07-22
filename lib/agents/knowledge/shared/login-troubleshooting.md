---
sources:
  - app/api/auth/login/route.ts
  - app/api/auth/reset-password/route.ts
  - app/api/auth/change-password/route.ts
features:
  - login-failures
  - rate-limiting
  - password-requirements
permissions:
  - "10 attempts per IP per 15 min"
  - "change=6 chars, reset=8 chars"
  - "inactive accounts get same error as wrong password"
verified: 2026-07-22
---
# Login Troubleshooting — "Invalid credentials" / "Too many failed attempts"

## Symptom: "Invalid credentials"
You enter your username and password but can't log in.

### Why It Happens — Three Possible Causes
The login page shows the **same error** for all of these:

1. **Username doesn't exist.** Usernames are case-sensitive and must be entered exactly as created. They're usually lowercase. You log in with your username, NOT your email.

2. **Wrong password.** Passwords are case-sensitive. If you just had your account created, your DM gave you a temporary password — make sure you have it exactly right.

3. **Account is deactivated.** If `is_active = false` on your account, login fails silently with the same "Invalid credentials" error. This happens when:
   - Your account is still **pending approval** (new employees created by DMs must be approved by SD/owner before they can log in)
   - Your account was **terminated or deactivated** by management
   - Your account was **never activated** after creation

### How to Fix — Step by Step

**Step 1: Verify your username.**
Your username is NOT your email. It was set when your account was created. Ask your DM if you're not sure.

**Step 2: Try "Forgot Password."**
Tap "Forgot Password" on the login screen. Enter your email. If you get a reset link, your username exists and your account is active — the problem was just the password.

**Step 3: If Forgot Password doesn't send an email:**
Your account may not exist, or your email isn't on file, or your account is deactivated. Contact your DM or admin.

**Step 4: For new employees:**
If you were just hired, your account may be **pending approval**. Your DM creates the account, but their supervisor (SD or owner) must approve it before you can log in. Ask your DM to check.

---

## Symptom: "Too many failed attempts. Try again in 15 minutes."

### Why It Happens
After **10 failed login attempts** from the same IP address within a 15-minute window, the system locks out that IP. This is a brute-force protection measure.

### How to Fix
- **Wait 15 minutes** and try again. The lockout resets automatically.
- **Make sure you have the right credentials** before trying again — you'll get locked out again after 10 more failures.
- If you're on a shared network (office, store WiFi), other people's failed attempts from the same IP count toward your limit.

---

## Symptom: "This reset link is invalid or has expired."

### Why It Happens
Password reset links expire after **1 hour**. If you click the link after that, it won't work. Links also become invalid after they've been used once.

### How to Fix
Go back to the login page, tap "Forgot Password" again, and request a new reset link. Use it within 1 hour.

---

## Symptom: Password requirement confusion
- **Changing your password** (Settings > Change Password): minimum **6 characters**
- **Resetting your password** (via Forgot Password link): minimum **8 characters**

These requirements are different. If your reset fails with "Password must be at least 8 characters," use a longer password.

## When to Report as a Bug
- If you can confirm your username, password, and account status are all correct but you still can't log in.
- If the lockout doesn't clear after 15 minutes.
- If you receive a reset email but the link fails immediately (not after waiting).
