import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Week range
    const now = new Date()
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const weekStart = monday.toISOString().split('T')[0]
    const weekEnd = sunday.toISOString().split('T')[0]
    const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

    const dms = await query<{ id: string; full_name: string; org_id: string }>(`
      SELECT id, full_name, org_id FROM users
      WHERE role = 'manager' AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)
        AND id != '79414e4b-389a-43b6-9da9-7943f181e7ab'
      ORDER BY full_name
    `)

    // Gather data for all DMs
    const dmData: string[] = []
    for (const dm of dms) {
      const shifts = await query<{ total_hours: number; shift_count: number }>(`
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)) - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)) / 3600, 0)::float as total_hours, COUNT(*)::int as shift_count
        FROM shifts s WHERE s.user_id = $1 AND s.clock_in_at >= $2 AND s.clock_in_at <= $3 AND s.clock_out_at IS NOT NULL
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      const visits = await query<{ store_address: string; visit_type: string; quick_takeaways: string | null; quick_impact: string | null; intentionality: string | null }>(`
        SELECT store_address, COALESCE(visit_type,'normal') as visit_type, quick_takeaways, quick_impact, intentionality
        FROM dm_store_visits WHERE submitted_by_id = $1 AND submitted_at >= $2 AND submitted_at <= $3 ORDER BY submitted_at
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      const coaching = await query<{ employee_name: string; store_address: string; obs_greeted_customer: boolean; obs_offered_mim: boolean; obs_offered_hsi: boolean; obs_pitched_accessories: boolean; obs_open_ended_questions: boolean; obs_educated_survey: boolean; obs_primary_issue: string | null; rp_score: string | null; rp_notes: string | null; kc_mim_knowledge: string | null; kc_hsi_knowledge: string | null; kc_objection_handling: string | null; kc_gap_notes: string | null; commitments_gained: string | null; fu_follow_up_date: string | null }>(`
        SELECT employee_name, store_address, obs_greeted_customer, obs_offered_mim, obs_offered_hsi, obs_pitched_accessories, obs_open_ended_questions, obs_educated_survey, obs_primary_issue, rp_score, rp_notes, kc_mim_knowledge, kc_hsi_knowledge, kc_objection_handling, kc_gap_notes, commitments_gained, fu_follow_up_date
        FROM dm_coaching_checklists WHERE submitted_by_id = $1 AND submitted_at >= $2 AND submitted_at <= $3 ORDER BY submitted_at
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      const tasks = await query<{ assigned: number; completed: number }>(`
        SELECT (SELECT COUNT(*)::int FROM tasks WHERE created_by = $1 AND created_at >= $2 AND created_at <= $3) as assigned,
               (SELECT COUNT(*)::int FROM task_completions tc JOIN tasks t ON t.id = tc.task_id WHERE t.created_by = $1 AND tc.completed_at >= $2 AND tc.completed_at <= $3) as completed
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      const accDocs = await query<{ level: string; subject_name: string; title: string }>(`
        SELECT level, subject_name, title FROM accountability_docs WHERE author_id = $1 AND created_at >= $2 AND created_at <= $3
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      const checklists = await query<{ checklist_type: string; cnt: number }>(`
        SELECT checklist_type, COUNT(*)::int as cnt FROM checklist_submissions WHERE dm_id = $1 AND submitted_at >= $2 AND submitted_at <= $3 GROUP BY checklist_type
      `, [dm.id, weekStart, weekEnd + 'T23:59:59'])

      const empCount = await query<{ cnt: number }>(`SELECT COUNT(*)::int as cnt FROM users WHERE manager_id = $1 AND is_active = TRUE`, [dm.id])

      const yn = (v: boolean) => v ? 'Yes' : 'No'
      const openC = checklists.find(c => c.checklist_type === 'opening')?.cnt ?? 0
      const closeC = checklists.find(c => c.checklist_type === 'closing')?.cnt ?? 0

      const coachingText = coaching.length === 0 ? 'No coaching sessions this week.' : coaching.map((c, i) => {
        const failed = [
          !c.obs_greeted_customer && 'Greeting', !c.obs_offered_mim && 'MIM', !c.obs_offered_hsi && 'HSI',
          !c.obs_pitched_accessories && 'Accessories', !c.obs_open_ended_questions && 'Open-ended Qs', !c.obs_educated_survey && 'Survey'
        ].filter(Boolean)
        const passed = 6 - failed.length
        return `Session ${i+1}: ${c.employee_name} at ${c.store_address}
  OBSERVE: ${passed}/6 passed. ${failed.length > 0 ? `Failed: ${failed.join(', ')}` : 'All passed'}. Primary Issue: ${c.obs_primary_issue || 'None'}
  ROLE PLAY: Score: ${c.rp_score || 'Not scored'}${c.rp_notes ? ` | Notes: ${c.rp_notes}` : ''}
  KNOWLEDGE: MIM: ${c.kc_mim_knowledge || 'N/A'}, HSI: ${c.kc_hsi_knowledge || 'N/A'}, Objections: ${c.kc_objection_handling || 'N/A'}${c.kc_gap_notes ? ` | Gaps: ${c.kc_gap_notes}` : ''}
  COMMITMENTS: ${c.commitments_gained || 'None'} | Follow-up: ${c.fu_follow_up_date || 'Not set'}`
      }).join('\n')

      dmData.push(`--- ${dm.full_name} ---
Team: ${empCount[0].cnt} employees | Hours: ${shifts[0].total_hours.toFixed(1)}h across ${shifts[0].shift_count} shifts
Visits: ${visits.length} (${visits.filter(v=>v.visit_type==='quick').length} Quick, ${visits.filter(v=>v.visit_type==='quick_coaching').length} w/ Coaching)
${visits.map(v => `  ${v.store_address} (${v.visit_type})${v.intentionality ? ` | Intent: ${v.intentionality}` : ''}${v.quick_takeaways ? ` | Takeaways: ${v.quick_takeaways}` : ''}${v.quick_impact ? ` | Impact: ${v.quick_impact}` : ''}`).join('\n')}
Tasks: ${tasks[0].assigned} assigned, ${tasks[0].completed} completed
Accountability: ${accDocs.length === 0 ? 'None' : accDocs.map(d => `${d.level.toUpperCase()} for ${d.subject_name}`).join('; ')}
Checklists: ${openC} opening, ${closeC} closing
COACHING (${coaching.length}):
${coachingText}`)
    }

    // Call AI — try Fable 5, fall back to Sonnet if unavailable
    let modelUsed = 'claude-sonnet-4-6'
    let response
    try {
      response = await anthropic.messages.create({
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
- Was their intentionality clear and strategic, or generic?
- Were takeaways specific with actionable next steps, or surface-level?
- Did their impact statements demonstrate measurable change?
- Visits without coaching attached = missed coaching opportunity — flag it

COACHING ANALYSIS
- Use bullet points to break down coaching session patterns
- Which observe areas are reps consistently failing?
- Role play score trends — improving or stagnant?
- Knowledge check results — any repeated failures?
- Are commitments specific and measurable or vague?
- Are follow-up dates being set?
- If no coaching was conducted, flag this as a priority gap

KEY STRENGTHS
- 1-2 bullet points on what this DM did well, backed by specific data

ACTION ITEMS
- 1-2 bullet points with specific, actionable recommendations for next week

Rules: Reference actual store names, employee names, and exact numbers. If a DM visited stores but didn't coach, call out the ratio. If no visits or coaching, be direct — this is a leadership gap. 150-200 words per DM. Use plain text with bullet points (use the bullet character for bullets). Do not use markdown.

DATA:
${dmData.join('\n\n')}`
        }]
      })
    } catch (fableErr) {
      console.error('Fable 5 failed, falling back to Sonnet:', fableErr)
      modelUsed = 'claude-sonnet-4-6'
      response = await anthropic.messages.create({
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
- Was their intentionality clear and strategic, or generic?
- Were takeaways specific with actionable next steps, or surface-level?
- Did their impact statements demonstrate measurable change?
- Visits without coaching attached = missed coaching opportunity — flag it

COACHING ANALYSIS
- Use bullet points to break down coaching session patterns
- Which observe areas are reps consistently failing?
- Role play score trends — improving or stagnant?
- Knowledge check results — any repeated failures?
- Are commitments specific and measurable or vague?
- Are follow-up dates being set?
- If no coaching was conducted, flag this as a priority gap

KEY STRENGTHS
- 1-2 bullet points on what this DM did well, backed by specific data

ACTION ITEMS
- 1-2 bullet points with specific, actionable recommendations for next week

Rules: Reference actual store names, employee names, and exact numbers. If a DM visited stores but didn't coach, call out the ratio. If no visits or coaching, be direct — this is a leadership gap. 150-200 words per DM. Use plain text with bullet points (use the bullet character for bullets). Do not use markdown.

DATA:
${dmData.join('\n\n')}`
        }]
      })
    }

    const aiText = response.content[0].type === 'text' ? response.content[0].text : ''
    console.log('AI response length:', aiText.length, 'model:', modelUsed, 'stop_reason:', response.stop_reason)

    if (!aiText) {
      console.error('Empty AI response. Full response:', JSON.stringify(response))
    }

    // Build email
    const recapLines = formatInsightsHtml(aiText)

    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:700px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#7c3aed,#4c1d95);padding:28px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:22px;font-weight:700">Weekly Coaching Insights</h1>
        <p style="color:#ddd6fe;margin:6px 0 0;font-size:14px">${weekLabel}</p>
        <p style="color:#c4b5fd;margin:4px 0 0;font-size:12px">AI-Powered Analysis by ${modelUsed}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;background:white;padding:24px">
        ${recapLines}
        <div style="background:#f9fafb;border-radius:8px;padding:12px 16px;margin-top:16px">
          <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center">Generated by Field Manager Pro using ${modelUsed} &middot; <a href="https://fieldmanagerpro.app" style="color:#7c3aed">fieldmanagerpro.app</a></p>
        </div>
      </div>
    </div>`

    await sendEmail(session.email, `[EXAMPLE] Weekly Coaching Insights — ${weekLabel}`, html)

    return NextResponse.json({ ok: true, message: 'Coaching insights email sent', dms: dms.length, model: modelUsed, aiResponseLength: aiText.length })
  } catch (err) {
    console.error('Test coaching insights error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

function formatInsightsHtml(text: string): string {
  return text.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed) return '<br/>'
    if (/^[A-Z][A-Z\s.]+$/.test(trimmed) && trimmed.length < 40) {
      return `<h2 style="font-size:18px;font-weight:700;color:#7c3aed;margin:28px 0 10px;padding-top:20px;border-top:2px solid #e5e7eb">${trimmed}</h2>`
    }
    if (/^(WEEK AT A GLANCE|VISIT QUALITY|COACHING ANALYSIS|KEY STRENGTHS|ACTION ITEMS|PERFORMANCE|GROWTH|NEXT WEEK|VISIT GUIDE)/i.test(trimmed)) {
      return `<p style="margin:14px 0 6px;font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #f3f4f6;padding-bottom:4px">${trimmed}</p>`
    }
    if (/^[•\-–]/.test(trimmed)) {
      const content = trimmed.replace(/^[•\-–]\s*/, '')
      return `<p style="margin:0 0 5px;font-size:14px;line-height:1.6;color:#374151;padding-left:16px"><span style="color:#7c3aed;font-weight:700;margin-right:6px">•</span>${content}</p>`
    }
    return `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#374151">${trimmed}</p>`
  }).join('')
}
