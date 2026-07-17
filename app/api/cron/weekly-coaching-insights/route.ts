import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

export const maxDuration = 60 // Fable 5 needs time for deep analysis

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Runs Sunday 5 PM CST — AI-powered weekly coaching insights for each DM
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get the week range (Mon-Sun)
    const now = new Date()
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)

    const weekStart = monday.toISOString().split('T')[0]
    const weekEnd = sunday.toISOString().split('T')[0]
    const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

    // Get all active DMs
    const dms = await query<{ id: string; full_name: string; org_id: string }>(`
      SELECT id, full_name, org_id FROM users
      WHERE role = 'manager' AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)
        AND id != '79414e4b-389a-43b6-9da9-7943f181e7ab'
      ORDER BY full_name
    `)

    if (dms.length === 0) return NextResponse.json({ ok: true, message: 'No active DMs' })

    const dmInsights: Array<{ name: string; data: string; insight: string }> = []

    for (const dm of dms) {
      // ── Gather week data for this DM ──────────────────────────────────

      // Shifts & hours
      const shifts = await query<{ total_hours: number; shift_count: number }>(`
        SELECT COALESCE(SUM(
          EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)) -
          COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
        ) / 3600, 0)::float as total_hours,
        COUNT(*)::int as shift_count
        FROM shifts s
        WHERE s.user_id = $1 AND s.clock_in_at >= $2 AND s.clock_in_at <= $3 AND s.clock_out_at IS NOT NULL
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      // Store visits
      const visits = await query<{ store_address: string; visit_type: string; quick_takeaways: string | null; quick_impact: string | null; intentionality: string | null }>(`
        SELECT store_address, COALESCE(visit_type, 'normal') as visit_type, quick_takeaways, quick_impact, intentionality
        FROM dm_store_visits
        WHERE submitted_by_id = $1 AND submitted_at >= $2 AND submitted_at <= $3
        ORDER BY submitted_at
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      // Coaching sessions — full detail
      const coaching = await query<{
        employee_name: string; store_address: string
        obs_greeted_customer: boolean; obs_offered_mim: boolean; obs_offered_hsi: boolean
        obs_pitched_accessories: boolean; obs_open_ended_questions: boolean; obs_educated_survey: boolean
        obs_primary_issue: string | null
        rp_demonstrated_mim: boolean; rp_demonstrated_hsi: boolean; rp_score: string | null; rp_notes: string | null
        kc_mim_knowledge: string | null; kc_hsi_knowledge: string | null; kc_objection_handling: string | null
        kc_gap_notes: string | null; commitments_gained: string | null; fu_follow_up_date: string | null
      }>(`
        SELECT employee_name, store_address,
               obs_greeted_customer, obs_offered_mim, obs_offered_hsi,
               obs_pitched_accessories, obs_open_ended_questions, obs_educated_survey,
               obs_primary_issue,
               rp_demonstrated_mim, rp_demonstrated_hsi, rp_score, rp_notes,
               kc_mim_knowledge, kc_hsi_knowledge, kc_objection_handling,
               kc_gap_notes, commitments_gained, fu_follow_up_date
        FROM dm_coaching_checklists
        WHERE submitted_by_id = $1 AND submitted_at >= $2 AND submitted_at <= $3
        ORDER BY submitted_at
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      // Tasks assigned/completed
      const tasks = await query<{ assigned: number; completed: number }>(`
        SELECT
          (SELECT COUNT(*)::int FROM tasks WHERE created_by = $1 AND created_at >= $2 AND created_at <= $3) as assigned,
          (SELECT COUNT(*)::int FROM task_completions tc JOIN tasks t ON t.id = tc.task_id WHERE t.created_by = $1 AND tc.completed_at >= $2 AND tc.completed_at <= $3) as completed
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      // Accountability docs
      const accDocs = await query<{ level: string; subject_name: string; title: string }>(`
        SELECT level, subject_name, title FROM accountability_docs
        WHERE author_id = $1 AND created_at >= $2 AND created_at <= $3
        ORDER BY created_at
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      // Team checklists
      const checklists = await query<{ checklist_type: string; cnt: number }>(`
        SELECT checklist_type, COUNT(*)::int as cnt
        FROM checklist_submissions
        WHERE dm_id = $1 AND submitted_at >= $2 AND submitted_at <= $3
        GROUP BY checklist_type
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      // Employee count
      const empCount = await query<{ cnt: number }>(`
        SELECT COUNT(*)::int as cnt FROM users WHERE manager_id = $1 AND is_active = TRUE
      `, [dm.id])

      // DM Schedule for this week
      const schedule = await query<{ schedule: string }>(`
        SELECT schedule::text FROM dm_weekly_schedules WHERE dm_id = $1 AND week_start = $2
      `, [dm.id, weekStart])

      // Build data context
      const openingChecklists = checklists.find(c => c.checklist_type === 'opening')?.cnt ?? 0
      const closingChecklists = checklists.find(c => c.checklist_type === 'closing')?.cnt ?? 0
      const quickVisits = visits.filter(v => v.visit_type === 'quick').length
      const coachingVisits = visits.filter(v => v.visit_type === 'quick_coaching').length

      const dataContext = `
DM: ${dm.full_name}
Team Size: ${empCount[0].cnt} active employees
Hours Worked This Week: ${shifts[0].total_hours.toFixed(1)} hours across ${shifts[0].shift_count} shifts

STORE VISITS (${visits.length} total — ${quickVisits} Quick, ${coachingVisits} w/ Coaching):
${visits.length === 0 ? 'No store visits submitted this week.' : visits.map(v => {
  const type = v.visit_type === 'quick_coaching' ? 'Quick w/ Coaching' : 'Quick Visit'
  return `- ${v.store_address} (${type})${v.intentionality ? ` | Intent: ${v.intentionality}` : ''}${v.quick_takeaways ? ` | Takeaways: ${v.quick_takeaways}` : ''}${v.quick_impact ? ` | Impact: ${v.quick_impact}` : ''}`
}).join('\n')}

COACHING SESSIONS (${coaching.length} total):
${coaching.length === 0 ? 'No coaching sessions this week.' : coaching.map((c, i) => {
  const yn = (v: boolean) => v ? 'Yes' : 'No'
  const observeResults = [
    `Greeted within 5s: ${yn(c.obs_greeted_customer)}`,
    `Offered MIM: ${yn(c.obs_offered_mim)}`,
    `Offered HSI: ${yn(c.obs_offered_hsi)}`,
    `Pitched Accessories: ${yn(c.obs_pitched_accessories)}`,
    `Open-ended Questions: ${yn(c.obs_open_ended_questions)}`,
    `Educated on Survey: ${yn(c.obs_educated_survey)}`,
  ]
  const failedObserve = observeResults.filter(r => r.includes(': No'))
  const passedObserve = observeResults.filter(r => r.includes(': Yes'))
  return `
Session ${i + 1}: ${c.employee_name} at ${c.store_address}
  OBSERVE: ${passedObserve.length}/6 passed. ${failedObserve.length > 0 ? `Failed: ${failedObserve.map(f => f.split(':')[0]).join(', ')}` : 'All passed'}
  Primary Issue: ${c.obs_primary_issue || 'None'}
  ROLE PLAY: MIM Script: ${yn(c.rp_demonstrated_mim)}, HSI Presentation: ${yn(c.rp_demonstrated_hsi)}, Score: ${c.rp_score || 'Not scored'}${c.rp_notes ? `, Notes: ${c.rp_notes}` : ''}
  KNOWLEDGE CHECK: MIM: ${c.kc_mim_knowledge || 'N/A'}, HSI: ${c.kc_hsi_knowledge || 'N/A'}, Objection Handling: ${c.kc_objection_handling || 'N/A'}${c.kc_gap_notes ? `, Gaps: ${c.kc_gap_notes}` : ''}
  COMMITMENTS: ${c.commitments_gained || 'None recorded'}
  FOLLOW-UP: ${c.fu_follow_up_date || 'No date set'}`
}).join('\n')}

TASKS: ${tasks[0].assigned} assigned, ${tasks[0].completed} completed this week

ACCOUNTABILITY: ${accDocs.length === 0 ? 'None' : accDocs.map(d => `${d.level.toUpperCase()} for ${d.subject_name}: ${d.title}`).join('; ')}

TEAM CHECKLISTS: ${openingChecklists} opening, ${closingChecklists} closing submitted by employees

PLANNED SCHEDULE: ${schedule.length > 0 ? 'Submitted' : 'Not submitted'}
`.trim()

      dmInsights.push({ name: dm.full_name, data: dataContext, insight: '' })
    }

    // ── Send all DM data to Fable 5 in one call ──────────────────────────
    const allDmData = dmInsights.map((d, i) => `--- DM ${i + 1}: ${d.name} ---\n${d.data}`).join('\n\n')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a senior wireless retail leadership consultant writing a weekly executive briefing for the Sales Director and ownership team at a Metro by T-Mobile dealer group. Analyze each District Manager's weekly performance data and provide high-level coaching insights.

Write in a professional, senior leadership tone — concise, direct, data-driven. Use bullet points throughout.

For EACH DM, write their full name in all caps on its own line, then provide these sections:

WEEK AT A GLANCE
- Use bullet points to summarize: hours worked, store visits completed, coaching sessions, tasks assigned/completed, team checklist submissions

VISIT QUALITY ASSESSMENT
- Use bullet points to evaluate the quality of their store visit guides
- Was their intentionality (plan of attack) clear and strategic, or generic?
- Were takeaways specific with actionable next steps, or surface-level?
- Did their impact statements demonstrate measurable change?
- Visits without coaching attached = missed coaching opportunity — flag it

COACHING ANALYSIS
- Use bullet points to break down coaching session patterns
- Which observe areas are reps consistently failing? (MIM, HSI, accessories, open-ended questions, survey education)
- Role play score trends — are reps improving or stagnant?
- Knowledge check results — any repeated failures indicating training gaps?
- Are commitments specific and measurable or vague?
- Are follow-up dates being set and tracked?
- If no coaching was conducted, flag this as a priority gap

KEY STRENGTHS
- 1-2 bullet points on what this DM did well this week, backed by specific data

ACTION ITEMS
- 1-2 bullet points with specific, actionable recommendations for next week

Rules:
- Reference actual store names, employee names, and exact numbers from the data
- If a DM visited stores but didn't coach, call out the ratio (e.g., "4 visits, 0 coaching sessions")
- If observe data shows a pattern (e.g., 3 of 4 reps missed HSI), state it clearly
- If no visits or coaching were submitted, be direct — this is a leadership gap
- If no schedule was submitted, note the lack of weekly planning
- Keep each DM section to 150-200 words — bullet points keep it tight
- Use plain text with bullet points (use • for bullets)
- Do not use markdown formatting

DATA:
${allDmData}`
      }]
    })

    const aiText = response.content[0].type === 'text' ? response.content[0].text : ''

    const dmSectionsHtml = formatInsightsHtml(aiText)

    const html = `
<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:700px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#7c3aed,#4c1d95);padding:28px 24px;border-radius:12px 12px 0 0">
    <h1 style="color:white;margin:0;font-size:22px;font-weight:700">Weekly Coaching Insights</h1>
    <p style="color:#ddd6fe;margin:6px 0 0;font-size:14px">${weekLabel}</p>
    <p style="color:#c4b5fd;margin:4px 0 0;font-size:12px">AI-Powered Analysis by Claude Fable 5</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;background:white;padding:24px">
    ${dmSectionsHtml || '<p style="color:#6b7280">No insights generated — insufficient data this week.</p>'}
    <div style="background:#f9fafb;border-radius:8px;padding:12px 16px;margin-top:16px">
      <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center">
        Generated by Field Manager Pro &middot; <a href="https://fieldmanagerpro.app" style="color:#7c3aed">fieldmanagerpro.app</a>
      </p>
    </div>
  </div>
</div>`

    // Send to SD, owner, developer — respecting notification preferences
    const recipients = await query<{ email: string }>(`
      SELECT DISTINCT u.email FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.is_active = TRUE AND u.role IN ('sales_director', 'owner', 'developer')
        AND u.org_id = $1
        AND COALESCE(np.weekly_coaching, TRUE) = TRUE
        AND COALESCE(np.email_enabled, TRUE) = TRUE
    `, [dms[0].org_id])

    if (recipients.length > 0) {
      await sendEmail(
        recipients.map(r => r.email),
        `Weekly Coaching Insights — ${weekLabel}`,
        html
      )
    }

    return NextResponse.json({ ok: true, dms: dmInsights.length, recipients: recipients.length })
  } catch (err) {
    console.error('Weekly coaching insights error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

function formatInsightsHtml(text: string): string {
  return text.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed) return '<br/>'
    // DM name headers (all caps, short line)
    if (/^[A-Z][A-Z\s.]+$/.test(trimmed) && trimmed.length < 40) {
      return `<h2 style="font-size:18px;font-weight:700;color:#7c3aed;margin:28px 0 10px;padding-top:20px;border-top:2px solid #e5e7eb">${trimmed}</h2>`
    }
    // Section labels
    if (/^(WEEK AT A GLANCE|VISIT QUALITY|COACHING ANALYSIS|KEY STRENGTHS|ACTION ITEMS|PERFORMANCE|GROWTH|NEXT WEEK|VISIT GUIDE)/i.test(trimmed)) {
      return `<p style="margin:14px 0 6px;font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #f3f4f6;padding-bottom:4px">${trimmed}</p>`
    }
    // Bullet points
    if (/^[•\-–]/.test(trimmed)) {
      const content = trimmed.replace(/^[•\-–]\s*/, '')
      return `<p style="margin:0 0 5px;font-size:14px;line-height:1.6;color:#374151;padding-left:16px">
        <span style="color:#7c3aed;font-weight:700;margin-right:6px">•</span>${content}</p>`
    }
    return `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#374151">${trimmed}</p>`
  }).join('')
}
