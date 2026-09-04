import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { gradeCoaching } from '@/lib/coaching-grader'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const missing = await query<{
    id: string; dm_name: string; store_address: string; visit_type: string
    submitted_by_id: string; org_id: string | null
    quick_takeaways: string | null; quick_impact: string | null
  }>(`
    SELECT v.id, v.dm_name, v.store_address, v.visit_type, v.submitted_by_id, v.org_id,
           v.quick_takeaways, v.quick_impact
    FROM dm_store_visits v
    WHERE v.visit_type IN ('quick_coaching', 'remote_coaching')
      AND NOT EXISTS (SELECT 1 FROM coaching_grades cg WHERE cg.visit_id = v.id)
      AND v.submitted_at > NOW() - INTERVAL '14 days'
    ORDER BY v.submitted_at DESC
  `)

  if (!missing.length) return NextResponse.json({ ok: true, message: 'No missing grades' })

  const results: { dm: string; emp: string; grade: string }[] = []
  for (const v of missing) {
    try {
      const cl = await queryOne<Record<string, unknown>>(`
        SELECT * FROM dm_coaching_checklists
        WHERE submitted_by_id = $1 AND store_address = $2
        ORDER BY ABS(EXTRACT(EPOCH FROM submitted_at) - (
          SELECT EXTRACT(EPOCH FROM submitted_at) FROM dm_store_visits WHERE id = $3
        )) LIMIT 1
      `, [v.submitted_by_id, v.store_address, v.id])
      if (!cl) { results.push({ dm: v.dm_name, emp: '?', grade: 'SKIP' }); continue }

      const dmUser = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [v.submitted_by_id])
      const grade = await gradeCoaching({
        visitId: v.id, dmId: v.submitted_by_id, dmName: v.dm_name,
        dmEmail: dmUser?.email ?? '', orgId: v.org_id, storeAddress: v.store_address,
        employeeCoachedName: (cl.employee_name as string) || null,
        coaching1: v.quick_takeaways?.trim() || v.quick_impact?.trim() || '',
        coaching2: (cl.commitments_gained as string)?.trim() || '',
        coaching3: (cl.fu_follow_up_date as string)?.trim() || '',
        obsData: {
          greeted_customer: !!cl.obs_greeted_customer, offered_mim: !!cl.obs_offered_mim,
          offered_hsi: !!cl.obs_offered_hsi, pitched_accessories: !!cl.obs_pitched_accessories,
          open_ended_questions: !!cl.obs_open_ended_questions, educated_survey: !!cl.obs_educated_survey,
          primary_issue: (cl.obs_primary_issue as string) || null,
        },
        rpData: { score: (cl.rp_score as string) || null, notes: (cl.rp_notes as string) || null },
        kcData: {
          mim_knowledge: (cl.kc_mim_knowledge as string) || null,
          hsi_knowledge: (cl.kc_hsi_knowledge as string) || null,
          objection_handling: (cl.kc_objection_handling as string) || null,
          gap_notes: (cl.kc_gap_notes as string) || null,
        },
        commitments: (cl.commitments_gained as string)?.trim() || null,
        followUpDate: (cl.fu_follow_up_date as string)?.trim() || null,
      })
      await query(`UPDATE dm_store_visits SET coaching_grade = $1 WHERE id = $2`, [grade.overall_grade, v.id])
      results.push({ dm: v.dm_name, emp: (cl.employee_name as string) || '?', grade: grade.overall_grade })
    } catch (err) {
      results.push({ dm: v.dm_name, emp: '?', grade: `ERR: ${String(err).slice(0, 80)}` })
    }
  }
  return NextResponse.json({ ok: true, regraded: results })
}
