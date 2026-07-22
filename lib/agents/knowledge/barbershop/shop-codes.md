# Shop Codes — "Shop not found" / "Code already taken"

## Symptom: "Shop not found. Check your code and try again."
A customer scans your QR code or enters your shop code and gets this error.

### Why It Happens
The 4-character shop code they entered doesn't match any shop in the system. Possible causes:
1. **Typo** — they entered the wrong code.
2. **Code was changed** — you changed your shop code after the QR code was printed.
3. **Shop not set up** — the shop_settings record hasn't been created yet.

### How to Fix
- Have the customer try again, checking the code carefully.
- Verify your current code in **Shop Setup** (shop owners only).
- If you changed your code, reprint your QR code — the old one points to the old code.

---

## Symptom: "This code is already taken by another shop"
You're setting up your shop code and the code you want is taken.

### Why It Happens
Shop codes must be unique across all shops in the system. Another shop already registered that 4-character code.

### How to Fix
Choose a different 4-character code. Try variations of your shop name or initials.

---

## Symptom: "Code must be exactly 4 characters"
Your shop code is too short or too long.

### Why It Happens
Shop codes must be exactly 4 characters — no more, no less.

### How to Fix
Enter exactly 4 characters (letters, numbers, or a mix).

---

## Symptom: "Only shop owners can add barbers"
You're trying to add a barber to the shop but can't.

### Why It Happens
Only users with the `shop_owner` role can add new barbers. Regular barbers cannot add other barbers.

### How to Fix
Ask the shop owner to add the new barber through the Shop Setup page or Team management.

## When to Report as a Bug
If a customer enters the correct code (you've verified it matches Shop Setup) and still gets "Shop not found," report it with the exact code.
