import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'

// Runs every 5 minutes — auto-triages new escalated support conversations
// Checks the user's account for common issues and either auto-replies or notifies dev team

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find escalated conversations that haven't been triaged yet
  await query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS auto_triaged BOOLEAN DEFAULT FALSE`).catch(() => {})

  const escalated = await query<{
    id: string; user_id: string; user_name: string; escalation_reason: string | null
    first_question: string | null
  }>(`
    SELECT sc.id, sc.user_id, sc.user_name, sc.escalation_reason,
           (SELECT scm.body FROM support_conversation_messages scm
            WHERE scm.conversation_id = sc.id AND scm.role = 'user'
            ORDER BY scm.created_at LIMIT 1) as first_question
    FROM support_conversations sc
    WHERE sc.status = 'escalated'
      AND COALESCE(sc.auto_triaged, FALSE) = FALSE
    ORDER BY sc.created_at DESC
    LIMIT 5
  `)

  if (escalated.length === 0) {
    return NextResponse.json({ ok: true, triaged: 0 })
  }

  const results: { id: string; user: string; action: string }[] = []

  for (const conv of escalated) {
    // Mark as triaged immediately to avoid re-processing
    await query(`UPDATE support_conversations SET auto_triaged = TRUE WHERE id = $1`, [conv.id])

    const diagnosis: string[] = []
    let autoResolvable = false
    let autoReply = ''

    // Get user details
    const user = await queryOne<{
      id: string; full_name: string; role: string; is_active: boolean
      is_terminated: boolean; manager_id: string | null; manager_name: string | null
      org_id: string | null; pay_type: string
    }>(`
      SELECT u.id, u.full_name, u.role, u.is_active, u.is_terminated,
             u.manager_id, m.full_name as manager_name, u.org_id, u.pay_type
      FROM users u
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.id = $1
    `, [conv.user_id])

    if (!user) {
      diagnosis.push('User not found in database')
    } else {
      const question = (conv.first_question || conv.escalation_reason || '').toLowerCase()

      // ── Check: Clock-in / location issues ──
      if (question.includes('clock') || question.includes('location') || question.includes('gps') || question.includes('freeze')) {
        // Check for stuck active shift
        const activeShift = await queryOne<{ id: string; clock_in_at: string }>(`
          SELECT id, clock_in_at::text FROM shifts
          WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
        `, [user.id])

        if (activeShift) {
          const hoursActive = (Date.now() - new Date(activeShift.clock_in_at).getTime()) / 3600000
          diagnosis.push(`Active shift found (${hoursActive.toFixed(1)}h — clocked in at ${activeShift.clock_in_at})`)
          if (hoursActive > 14) {
            diagnosis.push('Shift is >14 hours — likely stuck/forgotten. Auto clock-out cron should handle at 9 PM.')
          }
        } else {
          diagnosis.push('No active shift — not currently clocked in')
        }

        // Check store assignment
        if (user.role === 'employee') {
          const storeCount = await queryOne<{ cnt: number }>(`
            SELECT COUNT(*)::int as cnt FROM dm_manager_stores dms
            JOIN dm_store_locations dsl ON dsl.id = dms.store_location_id
            WHERE dms.manager_id = $1 AND dsl.active = TRUE
          `, [user.manager_id])
          if (!storeCount || storeCount.cnt === 0) {
            diagnosis.push('NO STORES ASSIGNED to manager — employee cannot select a store to clock in')
            autoResolvable = false
          } else {
            diagnosis.push(`${storeCount.cnt} stores available via manager ${user.manager_name}`)
          }
        }

        // Check recent GPS breadcrumbs
        const recentGps = await queryOne<{ cnt: number; latest: string | null }>(`
          SELECT COUNT(*)::int as cnt,
                 MAX(recorded_at)::text as latest
          FROM gps_breadcrumbs
          WHERE user_id = $1 AND recorded_at > NOW() - INTERVAL '7 days'
        `, [user.id])
        if (recentGps && recentGps.cnt > 0) {
          diagnosis.push(`${recentGps.cnt} GPS breadcrumbs in last 7 days (latest: ${recentGps.latest})`)
        } else {
          diagnosis.push('No GPS breadcrumbs in last 7 days — device GPS may not be working')
        }

        // Check geofence settings
        const geo = await queryOne<{ geofence_enabled: boolean; geofence_radius_ft: number }>(`
          SELECT COALESCE(geofence_enabled, TRUE) as geofence_enabled,
                 COALESCE(geofence_radius_ft, 300) as geofence_radius_ft
          FROM organizations WHERE id = $1
        `, [user.org_id]).catch(() => null)
        if (geo?.geofence_enabled) {
          diagnosis.push(`Geofencing is ON (${geo.geofence_radius_ft}ft radius) — GPS required for employees`)
        }

        // Check last successful clock-in
        const lastShift = await queryOne<{ clock_in_at: string; store_address: string | null }>(`
          SELECT s.clock_in_at::text,
                 sl.address as store_address
          FROM shifts s
          LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
          WHERE s.user_id = $1 AND s.clock_out_at IS NOT NULL
          ORDER BY s.clock_in_at DESC LIMIT 1
        `, [user.id])
        if (lastShift) {
          diagnosis.push(`Last successful shift: ${lastShift.clock_in_at} at ${lastShift.store_address || 'unknown store'}`)
        }
      }

      // ── Check: Schedule issues ──
      if (question.includes('schedule') || question.includes('shift') || question.includes('work')) {
        const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
        const scheduled = await queryOne<{ cnt: number }>(`
          SELECT COUNT(*)::int as cnt FROM scheduled_shifts
          WHERE employee_id = $1 AND shift_date = $2
        `, [user.id, todayCST])
        diagnosis.push(`Scheduled today: ${scheduled?.cnt || 0} shift(s)`)

        // Check if schedule is published
        const published = await queryOne<{ cnt: number }>(`
          SELECT COUNT(*)::int as cnt FROM scheduled_shifts_publish
          WHERE week_start BETWEEN ($1::date - 6) AND $1::date
        `, [todayCST])
        if (!published || published.cnt === 0) {
          diagnosis.push('No published schedule for this week — employee sees empty My Schedule')
        }
      }

      // ── Check: Pay / timecard issues ──
      if (question.includes('pay') || question.includes('hour') || question.includes('time') || question.includes('stub')) {
        diagnosis.push(`Pay type: ${user.pay_type || 'hourly'}`)
        diagnosis.push('Pay stubs are handled outside FMP (ADP) — not an app issue')
      }

      // ── Check: Account issues ──
      if (!user.is_active) {
        diagnosis.push('ACCOUNT IS INACTIVE — cannot log in or clock in')
      }
      if (user.is_terminated) {
        diagnosis.push('ACCOUNT IS TERMINATED')
      }
      if (!user.manager_id) {
        diagnosis.push('NO MANAGER ASSIGNED — invisible to all DMs')
      }
    }

    // Build notification for dev team
    const diagText = diagnosis.length > 0 ? diagnosis.join('\n• ') : 'No issues detected'
    const summary = `Auto-triage for ${conv.user_name}:\nQuestion: ${conv.first_question || 'N/A'}\nEscalation: ${conv.escalation_reason || 'N/A'}\n\nFindings:\n• ${diagText}`

    // Notify developer/owner
    const devs = await query<{ id: string; email: string }>(`
      SELECT id, email FROM users WHERE role IN ('developer', 'owner') AND is_active = TRUE
    `)

    for (const dev of devs) {
      sendPushToUser(
        dev.id,
        `Escalation Auto-Triage: ${conv.user_name}`,
        `${conv.first_question || conv.escalation_reason || 'Support issue'}. ${diagnosis.length} findings.`,
        'support_reply'
      ).catch(() => {})
    }

    // Send email with full diagnosis
    if (devs.length > 0) {
      const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#7c3aed;padding:16px 20px;border-radius:12px 12px 0 0;">
          <h2 style="color:white;margin:0;font-size:16px;">Escalation Auto-Triage</h2>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${conv.user_name} — ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;background:white;">
          <p style="font-size:13px;color:#6b7280;margin:0 0 4px;">Question</p>
          <p style="font-size:14px;color:#111;margin:0 0 16px;font-weight:600;">${conv.first_question || 'N/A'}</p>
          <p style="font-size:13px;color:#6b7280;margin:0 0 4px;">Escalation Reason</p>
          <p style="font-size:14px;color:#111;margin:0 0 16px;">${conv.escalation_reason || 'N/A'}</p>
          <p style="font-size:13px;color:#6b7280;margin:0 0 8px;">Auto-Triage Findings</p>
          ${diagnosis.map(d => {
            const isCritical = d.includes('NO ') || d.includes('INACTIVE') || d.includes('TERMINATED')
            return `<div style="padding:6px 10px;margin-bottom:4px;border-left:3px solid ${isCritical ? '#dc2626' : '#7c3aed'};background:${isCritical ? '#fef2f2' : '#f5f3ff'};border-radius:0 6px 6px 0;">
              <p style="margin:0;font-size:13px;color:#111;">${d}</p>
            </div>`
          }).join('')}
          <a href="https://fieldmanagerpro.app/admin/agents" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:13px;padding:10px 20px;border-radius:8px;margin-top:12px;">Open Agent Inbox</a>
        </div>
      </div>`

      sendEmail(
        devs.map(d => d.email),
        `Escalation Triage: ${conv.user_name} — ${conv.first_question?.slice(0, 50) || 'Support issue'}`,
        html
      ).catch(() => {})
    }

    results.push({ id: conv.id, user: conv.user_name, action: `Triaged: ${diagnosis.length} findings, notified ${devs.length} dev(s)` })
  }

  return NextResponse.json({ ok: true, triaged: results.length, results })
}
