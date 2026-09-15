import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { gradeCoaching } from '@/lib/coaching-grader'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const broken = await query<{
    id: string; visit_id: string; dm_id: string; dm_name: string; org_id: string | null
    store_address: string; employee_coached: string | null
  }>(`
    SELECT id, visit_id, dm_id, dm_name, org_id, store_address, employee_coached
    FROM coaching_grades WHERE summary = 'Grading temporarily unavailable.' OR summary IS NULL OR summary = ''
    ORDER BY graded_at DESC
  `)

  if (!broken.length) return NextResponse.json({ ok: true, message: 'No broken grades' })

  const results: { dm: string; emp: string; grade: string }[] = []
  for (const bg of broken) {
    try {
      const cl = await queryOne<Record<string, unknown>>(`
        SELECT * FROM dm_coaching_checklists
        WHERE submitted_by_id = $1 AND employee_name = $2
        ORDER BY ABS(EXTRACT(EPOCH FROM submitted_at) - (
          SELECT EXTRACT(EPOCH FROM submitted_at) FROM dm_store_visits WHERE id = $3
        )) LIMIT 1
      `, [bg.dm_id, bg.employee_coached, bg.visit_id]).catch(() => null)

      const visit = await queryOne<{ quick_takeaways: string | null; quick_impact: string | null }>(`
        SELECT quick_takeaways, quick_impact FROM dm_store_visits WHERE id = $1
      `, [bg.visit_id]).catch(() => null)

      const dmUser = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [bg.dm_id])
      await query(`DELETE FROM coaching_grades WHERE id = $1`, [bg.id])

      const grade = await gradeCoaching({
        visitId: bg.visit_id, dmId: bg.dm_id, dmName: bg.dm_name,
        dmEmail: dmUser?.email ?? '', orgId: bg.org_id, storeAddress: bg.store_address,
        employeeCoachedName: bg.employee_coached,
        coaching1: visit?.quick_takeaways?.trim() || visit?.quick_impact?.trim() || '',
        coaching2: (cl?.commitments_gained as string)?.trim() || '',
        coaching3: (cl?.fu_follow_up_date as string)?.trim() || '',
        obsData: cl ? {
          greeted_customer: !!cl.obs_greeted_customer, offered_mim: !!cl.obs_offered_mim,
          offered_hsi: !!cl.obs_offered_hsi, pitched_accessories: !!cl.obs_pitched_accessories,
          open_ended_questions: !!cl.obs_open_ended_questions, educated_survey: !!cl.obs_educated_survey,
          primary_issue: (cl.obs_primary_issue as string) || null,
        } : undefined,
        rpData: cl ? { score: (cl.rp_score as string) || null, notes: (cl.rp_notes as string) || null } : undefined,
        kcData: cl ? {
          mim_knowledge: (cl.kc_mim_knowledge as string) || null, hsi_knowledge: (cl.kc_hsi_knowledge as string) || null,
          objection_handling: (cl.kc_objection_handling as string) || null, gap_notes: (cl.kc_gap_notes as string) || null,
        } : undefined,
        commitments: (cl?.commitments_gained as string)?.trim() || null,
        followUpDate: (cl?.fu_follow_up_date as string)?.trim() || null,
      })
      await query(`UPDATE dm_store_visits SET coaching_grade = $1 WHERE id = $2`, [grade.overall_grade, bg.visit_id])
      results.push({ dm: bg.dm_name, emp: bg.employee_coached || '?', grade: grade.overall_grade })
    } catch (err) {
      results.push({ dm: bg.dm_name, emp: bg.employee_coached || '?', grade: `ERR: ${String(err).slice(0, 60)}` })
    }
  }
  return NextResponse.json({ ok: true, regraded: results })
}
