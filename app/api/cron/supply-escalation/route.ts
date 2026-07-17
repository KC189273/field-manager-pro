import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUsers } from '@/lib/apns'

// Runs every 30 minutes.
// 1. Pending requests past order deadline → alert SD/Owner/Dev, mark order_escalated_at
// 2. Ordered requests past receipt deadline → alert SD/Owner/Dev, mark receipt_escalated_at

export async function GET() {
  let orderEscalations = 0
  let receiptEscalations = 0

  // ── 1. Overdue pending (DM hasn't ordered) ──
  const overdueOrders = await query<{
    id: string
    item_name: string
    employee_name: string
    manager_name: string | null
    org_id: string | null
  }>(
    `SELECT id, item_name, employee_name, manager_name, org_id
     FROM supply_requests
     WHERE status = 'pending'
       AND order_escalated_at IS NULL
       AND created_at < NOW() - (
         CASE urgency WHEN 1 THEN INTERVAL '24 hours'
                      WHEN 2 THEN INTERVAL '72 hours'
                      ELSE         INTERVAL '168 hours' END
       )`
  ).catch(() => [])

  for (const r of overdueOrders) {
    if (r.org_id) {
      const recipients = await query<{ id: string }>(
        `SELECT u.id FROM users u
         LEFT JOIN notification_preferences np ON np.user_id = u.id
         WHERE u.org_id = $1 AND u.role IN ('sales_director', 'owner', 'developer') AND u.is_active = TRUE
           AND COALESCE(np.supply_requests, TRUE) = TRUE
           AND COALESCE(np.push_enabled, TRUE) = TRUE`,
        [r.org_id]
      )
      if (recipients.length > 0) {
        sendPushToUsers(
          recipients.map(u => u.id),
          'Supply Request Overdue',
          `${r.manager_name ?? 'A DM'} has not ordered "${r.item_name}" (requested by ${r.employee_name}).`,
          'supply_escalation'
        ).catch(() => {})
      }
    }
    await query(
      `UPDATE supply_requests SET order_escalated_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [r.id]
    )
    orderEscalations++
  }

  // ── 2. Overdue ordered (employee hasn't confirmed receipt) ──
  const overdueReceipts = await query<{
    id: string
    item_name: string
    employee_name: string
    manager_name: string | null
    org_id: string | null
  }>(
    `SELECT id, item_name, employee_name, manager_name, org_id
     FROM supply_requests
     WHERE status = 'ordered'
       AND receipt_escalated_at IS NULL
       AND ordered_at < NOW() - (
         CASE urgency WHEN 1 THEN INTERVAL '24 hours'
                      WHEN 2 THEN INTERVAL '72 hours'
                      ELSE         INTERVAL '168 hours' END
       )`
  ).catch(() => [])

  for (const r of overdueReceipts) {
    if (r.org_id) {
      const recipients = await query<{ id: string }>(
        `SELECT u.id FROM users u
         LEFT JOIN notification_preferences np ON np.user_id = u.id
         WHERE u.org_id = $1 AND u.role IN ('sales_director', 'owner', 'developer') AND u.is_active = TRUE
           AND COALESCE(np.supply_requests, TRUE) = TRUE
           AND COALESCE(np.push_enabled, TRUE) = TRUE`,
        [r.org_id]
      )
      if (recipients.length > 0) {
        sendPushToUsers(
          recipients.map(u => u.id),
          'Supplies Not Confirmed Received',
          `${r.employee_name} has not confirmed receipt of "${r.item_name}" — ordered by ${r.manager_name ?? 'the DM'}.`,
          'supply_escalation'
        ).catch(() => {})
      }
    }
    await query(
      `UPDATE supply_requests SET receipt_escalated_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [r.id]
    )
    receiptEscalations++
  }

  return NextResponse.json({ ok: true, orderEscalations, receiptEscalations })
}
