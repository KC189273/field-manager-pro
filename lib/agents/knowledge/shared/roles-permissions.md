# Roles & Permissions

## Role Hierarchy (Wireless Retail)
From least to most access: **Employee → Manager (DM) → Ops Manager → Sales Director → Owner → Developer**

### Employee
- Clock in/out, breaks
- View own schedule (My Schedule), timecards, time history
- Submit time off requests, shift swap requests
- Complete assigned tasks
- Submit checklists (opening/closing)
- Submit supply requests, facility tickets, merch orders
- View Resources (read-only)
- Use Commissions Estimator
- **Cannot**: see Chat, create tasks, edit timecards, see flags, see other employees' data, access Store Schedule, Calendar, Expenses, Accountability, Map, or DM features

### Manager (DM)
Everything an employee can do, plus:
- Chat / Messages (direct and group)
- Store Schedule (build and publish for their team)
- Timecards (view and edit their team's, but NOT their own)
- Tasks (create and assign to their team)
- Flags (view for their team)
- DM Store Visit (log visits, coaching)
- DM Schedule (plan their own weekly field plan)
- Calendar (create events)
- Expenses (submit, but cannot approve)
- Accountability (create verbal/written/final for their reports)
- Team page (manage their direct reports)
- Payroll (submit their team's timecards)
- **Cannot**: see Live Map, approve expenses, see org-wide data, edit their own timecards

### Ops Manager
Everything a DM can do, plus:
- View all data org-wide (not scoped to their team)
- DM Engagement dashboard
- App Health dashboard
- Approve supply/facility requests
- **Cannot**: approve expenses, create accountability docs (view only)

### Sales Director
Everything an ops manager can do, plus:
- Live Map access
- Approve expenses
- Edit any timecard (including locked timecards after DM submission)
- Payroll review and approval for all DMs
- Create accountability docs for DMs and employees
- View all DM Schedules

### Owner
Everything a sales director can do, plus:
- Final payroll approval and ADP CSV download
- Owner override on payroll (bypass all steps)
- Terminate employees
- Receives payroll ready notification

### Developer
Full access to everything, including:
- Super Admin (org management, user creation for any org)
- Config page
- Agent Inbox (AI agent review queue)
- App Health monitoring
- All debug/dev tools

## Barbershop Roles
- **Customer**: can book appointments, view own appointments
- **Barber**: manage appointments (confirm/decline/complete), manage own services/availability, view customers
- **Shop Owner**: everything a barber can do, plus Shop Setup (shop info, all barber management, QR code)

## "Why can't I see [feature]?"
If a feature doesn't appear in your nav, it's because your role doesn't have access. Check the table above for your role. If you believe you should have access, contact your manager or admin to verify your role assignment.
