---
sources:
  - app/commissions/page.tsx
  - app/api/commissions/route.ts
features:
  - commissions-estimator
permissions:
  - "all retail roles"
  - "September 2026 comp plan"
verified: 2026-09-03
---
# Commissions Estimator

## What is the Commissions Estimator?
A calculator that lets you estimate your daily and monthly commissions based on the current compensation plan. Enter your sales numbers and see your estimated payout.

## Who can use it?
All retail roles can access the Commissions Estimator from the More menu.

## How do I use it?
1. Go to **Commissions Estimator** from the More menu.
2. Use the **Daily Entry** tab to enter your sales numbers for each day.
3. Switch to the **Monthly Summary** tab to see your full monthly commission breakdown.

## Current Comp Plan (September 2026)

### Base Pay (per box/per line)
- **$5** per voice activation (New Activations + BYOD + Reactivations). Promo10 is excluded from base pay.
- **$3** per Upgrade, HSI, or BTS line.

### Revenue Multiplier
Your base pay is multiplied by a percentage based on your **total monthly revenue generated**:
- Under $1,000 → 50%
- $1,000–$1,499 → 75%
- $1,500–$2,499 → 100%
- $2,500–$4,999 → 120%
- $5,000+ → 130%

### Voice Boost
Requires **$2,500 in accessory revenue** to unlock:
- 50+ voice boxes → **$6/box** (replaces the $5 base rate)
- 75+ voice boxes → **$8/box**
- Voice Boost **stacks with** the Revenue Multiplier.
- Reacts, BYOD, new activations, and Promo10 all count toward voice box thresholds.

### Bonus Accelerator (flat rates — NOT affected by multiplier)
- **$2** per Promo10 (Add-A-Line)
- **$10** per MiM line
- **$1** per attachment (Complete Protection or HD Video)
- **$15** per Home Internet account

### Monthly Minimum
- Must sell at least **1 MiM account** per month.
- No MiM = **-$100 penalty**.

## Revenue Inputs
The estimator has two revenue fields:
- **Total Revenue** — Your total monthly revenue generated. This drives your Revenue Multiplier tier.
- **Accessory Revenue** — Your accessory sales revenue. $2,500 unlocks Voice Boost.

## Is this my actual pay?
No. The estimator gives you an approximate estimate based on the compensation plan loaded into the app. Your actual commissions are calculated by payroll. Use this as a guide to track your daily performance.

The calculator is hardcoded to the **September 2026 comp plan**. It does not auto-update when the comp plan changes — it requires a code update. If the rates look wrong, the comp plan in the app may need to be updated to match the current plan.
