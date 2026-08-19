import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { scoreToGrade } from '@/lib/coaching-grader'

// Runs Sunday 7 PM CST — sends each DM a weekly coaching recap email

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dms = await query<{ id: string; full_name: string; email: string }>(`
    SELECT id, full_name, email FROM users
    WHERE role = 'manager' AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)
  `)

  let sent = 0

  for (const dm of dms) {
    // This week's grades
    const weekGrades = await query<{
      overall_grade: string; overall_score: number; store_address: string
      employee_coached: string | null; graded_at: string
      specificity_score: number; actionability_score: number; follow_up_score: number
      depth_score: number; prior_reference_score: number
    }>(`
      SELECT overall_grade, overall_score, store_address, employee_coached, graded_at::text,
             specificity_score, actionability_score, follow_up_score, depth_score, prior_reference_score
      FROM coaching_grades
      WHERE dm_id = $1 AND graded_at >= NOW() - INTERVAL '7 days'
      ORDER BY graded_at DESC
    `, [dm.id])

    if (weekGrades.length === 0) continue // No coaching this week — skip

    // Calculate weekly averages
    const avgScore = Math.round(weekGrades.reduce((s, g) => s + g.overall_score, 0) / weekGrades.length)
    const avgGrade = scoreToGrade(avgScore)

    // Find weakest category
    const catAvgs = {
      Specificity: Math.round(weekGrades.reduce((s, g) => s + g.specificity_score, 0) / weekGrades.length),
      Actionability: Math.round(weekGrades.reduce((s, g) => s + g.actionability_score, 0) / weekGrades.length),
      'Follow-Up': Math.round(weekGrades.reduce((s, g) => s + g.follow_up_score, 0) / weekGrades.length),
      Depth: Math.round(weekGrades.reduce((s, g) => s + g.depth_score, 0) / weekGrades.length),
      'Prior Reference': Math.round(weekGrades.reduce((s, g) => s + g.prior_reference_score, 0) / weekGrades.length),
    }
    const sorted = Object.entries(catAvgs).sort((a, b) => a[1] - b[1])
    const weakest = sorted[0]
    const strongest = sorted[sorted.length - 1]

    // Previous week for comparison
    const prevAvg = await query<{ avg_score: number }>(`
      SELECT ROUND(AVG(overall_score))::int as avg_score FROM coaching_grades
      WHERE dm_id = $1 AND graded_at >= NOW() - INTERVAL '14 days' AND graded_at < NOW() - INTERVAL '7 days'
    `, [dm.id]).catch(() => [])
    const prevScore = prevAvg[0]?.avg_score ?? null
    const trend = prevScore ? (avgScore > prevScore ? 'improving' : avgScore < prevScore ? 'declining' : 'consistent') : 'new'
    const trendEmoji = trend === 'improving' ? '↑' : trend === 'declining' ? '↓' : '→'

    const gradeColor = (g: string) => {
      if (g.startsWith('A')) return '#16a34a'
      if (g.startsWith('B')) return '#2563eb'
      if (g.startsWith('C')) return '#d97706'
      if (g.startsWith('D')) return '#ea580c'
      return '#dc2626'
    }

    const catBar = (label: string, score: number) => {
      const grade = scoreToGrade(score)
      const width = Math.max(score, 5)
      return `<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
          <span style="font-size:12px;color:#374151;">${label}</span>
          <span style="font-size:12px;font-weight:700;color:${gradeColor(grade)};">${grade} (${score})</span>
        </div>
        <div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;">
          <div style="background:${gradeColor(grade)};height:100%;width:${width}%;border-radius:4px;"></div>
        </div>
      </div>`
    }

    const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:${gradeColor(avgGrade)};padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <p style="color:rgba(255,255,255,0.8);margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Weekly Coaching Recap</p>
        <h1 style="color:white;margin:0;font-size:48px;font-weight:800;">${avgGrade}</h1>
        <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">${weekGrades.length} coaching${weekGrades.length !== 1 ? 's' : ''} this week ${trendEmoji}${prevScore ? ` (last week: ${scoreToGrade(prevScore)})` : ''}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;background:white;padding:24px;">
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hey ${dm.full_name.split(' ')[0]}! Here's your coaching performance for the week.</p>

        <p style="font-size:13px;font-weight:700;color:#7c3aed;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;">Category Breakdown</p>
        ${catBar('Specificity (25%)', catAvgs.Specificity)}
        ${catBar('Actionability (25%)', catAvgs.Actionability)}
        ${catBar('Follow-Up (20%)', catAvgs['Follow-Up'])}
        ${catBar('Depth (20%)', catAvgs.Depth)}
        ${catBar('Prior Reference (10%)', catAvgs['Prior Reference'])}

        <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="font-size:13px;font-weight:700;color:#16a34a;margin:0 0 4px;">Strongest: ${strongest[0]} (${scoreToGrade(strongest[1])})</p>
          <p style="font-size:13px;font-weight:700;color:#dc2626;margin:0 0 8px;">Focus area: ${weakest[0]} (${scoreToGrade(weakest[1])})</p>
          <p style="font-size:12px;color:#6b7280;margin:0;">Going into Monday, focus on improving your <strong>${weakest[0].toLowerCase()}</strong> in every coaching session. ${
            weakest[0] === 'Specificity' ? 'Document exact quotes and behaviors you observe.' :
            weakest[0] === 'Actionability' ? 'Make every action item measurable with a number or deadline.' :
            weakest[0] === 'Follow-Up' ? 'Set a specific date, time, and success metric for every follow-up.' :
            weakest[0] === 'Depth' ? 'Dig into root causes — ask WHY the rep does what they do.' :
            'Reference your last coaching session and track progress over time.'
          }</p>
        </div>

        <p style="font-size:13px;font-weight:700;color:#7c3aed;margin:16px 0 8px;text-transform:uppercase;letter-spacing:0.5px;">This Week's Sessions</p>
        ${weekGrades.map(g => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:13px;color:#111827;">${g.store_address?.split(',')[0] || 'Store'}</span>
            ${g.employee_coached ? `<span style="font-size:11px;color:#9ca3af;"> · ${g.employee_coached}</span>` : ''}
          </div>
          <span style="font-size:16px;font-weight:700;color:${gradeColor(g.overall_grade)};">${g.overall_grade}</span>
        </div>`).join('')}
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">Weekly Coaching Recap via Field Manager Pro</p>
    </div>`

    await sendEmail(dm.email, `Coaching Recap: ${avgGrade} — ${weekGrades.length} session${weekGrades.length !== 1 ? 's' : ''} this week`, html).catch(() => {})
    sent++
  }

  return NextResponse.json({ ok: true, sent, total_dms: dms.length })
}
