---
sources:
  - lib/coaching-grader.ts
  - app/api/coaching-grades/route.ts
  - app/api/dm-store-visits/route.ts
  - app/dm-engagement/page.tsx
features:
  - ai-coaching-grades
  - coaching-performance-dashboard
  - monthly-rollup
  - remote-coaching
permissions:
  - "DMs see only their own grades"
  - "ops_field_leader/ops_manager/owner/developer see all DMs"
  - "grades are automatic — no one manually assigns them"
verified: 2026-08-31
---
# AI Coaching Grades

## How do coaching grades work?
Every time you submit a **Quick Visit w/ Coaching** or **Remote Coaching** in the app, AI automatically grades your coaching quality. You'll see your letter grade immediately, and a detailed email follows within minutes explaining exactly why you got that grade and how to improve.

## What gets graded?
The AI evaluates 5 categories:

1. **Specificity (25%)** — Did you describe specific behaviors you observed? Concrete examples beat vague generalizations. "Work on sales" = low score. "Marcus skipped discovery on 3 of 4 interactions" = high score.
2. **Actionability (25%)** — Are your action items measurable? Can the rep do something different tomorrow? "Improve performance" = low. "Use discovery checklist for next 5 customers" = high.
3. **Follow-Up Quality (20%)** — Is there a specific follow-up plan with a date and success metrics? "I'll check in" = low. "Follow-up Friday to review MiM conversion rate" = high.
4. **Depth of Observation (20%)** — How thorough was your observation? Did you use the full checklist? Did you identify root causes?
5. **Prior Coaching Reference (10%)** — Did you connect this session to previous coaching? Are you building on past visits?

## What are the letter grades?
Grades range from A+ (best) to F (worst). Your monthly average rolls up from all coaching submissions that month.

## Where do I see my grades?
- **Immediately after submission** — your letter grade appears in the app
- **Email** — a detailed email with your grade, per-category breakdown, and improvement tips
- **DM Engagement → Coaching Performance** — monthly dashboard with all your grades, trend, and history

## Where do leadership see grades?
Owners, field leaders, ops managers, and developers go to **DM Engagement → Coaching Performance** to see:
- All DMs listed with their current month average grade and trend arrow
- Click into any DM to see every coaching submission with the full AI feedback
- Month dropdown to view historical data
- 3-month rolling trend (improving ↑, declining ↓, consistent →)

## Why did I get a low grade?
The AI is fair but demanding. Common reasons for low grades:
- Vague coaching notes without specific examples
- Action items that aren't measurable
- No follow-up date or success metrics
- Not using the full observation checklist
- Not connecting to previous coaching sessions

Check the detailed email — it tells you exactly what to improve for each category.

## Does the MLB grade affect my coaching grade?
Yes, for Remote Coaching sessions. The AI adjusts expectations based on the store's MLB (Metro Leaderboard) grade:
- **A-store**: Lighter, conversational coaching is acceptable
- **C-store**: Needs structured coaching with clear measurables
- **F-store**: Must be extremely detailed with aggressive commitments — graded harshly if vague

## What is Remote Coaching?
A new form on the DM Store Visit page for coaching done over the phone (~15 minutes). It captures:
- Previous commitment follow-up (was the last commitment completed?)
- Service analysis review (2 PM or 5 PM check, transaction count, themes)
- Coaching conversation (strength recognized, skill vs will, coaching provided, behavior change needed)
- Commitments (customer follow-up, sales goals for rest of shift)
- MLB / Store Priorities (current grade, top 3 priorities, main focus)

Remote coaching submissions are AI-graded the same way as in-person coaching.

## How do I improve my coaching grade?
1. **Be specific** — document exact quotes and behaviors you observed
2. **Make it measurable** — "offer MiM to next 5 customers" not "work on MiM"
3. **Set a follow-up date** — with clear success criteria
4. **Diagnose root causes** — why is the rep doing this, not just what they're doing wrong
5. **Reference prior coaching** — connect this session to what you coached last time
