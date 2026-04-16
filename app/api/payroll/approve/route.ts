import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

function emailBlock(title: string, subtitle: string, bodyHtml: string, btnText?: string, btnHref?: string): string {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">${subtitle}</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:16px;font-weight:700;color:#1c1c1e;margin:0 0 12px;">${title}</p>
        ${bodyHtml}
        ${btnText && btnHref ? `<a href="${btnHref}" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-top:16px;">${btnText}</a>` : ''}
      </div>
    </div>
  `
}

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { periodId, type } = await req.json()
  if (!periodId || !type) return NextResponse.json({ error: 'periodId and type required' }, { status: 400 })

  const period = await queryOne<{
    id: string; org_id: string; period_start: string; period_end: string; status: string
  }>('SELECT id, org_id, period_start::text, period_end::text, status FROM payroll_periods WHERE id = $1', [periodId])
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const periodLabel = fmtPeriod(period.period_start, period.period_end)

  // DM approval
  if (type === 'dm') {
    if (session.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await queryOne(`
      INSERT INTO payroll_dm_approvals (period_id, dm_id)
      VALUES ($1, $2)
      ON CONFLICT (period_id, dm_id) DO NOTHING
    `, [periodId, session.id])

    // Check if all DMs have approved
    const totalDMs = await queryOne<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM users
      WHERE org_id = $1 AND role = 'manager' AND is_active = TRUE
    `, [period.org_id])

    const approvedDMs = await queryOne<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM payroll_dm_approvals
      WHERE period_id = $1
    `, [periodId])

    const total = parseInt(totalDMs?.count ?? '0')
    const approved = parseInt(approvedDMs?.count ?? '0')

    if (total > 0 && approved >= total) {
      // All DMs approved — update status and notify SR
      await query(`UPDATE payroll_periods SET status = 'pending_sr' WHERE id = $1`, [periodId])

      const srUsers = await query<{ email: string; full_name: string }>(`
        SELECT email, full_name FROM users
        WHERE org_id = $1 AND role IN ('sales_director', 'ops_manager') AND is_active = TRUE
      `, [period.org_id])

      for (const sr of srUsers) {
        sendEmail(
          sr.email,
          `Action Required: Approve Payroll for ${periodLabel}`,
          emailBlock(
            'All DMs have approved payroll',
            'Payroll Approval Required',
            `<p style="font-size:14px;color:#555;margin:0 0 8px;">Hi ${sr.full_name},</p>
             <p style="font-size:14px;color:#555;margin:0 0 8px;">All DMs have approved payroll for <strong>${periodLabel}</strong>. Your approval is needed to finalize.</p>
             <p style="font-size:14px;color:#555;margin:0;">Log in to Field Manager Pro and navigate to <strong>Payroll</strong> to review and approve.</p>`,
            'Review & Approve Payroll',
            `${APP_URL}/payroll`
          )
        ).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true })
  }

  // SR approval (sales_director or ops_manager)
  if (type === 'sr') {
    if (!isOwner(session.role as never) && session.role !== 'ops_manager' && session.role !== 'developer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (period.status === 'approved') {
      return NextResponse.json({ error: 'Already approved' }, { status: 400 })
    }

    await query(`
      UPDATE payroll_periods
      SET status = 'approved', sr_approved_by = $1, sr_approved_at = NOW()
      WHERE id = $2
    `, [session.id, periodId])

    // Notify owners
    const owners = await query<{ email: string; full_name: string }>(`
      SELECT email, full_name FROM users
      WHERE org_id = $1 AND role = 'owner' AND is_active = TRUE
    `, [period.org_id])

    for (const owner of owners) {
      sendEmail(
        owner.email,
        `Payroll Approved for ${periodLabel}`,
        emailBlock(
          'Payroll has been approved',
          'Payroll Approved',
          `<p style="font-size:14px;color:#555;margin:0 0 8px;">Hi ${owner.full_name},</p>
           <p style="font-size:14px;color:#555;margin:0 0 8px;">Payroll for <strong>${periodLabel}</strong> has been approved by <strong>${session.fullName}</strong>.</p>
           <p style="font-size:14px;color:#555;margin:0;">Log in to download the ADP-ready payroll CSV.</p>`,
          'Download Payroll CSV',
          `${APP_URL}/payroll`
        )
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
}
