---
sources:
  - app/commissions/page.tsx
  - app/api/commissions/route.ts
features:
  - commissions-estimator
permissions:
  - "all retail roles"
  - "October 2026 comp plan"
verified: 2026-10-07
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

## Current Comp Plan (October 2026 — payout 10/30)

### Base Pay (per activation)
- **$5** per voice activation (New Activations + BYOD + Reactivations).
- **$3** per Upgrade, HSI, BTS, or Promo10.

### Accessory Revenue Multiplier
Your base pay is multiplied by a percentage based on your **monthly accessory revenue**:
- Under $750 → 50%
- $750–$1,499 → 75%
- $1,500–$2,499 → 100%
- $2,500–$3,499 → 110%
- $3,500–$4,999 → 120%
- $5,000+ → 130%

### Voice Boost
Your total **New + React + BTS + HSI activations** for the month determine your tier. All eligible voice activations pay at the tier rate. Must achieve **$1,500 in accessory revenue** to qualify.
- 0–44 activations → **$5/voice** (base rate, no boost)
- 45–59 activations → **$6/voice**
- 60–89 activations → **$7/voice**
- 90+ activations → **$8/voice**
- Voice Boost **stacks with** the Accessory Revenue Multiplier.

### Additional Bonuses & Adjustments (flat rates — NOT affected by multiplier)
- **$1** per Complete Protection or HD attachment
- **$10** per MiM line
- **$5** per HSI
- **-$100** if no MiM sold for the month

## Revenue Inputs
The estimator has two revenue fields:
- **Total Revenue** — For tracking purposes only.
- **Accessory Revenue** — Drives your Multiplier tier and Voice Boost qualification ($1,500 minimum).

## Is this my actual pay?
No. The estimator gives you an approximate estimate based on the compensation plan loaded into the app. Your actual commissions are calculated by payroll. Use this as a guide to track your daily performance.

The calculator is hardcoded to the **October 2026 comp plan**. It does not auto-update when the comp plan changes — it requires a code update. If the rates look wrong, the comp plan in the app may need to be updated to match the current plan.
