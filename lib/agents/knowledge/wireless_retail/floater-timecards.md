# Floater Timecards — Why Can't I See a Floater's Timecard?

## The Short Answer

A DM can only see timecards for employees whose `manager_id` is set to that DM's user ID. This is the single filter — there is no store-based or floater-based override. A floater who is assigned to DM-A (via `manager_id`) will not appear in DM-B's timecards, even if the floater worked in DM-B's store that week.

## Why This Happens

The timecards page queries shifts with `WHERE u.manager_id = [your user ID]`. It does not check which store the employee clocked into or whether the employee is marked as a floater. The `is_floater` flag on a user record is used for OT watch alerts (so all DMs see floater OT projections) but does NOT affect timecard visibility.

This means:
- If a floater is assigned to your district (`manager_id` = you), you see all their timecards — even shifts at other DMs' stores.
- If a floater is NOT assigned to you, you cannot see their timecards at all, even if they worked your stores.

## How to Fix It — Steps for the SD or Admin

To give a DM access to a floater's timecard, the floater's `manager_id` must be changed to that DM:

1. Go to **Team** in the app.
2. Find the floater (they'll have a "Floater" badge next to their name).
3. Tap the floater to open their profile.
4. Tap **Edit**.
5. Change the **Manager** dropdown to the DM who needs access.
6. Save.

The floater's timecards will now appear under that DM's timecard view immediately.

**Important:** Only one DM can be assigned at a time. Changing the manager means the previous DM loses access to that floater's timecards. The SD, owner, and developer can always see all timecards regardless of `manager_id`.

## Who Can See What (Quick Reference)

| Role | What they see in Timecards |
|------|---------------------------|
| Employee | Their own timecards only |
| DM (manager) | Timecards for employees where `manager_id` = their ID |
| Ops Manager | All timecards in their org |
| Sales Director | All timecards in their org |
| Owner | All timecards in their org |
| Developer | All timecards |

## Related: OT Watch Shows Floaters Differently

The OT Watch panel on the timecards page DOES show floaters to all DMs (using `OR is_floater = TRUE`). So you might see a floater's OT projection without being able to see their actual timecard. This is intentional — OT alerts are cross-district, but timecard management stays with the assigned DM.
