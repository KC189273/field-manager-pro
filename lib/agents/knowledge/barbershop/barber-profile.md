---
sources:
  - app/api/barbershop/barbers/route.ts
  - app/api/barbershop/shop/route.ts
features:
  - barber-profile
  - display-name
  - bio
  - walk-ins
  - cleanup-minutes
  - listed-toggle
permissions:
  - "barbers edit own"
  - "shop owners edit any in shop"
verified: 2026-07-22
---
# Barber Profile

## How do I set up my barber profile?
Your barber profile is what clients see when they're choosing who to book with. To set it up:

1. Your shop owner creates your account and assigns you the "barber" role.
2. A barber profile is created automatically.
3. You can then customize:
   - **Display name**: the name clients see
   - **Bio**: a short description (your specialties, experience, etc.)
   - **Avatar/photo**: upload a profile picture
   - **Default duration**: your standard appointment length in minutes
   - **Cleanup minutes**: buffer time between appointments for cleanup
   - **Walk-ins enabled**: toggle whether you accept walk-in clients
   - **Listed**: toggle whether you appear on the booking page (unlisted barbers can't be booked)

## How do I set my availability?
Go to your profile settings and set your available hours for each day of the week. This controls which time slots clients can book.

Your availability can be different from the shop's hours. If the shop is open 9-7 but you only work 10-5, set your availability to 10-5. Clients will only see your available slots.

## Who can edit my profile?
- **You (barber)** can edit your own profile, services, and availability.
- **Shop owner** can edit any barber's profile in their shop.
- You cannot edit another barber's profile.

If you try to edit another barber's profile, you'll see a "Forbidden" error.

## What does "Listed" mean?
When "Listed" is on (`is_listed = true`), you appear on the shop's booking page and clients can book with you. When off, you're hidden from the booking flow but your existing appointments remain.

## What is the sort order?
The sort order controls where you appear in the barber list on the booking page. The shop owner can reorder barbers by changing the sort order.
