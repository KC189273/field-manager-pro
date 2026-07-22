---
sources:
  - app/api/barbershop/appointments/route.ts
  - app/api/barbershop/appointments/[id]/route.ts
  - app/api/cron/appointment-expiry/route.ts
  - app/api/cron/appointment-reminder/route.ts
  - app/book/page.tsx
  - app/barber-dashboard/page.tsx
features:
  - appointment-booking
  - confirm-decline
  - auto-expiry
  - reminders
  - customer-cancellation
permissions:
  - "only customers can book"
  - "24h auto-expiry"
  - "barbers confirm/decline"
verified: 2026-07-22
---
# Appointments & Booking

## How do clients book an appointment? (Customer flow)
1. Client scans your shop's **QR code** or opens your booking link.
2. If they don't have an account, they sign up at the customer signup page with name, email, and phone.
3. On the **Book** page, they:
   - Select a barber
   - Choose services
   - Pick a date and time from available slots
4. The appointment request is sent to the barber. Status: **Pending**.

## How do I confirm or decline an appointment? (Barber/Shop Owner)
1. Go to **Appointments** (Barber Dashboard) from the nav.
2. New appointment requests appear with status "Pending."
3. Tap an appointment to see details.
4. **Confirm**: accepts the appointment, client is notified.
5. **Decline**: rejects the appointment. You can optionally provide a reason and propose an alternative date/time.

## Appointment Status Lifecycle
| Status | Meaning |
|--------|---------|
| **Pending** | Waiting for barber to confirm |
| **Confirmed** | Barber accepted, client notified |
| **Completed** | Service was delivered (barber marks complete) |
| **Declined** | Barber rejected, optional reason shown |
| **Expired** | Not confirmed within 24 hours (auto) |
| **Cancelled** | Client cancelled before the appointment |

## What happens if I don't confirm?
Unconfirmed appointments **automatically expire after 24 hours**. The expiry cron runs hourly. The client is notified that their appointment expired.

## Appointment Reminders
Automatic reminders are sent **1 hour before** the appointment to both the client and the barber (via push notification). The reminder cron runs every 15 minutes.

## Why does it say "This time slot is no longer available"?
Someone else booked that time slot between when you loaded the page and when you submitted. Choose a different time.

## Why does it say "Only customers can book"?
Barbers and shop owners cannot book appointments through the booking flow. Only users with the "customer" role can book. There is no manual appointment creation for barbers — all bookings must come through the customer booking flow. For walk-ins, the customer needs to create an account and book through the app.

## Why does it say "Customer profile not found"?
The user needs to complete their customer signup first. They should go through the signup flow via the QR code or booking link to create their customer profile.

## Can a client cancel their appointment?
Yes. Clients can cancel from their **My Appointments** page. The barber is notified of the cancellation.
