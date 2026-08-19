import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MODEL = 'claude-haiku-4-5-20251001'

// Runs daily at 8:30 AM CST — sends each DM a personalized daily game plan
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const dayName = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' })

  const dms = await query<{ id: string; full_name: string; email: string; org_id: string | null }>(`
    SELECT id, full_name, email, org_id FROM users
    WHERE role = 'manager' AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)
  `)

  let sent = 0

  for (const dm of dms) {
    try {
      // Gather context for this DM
      const data: Record<string, unknown> = { dm_name: dm.full_name.split(' ')[0], day: dayName }

      // Team scheduled today
      const scheduled = await query<{ full_name: string; store_address: string; start_time: string; end_time: string }>(`
        SELECT u.full_name, sl.address as store_address, ss.start_time::text, ss.end_time::text
        FROM scheduled_shifts ss
        JOIN users u ON u.id = ss.employee_id
        JOIN dm_store_locations sl ON sl.id = ss.store_location_id
        WHERE u.manager_id = $1 AND ss.shift_date = $2
        ORDER BY ss.start_time
      `, [dm.id, todayCST]).catch(() => [])
      data.scheduled_today = scheduled.length > 0 ? scheduled.map(s => `${s.full_name} at ${s.store_address.split(',')[0]} (${s.start_time.slice(0,5)}-${s.end_time.slice(0,5)})`).join('; ') : 'No one scheduled'

      // Coaching grades — weakest area
      const coachingAvg = await queryOne<{ avg_score: number; weakest: string; weakest_score: number }>(`
        SELECT ROUND(AVG(overall_score))::int as avg_score,
          (SELECT cat FROM (
            SELECT 'specificity' as cat, AVG(specificity_score) as s FROM coaching_grades WHERE dm_id = $1 AND graded_at >= NOW() - INTERVAL '30 days'
            UNION ALL SELECT 'actionability', AVG(actionability_score) FROM coaching_grades WHERE dm_id = $1 AND graded_at >= NOW() - INTERVAL '30 days'
            UNION ALL SELECT 'follow_up', AVG(follow_up_score) FROM coaching_grades WHERE dm_id = $1 AND graded_at >= NOW() - INTERVAL '30 days'
            UNION ALL SELECT 'depth', AVG(depth_score) FROM coaching_grades WHERE dm_id = $1 AND graded_at >= NOW() - INTERVAL '30 days'
            UNION ALL SELECT 'prior_reference', AVG(prior_reference_score) FROM coaching_grades WHERE dm_id = $1 AND graded_at >= NOW() - INTERVAL '30 days'
          ) x ORDER BY s ASC LIMIT 1) as weakest,
          0 as weakest_score
        FROM coaching_grades WHERE dm_id = $1 AND graded_at >= NOW() - INTERVAL '30 days'
      `, [dm.id]).catch(() => null)
      data.coaching_grade = coachingAvg?.avg_score ?? null
      data.weakest_coaching_area = coachingAvg?.weakest ?? null

      // Stores not visited in 7+ days
      const staleStores = await query<{ address: string; days: number }>(`
        SELECT sl.address, EXTRACT(DAY FROM NOW() - MAX(v.submitted_at))::int as days
        FROM dm_manager_stores dms
        JOIN dm_store_locations sl ON sl.id = dms.store_location_id AND sl.active = TRUE
        LEFT JOIN dm_store_visits v ON v.store_location_id = sl.id AND v.submitted_by_id = $1
        WHERE dms.manager_id = $1
        GROUP BY sl.address
        HAVING MAX(v.submitted_at) IS NULL OR MAX(v.submitted_at) < NOW() - INTERVAL '7 days'
        ORDER BY days DESC NULLS FIRST LIMIT 5
      `, [dm.id]).catch(() => [])
      data.stale_stores = staleStores.length > 0 ? staleStores.map(s => `${s.address.split(',')[0]} (${s.days ? s.days + ' days' : 'never visited'})`).join('; ') : null

      // Pending approvals
      const pendingTimeOff = await queryOne<{ cnt: number }>(`
        SELECT COUNT(*)::int as cnt FROM time_off_requests
        WHERE approver_id = $1 AND status = 'pending'
      `, [dm.id]).catch(() => null)
      const pendingSupply = await queryOne<{ cnt: number }>(`
        SELECT COUNT(*)::int as cnt FROM supply_requests sr
        JOIN users u ON u.id = sr.submitted_by AND u.manager_id = $1
        WHERE sr.status = 'pending'
      `, [dm.id]).catch(() => null)
      data.pending_time_off = pendingTimeOff?.cnt ?? 0
      data.pending_supply = pendingSupply?.cnt ?? 0

      // Overdue tasks
      const overdue = await queryOne<{ cnt: number }>(`
        SELECT COUNT(*)::int as cnt FROM tasks t
        WHERE t.assignee_id = $1 AND t.due_date < NOW()
          AND NOT EXISTS (SELECT 1 FROM task_completions tc WHERE tc.task_id = t.id)
      `, [dm.id]).catch(() => null)
      data.overdue_tasks = overdue?.cnt ?? 0

      // Yesterday's flags for their team
      const yesterdayFlags = await query<{ type: string; detail: string }>(`
        SELECT type, detail FROM flags
        WHERE store_location_id IN (SELECT store_location_id FROM dm_manager_stores WHERE manager_id = $1)
          AND date = ($2::date - 1)
        ORDER BY created_at DESC LIMIT 5
      `, [dm.id, todayCST]).catch(() => [])
      data.yesterday_flags = yesterdayFlags.length > 0 ? yesterdayFlags.map(f => f.detail.slice(0, 80)).join('; ') : null

      // Days since last coaching
      const lastCoaching = await queryOne<{ days: number }>(`
        SELECT EXTRACT(DAY FROM NOW() - MAX(graded_at))::int as days FROM coaching_grades WHERE dm_id = $1
      `, [dm.id]).catch(() => null)
      data.days_since_coaching = lastCoaching?.days ?? null

      // Generate personalized message via AI
      const prompt = `You are a motivational field sales coach for a wireless retail DM named ${data.dm_name}. Today is ${dayName}. Generate a short, energizing daily game plan message (3-4 paragraphs max).

DATA:
- Team scheduled today: ${data.scheduled_today}
- Stores not visited in 7+ days: ${data.stale_stores || 'All stores visited recently — great job!'}
- Coaching grade (30-day avg): ${data.coaching_grade ? `${data.coaching_grade}/100` : 'No grades yet'}
- Weakest coaching category: ${data.weakest_coaching_area || 'N/A'}
- Days since last coaching: ${data.days_since_coaching ?? 'Never'}
- Pending time-off approvals: ${data.pending_time_off}
- Pending supply requests: ${data.pending_supply}
- Overdue tasks: ${data.overdue_tasks}
- Yesterday's flags: ${data.yesterday_flags || 'None'}

RULES:
- Start with something encouraging and specific to their data — not generic motivation
- Suggest 2-3 concrete things to do today based on the data above
- If they have stale stores, suggest visiting one with a specific coaching focus
- If their coaching grade has a weak area, suggest focusing on that in today's visit
- If they have pending approvals or overdue tasks, mention clearing those first
- End with energy and confidence
- Keep it under 200 words
- Do NOT use corporate buzzwords. Be real, direct, and human.
- Never use the word "let's" — they're doing this, not you.`

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      })

      const aiMessage = response.content[0].type === 'text' ? response.content[0].text : ''

      // Build push message (short version)
      const pushBody = aiMessage.split('\n').find(l => l.trim().length > 10)?.trim().slice(0, 120) || 'Your daily game plan is ready — check your email!'

      // Send push notification
      sendPushToUser(dm.id, `Good Morning, ${data.dm_name}!`, pushBody, 'task_assigned').catch(() => {})

      // Build email
      const actionItems: string[] = []
      if ((data.pending_time_off as number) > 0) actionItems.push(`${data.pending_time_off} time-off request${(data.pending_time_off as number) > 1 ? 's' : ''} pending`)
      if ((data.pending_supply as number) > 0) actionItems.push(`${data.pending_supply} supply request${(data.pending_supply as number) > 1 ? 's' : ''} pending`)
      if ((data.overdue_tasks as number) > 0) actionItems.push(`${data.overdue_tasks} overdue task${(data.overdue_tasks as number) > 1 ? 's' : ''}`)

      const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#7c3aed;padding:24px;border-radius:12px 12px 0 0;">
          <h1 style="color:white;margin:0;font-size:20px;">Good Morning, ${data.dm_name}!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${dayName}'s Game Plan</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;background:white;padding:24px;">
          ${aiMessage.split('\n').filter(l => l.trim()).map(l => `<p style="font-size:14px;color:#374151;margin:0 0 12px;line-height:1.6;">${l}</p>`).join('')}
          ${actionItems.length > 0 ? `
            <div style="background:#fef3c7;border-left:4px solid #d97706;padding:12px 16px;border-radius:0 8px 8px 0;margin-top:16px;">
              <p style="font-size:12px;font-weight:700;color:#92400e;margin:0 0 4px;">ACTION ITEMS</p>
              ${actionItems.map(a => `<p style="font-size:13px;color:#78350f;margin:2px 0;">• ${a}</p>`).join('')}
            </div>` : ''}
          ${data.stale_stores ? `
            <div style="background:#f5f3ff;border-left:4px solid #7c3aed;padding:12px 16px;border-radius:0 8px 8px 0;margin-top:12px;">
              <p style="font-size:12px;font-weight:700;color:#7c3aed;margin:0 0 4px;">STORES TO VISIT</p>
              ${(staleStores as Array<{address:string;days:number}>).slice(0,3).map(s => `<p style="font-size:13px;color:#4c1d95;margin:2px 0;">• ${s.address.split(',')[0]} — ${s.days ? s.days + ' days since last visit' : 'never visited'}</p>`).join('')}
            </div>` : ''}
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;background:#f9fafb;padding:16px 24px;text-align:center;">
          <p style="font-size:12px;color:#9ca3af;margin:0;">Need help? Open the AI Assistant in the app — ask about store visits, coaching tips, or anything else.</p>
        </div>
      </div>`

      await sendEmail(dm.email, `${dayName}'s Game Plan — ${data.dm_name}`, html).catch(() => {})
      sent++
    } catch (err) {
      console.error(`Daily coach error for ${dm.full_name}:`, err)
    }
  }

  return NextResponse.json({ ok: true, sent, total_dms: dms.length })
}
