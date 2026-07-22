# Calendar Access — "Your role does not have a personal calendar"

## Symptom
You try to create a calendar event and get the error "Your role does not have a personal calendar. Specify ownerId."

## Why It Happens
Only certain roles have their own personal calendar:
- **DMs (managers)** — have a personal calendar
- **Sales Directors** — have a personal calendar

Other roles (ops manager, owner, developer) can VIEW calendars but don't have their own. When they create events, they must specify which DM's or SD's calendar to add it to.

Employees do not have access to the Calendar page at all.

## Who Can Do What

| Role | Can see Calendar? | Has own calendar? | Can create events? |
|------|------------------|------------------|-------------------|
| Employee | No | No | No |
| DM (manager) | Yes | Yes | Yes, on their own calendar |
| Ops Manager | Yes | No | Yes, must pick a calendar owner |
| Sales Director | Yes | Yes | Yes, on their own calendar |
| Owner | Yes | No | Yes, must pick a calendar owner |
| Developer | Yes | No | Yes, must pick a calendar owner |

## How to Fix
- **If you're an ops manager, owner, or developer:** When creating an event, select which DM's or SD's calendar to add it to from the dropdown.
- **If you're an employee:** Calendar is not available for your role. Events relevant to you will appear in your notifications if your DM creates them.

## When to Report as a Bug
If you're a DM or SD and still get this error, report it — your role should have a personal calendar.
