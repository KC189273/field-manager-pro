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

// Returns the ISO string for the Monday after periodEnd (Sunday) at 8PM CDT
function nextMondayAt8pmCst(periodEnd: string): string {
  // periodEnd is Sunday — add 1 day to get Monday
  const d = new Date(periodEnd + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  const monday = d.toISOString().split('T')[0]
  return `${monday}T20:00:00-05:00`
}

// Returns the Monday of the current week as YYYY-MM-DD
function currentWeekMonday(): string {
  const now = new Date()
  const cstDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const day = cstDate.getDay() // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(cstDate)
  monday.setDate(cstDate.getDate() + diff)
  return monday.toISOString().split('T')[0]
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { periodId, type, dmId } = body as { periodId: string; type: string; dmId?: string }

  if (!periodId || !type) {
    return NextResponse.json({ error: 'periodId and type required' }, { status: 400 })
  }

  const period = await queryOne<{
    id: string
    org_id: string
    period_start: string
    period_end: string
    status: string
  }>('SELECT id, org_id, period_start::text, period_end::text, status FROM payroll_periods WHERE id = $1', [periodId])

  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const periodLabel = fmtPeriod(period.period_start, period.period_end)

  // ── DM: Lock & Submit Timecards ──
  if (type === 'dm') {
    if (session.role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await queryOne(`
      INSERT INTO payroll_dm_approvals (period_id, dm_id)
      VALUES ($1, $2)
      ON CONFLICT (period_id, dm_id) DO NOTHING
    `, [periodId, session.id])

    // Find primary SD in org (first active sales_director, fallback ops_manager)
    const sdUser = await queryOne<{ id: string; email: string; full_name: string }>(`
      SELECT id, email, full_name FROM users
      WHERE org_id = $1
        AND role = 'sales_director'
        AND is_active = TRUE
      LIMIT 1
    `, [period.org_id])

    const srUser = sdUser ?? await queryOne<{ id: string; email: string; full_name: string }>(`
      SELECT id, email, full_name FROM users
      WHERE org_id = $1
        AND role = 'ops_manager'
        AND is_active = TRUE
      LIMIT 1
    `, [period.org_id])

    if (srUser) {
      sendEmail(
        srUser.email,
        `Payroll Submitted – ${session.fullName}'s team – ${periodLabel}`,
        emailBlock(
          `${session.fullName} has submitted payroll`,
          'Payroll Review Required',
          `<p style="font-size:14px;color:#555;margin:0 0 8px;">Hi ${srUser.full_name},</p>
           <p style="font-size:14px;color:#555;margin:0 0 8px;"><strong>${session.fullName}</strong> has locked and submitted timecards for <strong>${periodLabel}</strong>.</p>
           <p style="font-size:14px;color:#555;margin:0;">Please download and review their timecard, then mark it approved in Field Manager Pro.</p>`,
          'Review Payroll',
          `${APP_URL}/payroll`
        )
      ).catch(() => {})

      // Create task for SD
      const dueDate = nextMondayAt8pmCst(period.period_end)
      const weekStart = currentWeekMonday()

      await queryOne(`
        INSERT INTO tasks (org_id, week_start, title, description, assignee_id, due_date, created_by, created_at)
        VALUES ($1, $2::date, $3, $4, $5, $6::timestamptz, $7, NOW())
      `, [
        period.org_id,
        weekStart,
        `Review payroll – ${session.fullName}'s team`,
        `Pay period: ${periodLabel}. Review and download the timecard CSV, then mark approved in Field Manager Pro.`,
        srUser.id,
        dueDate,
        session.id,
      ])
    }

    return NextResponse.json({ ok: true })
  }

  // ── SR Approve: SD approves one DM's timecards ──
  if (type === 'sr_approve') {
    const allowed = ['sales_director', 'ops_manager', 'developer', 'owner'].includes(session.role)
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!dmId) {
      return NextResponse.json({ error: 'dmId required for sr_approve' }, { status: 400 })
    }

    // Verify downloaded_at is set (unless owner/developer bypassing)
    const isOverride = session.role === 'owner' || session.role === 'developer'
    if (!isOverride) {
      const srRow = await queryOne<{ downloaded_at: string | null }>(`
        SELECT downloaded_at FROM payroll_sr_approvals
        WHERE period_id = $1 AND dm_id = $2
      `, [periodId, dmId])
      if (!srRow || !srRow.downloaded_at) {
        return NextResponse.json({ error: 'You must download the timecard before approving' }, { status: 400 })
      }
    }

    await queryOne(`
      INSERT INTO payroll_sr_approvals (period_id, dm_id, sr_user_id, approved_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (period_id, dm_id) DO UPDATE
        SET approved_at = NOW(), sr_user_id = $3
    `, [periodId, dmId, session.id])

    return NextResponse.json({ ok: true })
  }

  // ── Final: SD submits final payroll approval for entire org ──
  if (type === 'final') {
    const allowed = ['sales_director', 'ops_manager', 'developer', 'owner'].includes(session.role)
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const isOverride = session.role === 'owner' || session.role === 'developer'

    if (!isOverride) {
      // Verify ALL active DMs have dm_approvals AND sr_approvals with approved_at
      const activeDMs = await query<{ id: string }>(`
        SELECT id FROM users
        WHERE org_id = $1 AND role = 'manager' AND is_active = TRUE
      `, [period.org_id])

      for (const dm of activeDMs) {
        const dmApproval = await queryOne(`
          SELECT 1 FROM payroll_dm_approvals
          WHERE period_id = $1 AND dm_id = $2
        `, [periodId, dm.id])

        if (!dmApproval) {
          return NextResponse.json({ error: 'Not all DMs have submitted their timecards' }, { status: 400 })
        }

        const srApproval = await queryOne(`
          SELECT 1 FROM payroll_sr_approvals
          WHERE period_id = $1 AND dm_id = $2 AND approved_at IS NOT NULL
        `, [periodId, dm.id])

        if (!srApproval) {
          return NextResponse.json({ error: 'Not all DM timecards have been approved by SR' }, { status: 400 })
        }
      }
    }

    await queryOne(`
      UPDATE payroll_periods
      SET status = 'approved', final_submitted_at = NOW(), final_submitted_by = $1
      WHERE id = $2
    `, [session.id, periodId])

    // Email all owners in org
    const owners = await query<{ email: string; full_name: string }>(`
      SELECT email, full_name FROM users
      WHERE org_id = $1 AND role = 'owner' AND is_active = TRUE
    `, [period.org_id])

    for (const owner of owners) {
      sendEmail(
        owner.email,
        `Payroll Approved – ${periodLabel}`,
        emailBlock(
          'Payroll has been approved and submitted',
          'Payroll Approved',
          `<p style="font-size:14px;color:#555;margin:0 0 8px;">Hi ${owner.full_name},</p>
           <p style="font-size:14px;color:#555;margin:0 0 8px;">Payroll for <strong>${periodLabel}</strong> has been finalized and submitted by <strong>${session.fullName}</strong>.</p>
           <p style="font-size:14px;color:#555;margin:0;">You can download the ADP-ready payroll CSV from Field Manager Pro.</p>`,
          'Download Payroll CSV',
          `${APP_URL}/payroll`
        )
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  }

  // ── Owner Override: bypass all steps ──
  if (type === 'owner_override') {
    const allowed = session.role === 'owner' || session.role === 'developer'
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const activeDMs = await query<{ id: string }>(`
      SELECT id FROM users
      WHERE org_id = $1 AND role = 'manager' AND is_active = TRUE
    `, [period.org_id])

    for (const dm of activeDMs) {
      await queryOne(`
        INSERT INTO payroll_dm_approvals (period_id, dm_id)
        VALUES ($1, $2)
        ON CONFLICT (period_id, dm_id) DO NOTHING
      `, [periodId, dm.id])

      await queryOne(`
        INSERT INTO payroll_sr_approvals (period_id, dm_id, sr_user_id, approved_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (period_id, dm_id) DO UPDATE
          SET approved_at = COALESCE(payroll_sr_approvals.approved_at, NOW()),
              sr_user_id = COALESCE(payroll_sr_approvals.sr_user_id, $3)
      `, [periodId, dm.id, session.id])
    }

    await queryOne(`
      UPDATE payroll_periods
      SET status = 'approved', final_submitted_at = NOW(), final_submitted_by = $1
      WHERE id = $2
    `, [session.id, periodId])

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
}
