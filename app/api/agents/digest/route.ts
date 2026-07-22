import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const VERTICAL_LABELS: Record<string, string> = {
  wireless_retail: 'Wireless Retail',
  barbershop: 'Barbershop',
}

function verticalLabel(industry: string | null): string {
  return VERTICAL_LABELS[industry ?? ''] ?? industry ?? 'Unknown'
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const digestEmail = process.env.ADMIN_DIGEST_EMAIL
  if (!digestEmail) {
    return NextResponse.json({ error: 'ADMIN_DIGEST_EMAIL not set' }, { status: 500 })
  }

  // 1. Accounts that moved to at_risk/churning today
  const atRisk = await query<{
    account_name: string; industry: string; score: number; status: string; explanation: string
  }>(`
    SELECT o.name AS account_name, COALESCE(o.industry, 'unknown') AS industry,
      ah.score, ah.status, COALESCE(ah.signals->>'explanation', '') AS explanation
    FROM account_health ah
    JOIN organizations o ON o.id = ah.account_id
    WHERE ah.snapshot_date = CURRENT_DATE
      AND ah.status IN ('at_risk', 'churning')
    ORDER BY ah.score
  `)

  // 2. Pending drafts count
  const pendingRow = await queryOne<{ count: number }>(`
    SELECT COUNT(*)::int AS count FROM agent_actions WHERE status = 'pending'
  `)
  const pendingCount = pendingRow?.count ?? 0

  // 3. What auto-ran today
  const autoRan = await query<{
    agent: string; count: number
  }>(`
    SELECT aa.agent, COUNT(*)::int AS count
    FROM agent_actions aa
    WHERE aa.status = 'auto_executed' AND aa.created_at >= CURRENT_DATE
    GROUP BY aa.agent
  `)

  // 4. Accounts with unsupported verticals (no provider, couldn't be scored today)
  const unsupported = await query<{ name: string; industry: string }>(`
    SELECT o.name, o.industry FROM organizations o
    WHERE o.status != 'deleted'
      AND o.industry NOT IN ('wireless_retail', 'barbershop')
  `)

  // 5. Any runs with errors today
  const errors = await query<{
    agent: string; error: string; created_at: string
  }>(`
    SELECT agent, error, created_at::text
    FROM agent_runs
    WHERE status = 'error' AND created_at >= CURRENT_DATE
    ORDER BY created_at DESC
  `)

  // 5. Today's spend
  const spendRow = await queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(cost_usd), 0)::float AS total FROM agent_runs WHERE created_at >= CURRENT_DATE
  `)

  // Build the email HTML
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

  let html = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Agent Crew Daily Digest</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
  `

  // At-risk accounts
  if (atRisk.length > 0) {
    html += `<h2 style="font-size:16px;color:#dc2626;margin:0 0 12px;">⚠ Accounts At Risk</h2>`
    for (const a of atRisk) {
      html += `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:8px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#1c1c1e;">${a.account_name}
            <span style="font-weight:400;color:#888;font-size:12px;"> · ${verticalLabel(a.industry)}</span>
          </p>
          <p style="margin:4px 0 0;font-size:13px;color:#555;">Score: ${a.score}/100 · Status: <strong>${a.status}</strong></p>
          <p style="margin:4px 0 0;font-size:13px;color:#555;">${a.explanation}</p>
        </div>
      `
    }
  } else {
    html += `<p style="font-size:14px;color:#22c55e;margin:0 0 16px;">✅ No accounts moved to at-risk or churning today.</p>`
  }

  // Pending drafts
  html += `<div style="border-top:1px solid #eee;margin:16px 0;padding-top:16px;">`
  if (pendingCount > 0) {
    html += `<p style="font-size:14px;color:#1c1c1e;margin:0;"><strong>${pendingCount}</strong> draft${pendingCount !== 1 ? 's' : ''} waiting for your review.</p>`
  } else {
    html += `<p style="font-size:14px;color:#888;margin:0;">No drafts pending review.</p>`
  }
  html += `</div>`

  // Auto-ran
  if (autoRan.length > 0) {
    html += `<div style="border-top:1px solid #eee;margin:16px 0;padding-top:16px;">`
    html += `<p style="font-size:13px;color:#888;margin:0 0 4px;">Auto-ran today:</p>`
    for (const a of autoRan) {
      html += `<p style="font-size:13px;color:#555;margin:2px 0;">${a.agent}: ${a.count} action${a.count !== 1 ? 's' : ''}</p>`
    }
    html += `</div>`
  }

  // Unsupported verticals
  if (unsupported.length > 0) {
    html += `<div style="border-top:1px solid #eee;margin:16px 0;padding-top:16px;">`
    html += `<h3 style="font-size:14px;color:#dc2626;margin:0 0 8px;">🔴 Unsupported Verticals — Cannot Score</h3>`
    for (const u of unsupported) {
      html += `<p style="font-size:13px;color:#dc2626;margin:2px 0;"><strong>${u.name}</strong> has vertical "${u.industry}" which has no signal provider. This account was NOT scored. Add a provider to fix.</p>`
    }
    html += `</div>`
  }

  // Errors
  if (errors.length > 0) {
    html += `<div style="border-top:1px solid #eee;margin:16px 0;padding-top:16px;">`
    html += `<h3 style="font-size:14px;color:#dc2626;margin:0 0 8px;">🔴 Errors</h3>`
    for (const e of errors) {
      html += `<p style="font-size:12px;color:#dc2626;margin:2px 0;"><strong>${e.agent}:</strong> ${e.error}</p>`
    }
    html += `</div>`
  }

  // Spend
  html += `<div style="border-top:1px solid #eee;margin:16px 0;padding-top:16px;">`
  html += `<p style="font-size:12px;color:#888;margin:0;">Today's agent spend: $${(spendRow?.total ?? 0).toFixed(4)}</p>`
  html += `</div>`

  // CTA
  html += `
        <a href="${appUrl}/admin/agents" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-top:16px;">Open Agent Inbox</a>
      </div>
    </div>
  `

  await sendEmail(digestEmail, `Agent Digest — ${atRisk.length} at-risk, ${pendingCount} pending`, html)

  return NextResponse.json({
    ok: true,
    atRisk: atRisk.length,
    pending: pendingCount,
    autoRan: autoRan.reduce((s, a) => s + a.count, 0),
    errors: errors.length,
    unsupportedVerticals: unsupported.length,
  })
}
