import { NextRequest, NextResponse } from 'next/server'
import { getSession, canSubmitExpense, canApproveExpense, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import {
  sendEmail,
  expenseSubmittedHtml,
  expenseApprovedHtml,
  expenseRejectedHtml,
  expensePaidHtml,
} from '@/lib/notifications'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !canSubmitExpense(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  const orgFilter = await getOrgFilter(session)
  let rows: Record<string, unknown>[]

  if (session.role === 'developer' || isOwner(session.role)) {
    const params: unknown[] = []
    const orgClause = appendOrgFilter(orgFilter, params)
    const statusClause = status ? (params.push(status), `AND e.status = $${params.length}`) : ''
    rows = await query(
      `SELECT e.*, u.full_name as user_full_name, u.email as user_email,
              s.full_name as submitter_full_name,
              a.full_name as approver_full_name
       FROM expenses e
       JOIN users u ON u.id = e.user_id
       JOIN users s ON s.id = e.submitted_by
       LEFT JOIN users a ON a.id = e.approved_by
       WHERE 1=1${orgClause} ${statusClause}
       ORDER BY e.created_at DESC`,
      params
    ) as Record<string, unknown>[]
  } else {
    // Manager sees their own + their employees' expenses
    const params: unknown[] = [session.id]
    const statusClause = status ? (params.push(status), `AND e.status = $${params.length}`) : ''
    rows = await query(
      `SELECT e.*, u.full_name as user_full_name, u.email as user_email,
              s.full_name as submitter_full_name,
              a.full_name as approver_full_name
       FROM expenses e
       JOIN users u ON u.id = e.user_id
       JOIN users s ON s.id = e.submitted_by
       LEFT JOIN users a ON a.id = e.approved_by
       WHERE (e.user_id = $1 OR u.manager_id = $1) ${statusClause}
       ORDER BY e.created_at DESC`,
      params
    ) as Record<string, unknown>[]
  }

  // Generate signed view URLs for receipts
  const expenses = await Promise.all(
    rows.map(async (e) => {
      if (e.receipt_key) {
        try {
          e.receipt_url = await getReceiptViewUrl(e.receipt_key as string)
        } catch {
          e.receipt_url = null
        }
      }
      return e
    })
  )

  return NextResponse.json({ expenses })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canSubmitExpense(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, date, amount, category, description, receiptKey } = await req.json()
  if (!date || !amount || !category) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Owner/developer can submit on behalf of another user; otherwise it's self
  let finalUserId = session.id
  if ((isOwner(session.role) || session.role === 'developer') && userId) {
    finalUserId = userId
  }

  await query(
    `INSERT INTO expenses (user_id, submitted_by, date, amount, category, description, receipt_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [finalUserId, session.id, date, amount, category, description || null, receiptKey || null]
  )

  // Notify owner(s) of new expense
  const owners = await query<{ email: string }>(
    `SELECT email FROM users WHERE role = 'owner' AND is_active = true`
  )
  const ownerEmails = owners.map((o) => o.email)
  if (ownerEmails.length > 0) {
    await sendEmail(
      ownerEmails,
      `New Expense: ${category} — $${parseFloat(amount).toFixed(2)}`,
      expenseSubmittedHtml(session.fullName, parseFloat(amount).toFixed(2), category, description || '', date)
    )
  }

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !canApproveExpense(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { expenseId, action, rejectionReason } = await req.json()
  if (!expenseId || !action) {
    return NextResponse.json({ error: 'Missing expenseId or action' }, { status: 400 })
  }

  const expense = await queryOne<{
    user_id: string
    amount: string
    category: string
    date: string
    status: string
  }>(`SELECT user_id, amount, category, date, status FROM expenses WHERE id = $1`, [expenseId])

  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const user = await queryOne<{ email: string; full_name: string }>(
    `SELECT email, full_name FROM users WHERE id = $1`,
    [expense.user_id]
  )

  const amt = parseFloat(expense.amount).toFixed(2)

  if (action === 'approve') {
    if (expense.status !== 'pending') {
      return NextResponse.json({ error: 'Expense is not pending' }, { status: 400 })
    }
    await query(
      `UPDATE expenses SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2`,
      [session.id, expenseId]
    )
    if (user) {
      await sendEmail(
        user.email,
        `Expense Approved: ${expense.category} — $${amt}`,
        expenseApprovedHtml(user.full_name, amt, expense.category, expense.date)
      )
    }
  } else if (action === 'reject') {
    if (!rejectionReason?.trim()) {
      return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 })
    }
    if (expense.status !== 'pending') {
      return NextResponse.json({ error: 'Expense is not pending' }, { status: 400 })
    }
    await query(
      `UPDATE expenses SET status = 'rejected', approved_by = $1, approved_at = now(), rejection_reason = $2 WHERE id = $3`,
      [session.id, rejectionReason.trim(), expenseId]
    )
    if (user) {
      await sendEmail(
        user.email,
        `Expense Not Approved: ${expense.category} — $${amt}`,
        expenseRejectedHtml(user.full_name, amt, expense.category, expense.date, rejectionReason.trim())
      )
    }
  } else if (action === 'pay') {
    if (expense.status !== 'approved') {
      return NextResponse.json({ error: 'Expense must be approved before marking paid' }, { status: 400 })
    }
    await query(
      `UPDATE expenses SET status = 'paid', paid_at = now() WHERE id = $1`,
      [expenseId]
    )
    if (user) {
      await sendEmail(
        user.email,
        `Expense Paid: ${expense.category} — $${amt}`,
        expensePaidHtml(user.full_name, amt, expense.category, expense.date)
      )
    }
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
