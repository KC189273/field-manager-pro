---
sources:
  - app/api/merch-orders/route.ts
  - app/merch-orders/page.tsx
features:
  - merch-orders
permissions:
  - "employees/DMs create"
  - "ops_field_leader+ approve"
  - "notes and field leader/ops manager required"
verified: 2026-08-31
---
# Merch Orders

## How do I place a merch order?
1. Go to **Merch Orders** from the nav.
2. Tap **New Order**.
3. Enter **notes** describing what you need — this is required.
4. Select a **field leader / ops manager** to send the order to — this is required.
5. Optionally upload a **photo** (e.g., a photo of the item or current inventory).
6. Submit.

## Who can place merch orders?
Employees and DMs can submit orders. Only employees and managers can create new orders.

## Who approves merch orders?
Field leaders, ops managers, and above (SD, Owner, Developer) can approve merch orders. When approved, the status changes from "pending" to "ordered."

## Why does it say "Notes are required"?
Every merch order must include a description. You can't submit with an empty notes field.

## Why does it say "Ops manager is required"?
You must select which field leader or ops manager should handle this order from the dropdown. If none are listed, contact your SD.

## Who can see merch orders?
- **Employees/DMs** see their own orders.
- **Field leaders, Ops managers, SD, Owner, Developer** see all orders across the org.
