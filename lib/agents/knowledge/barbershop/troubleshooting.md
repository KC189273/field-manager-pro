# Troubleshooting — Barbershop

## Booking Issues

**"Only customers can book"**
You're logged in as a barber or shop owner. Only customer accounts can create appointment requests through the booking flow.

**"This time slot is no longer available"**
Another client booked that slot while you were on the page. Choose a different time and try again.

**"Customer profile not found"**
You need to complete the customer signup process. Go through the QR code or booking link to create your account first.

**"Barber not found"**
The barber may have been removed or their profile is no longer listed. Try selecting a different barber.

**Client can't find my booking page**
Share your QR code (available in Shop Setup) or give them the direct link. They need to scan it or open the link to reach your booking page.

## Services Issues

**Clients can't see my services**
Check that:
1. You have at least one service added.
2. Your services are marked **active** (not deactivated).
3. Your barber profile is **listed** (`is_listed` is on).

**"Service name required"**
You tried to save a service without entering a name. Enter a name and try again.

**"Forbidden" when editing services**
You can only edit your own services. If you're a barber trying to edit another barber's services, only the shop owner can do that.

## Availability Issues

**Clients seeing wrong available times**
Check both your **barber availability** and the **shop hours** (in Shop Setup > Hours). Clients can only book when both overlap.

**"Forbidden" when setting availability**
You can only set your own availability. Shop owners can set availability for any barber.

## Appointment Issues

**Not seeing new appointments**
Make sure push notifications are enabled for the app on your phone. New appointment requests trigger a push notification.

**Appointment expired before I could confirm**
Unconfirmed appointments auto-expire after **24 hours**. Check your Barber Dashboard regularly or enable push notifications so you don't miss requests.

## Customer Issues

**Customer not showing in "My Customers"**
The customer needs to have signed up through your shop's QR code or booking link. If they signed up for a different shop, they won't appear in your list.

## QR Code Issues

**QR code not working**
The QR code links to your download/booking page. Make sure:
1. You have an internet connection when scanning.
2. The shop is properly set up in Shop Setup.
3. Try opening the link manually in a browser to test.

## General

**App shows blank/white screen**
1. Force-close the app and reopen.
2. Check your internet connection.
3. Try logging out and logging back in.

**Can't log in**
- Use your username, not email.
- Passwords are case-sensitive.
- Use "Forgot Password" if needed.
