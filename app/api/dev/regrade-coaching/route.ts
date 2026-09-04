import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { gradeCoaching } from '@/lib/coaching-grader'

// One-time endpoint to re-grade broken coaching entries
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const { searchParams } = new URL(req.url)
  const qSecret = searchParams.get('secret')
  const cronSecret = process.env.CRON_SECRET
  if (auth !== `Bearer ${cronSecret}` && qSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find broken grades
  const broken = await query<{
    id: string; visit_id: string; dm_id: string; dm_name: string; org_id: string | null
    store_address: string; employee_coached: string | null
  }>(`
    SELECT id, visit_id, dm_id, dm_name, org_id, store_address, employee_coached
    FROM coaching_grades
    WHERE summary = 'Grading temporarily unavailable.'
    ORDER BY graded_at DESC
  `)

  if (!broken.length) {
    return NextResponse.json({ ok: true, message: 'No broken grades found' })
  }

  const results: { id: string; dm_name: string; employee: string; newGrade: string; error?: string }[] = []

  for (const bg of broken) {
    try {
      // Get original visit data
      const visit = await queryOne<{
        quick_takeaways: string | null; quick_impact: string | null
      }>(`SELECT quick_takeaways, quick_impact FROM dm_store_visits WHERE id = $1`, [bg.visit_id])

      // Get coaching checklist data
      const checklist = await queryOne<{
        obs_greeted_customer: boolean; obs_offered_mim: boolean; obs_offered_hsi: boolean
        obs_pitched_accessories: boolean; obs_open_ended_questions: boolean; obs_educated_survey: boolean
        obs_primary_issue: string | null
        rp_score: string | null; rp_notes: string | null
        kc_mim_knowledge: string | null; kc_hsi_knowledge: string | null
        kc_objection_handling: string | null; kc_gap_notes: string | null
        commitments_gained: string | null; fu_follow_up_date: string | null
      }>(`
        SELECT obs_greeted_customer, obs_offered_mim, obs_offered_hsi, obs_pitched_accessories,
               obs_open_ended_questions, obs_educated_survey, obs_primary_issue,
               rp_score, rp_notes, kc_mim_knowledge, kc_hsi_knowledge,
               kc_objection_handling, kc_gap_notes, commitments_gained, fu_follow_up_date
        FROM dm_coaching_checklists
        WHERE submitted_by_id = $1 AND employee_name = $2
        ORDER BY submitted_at DESC LIMIT 1
      `, [bg.dm_id, bg.employee_coached])

      // Get DM email
      const dmUser = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [bg.dm_id])

      // Delete the broken grade so re-grade can insert fresh
      await query(`DELETE FROM coaching_grades WHERE id = $1`, [bg.id])

      const grade = await gradeCoaching({
        visitId: bg.visit_id,
        dmId: bg.dm_id,
        dmName: bg.dm_name,
        dmEmail: dmUser?.email ?? '',
        orgId: bg.org_id,
        storeAddress: bg.store_address,
        employeeCoachedName: bg.employee_coached,
        coachingSituation: null,
        coaching1: visit?.quick_takeaways?.trim() || visit?.quick_impact?.trim() || '',
        coaching2: checklist?.commitments_gained?.trim() || '',
        coaching3: checklist?.fu_follow_up_date?.trim() || '',
        obsData: checklist ? {
          greeted_customer: !!checklist.obs_greeted_customer,
          offered_mim: !!checklist.obs_offered_mim,
          offered_hsi: !!checklist.obs_offered_hsi,
          pitched_accessories: !!checklist.obs_pitched_accessories,
          open_ended_questions: !!checklist.obs_open_ended_questions,
          educated_survey: !!checklist.obs_educated_survey,
          primary_issue: checklist.obs_primary_issue || null,
        } : undefined,
        rpData: checklist ? { score: checklist.rp_score || null, notes: checklist.rp_notes || null } : undefined,
        kcData: checklist ? {
          mim_knowledge: checklist.kc_mim_knowledge || null,
          hsi_knowledge: checklist.kc_hsi_knowledge || null,
          objection_handling: checklist.kc_objection_handling || null,
          gap_notes: checklist.kc_gap_notes || null,
        } : undefined,
        commitments: checklist?.commitments_gained?.trim() || null,
        followUpDate: checklist?.fu_follow_up_date?.trim() || null,
      })

      // Update the visit record with the new grade
      await query(`UPDATE dm_store_visits SET coaching_grade = $1 WHERE id = $2`, [grade.overall_grade, bg.visit_id])

      results.push({ id: bg.id, dm_name: bg.dm_name, employee: bg.employee_coached || '', newGrade: grade.overall_grade })
    } catch (err) {
      results.push({ id: bg.id, dm_name: bg.dm_name, employee: bg.employee_coached || '', newGrade: 'ERROR', error: String(err) })
    }
  }

  return NextResponse.json({ ok: true, regraded: results })
}
