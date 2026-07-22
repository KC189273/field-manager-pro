---
sources:
  - app/commissions/page.tsx
  - app/api/commissions/route.ts
features:
  - commissions-estimator
permissions:
  - "all retail roles"
  - "hardcoded July 2026 comp plan"
verified: 2026-07-22
---
# Commissions Estimator

## What is the Commissions Estimator?
A calculator that lets you estimate your daily commissions based on the current compensation plan. Enter your sales numbers and see your estimated payout.

## Who can use it?
All retail roles can access the Commissions Estimator.

## How do I use it?
1. Go to **Commissions** from the nav.
2. Enter your sales numbers for the day across the different categories.
3. The estimator calculates your commission based on:
   - Per-tier rates
   - Voice boost (tiered bonus for voice line activations)
   - BTS (Back to School) adjustments — BTS counts subtract from voice count

## Is this my actual pay?
No. The estimator gives you an approximate estimate based on the compensation plan loaded into the app. Your actual commissions are calculated by payroll. Use this as a guide to track your daily performance.

The calculator is hardcoded to the **July 2026 comp plan**. It does not auto-update when the comp plan changes — it requires a code update. If the rates look wrong, the comp plan in the app may need to be updated to match the current plan.
