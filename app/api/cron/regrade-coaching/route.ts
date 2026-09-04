import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { gradeCoaching } from '@/lib/coaching-grader'

export const maxDuration = 120

// One-time: re-grade visits that are missing coaching_grades records
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find visits that have coaching_grade but no coaching_grades record
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

  if (!missing.length) {
    return NextResponse.json({ ok: true, message: 'No missing grades' })
  }

  const results: { id: string; dm_name: string; employee: string; grade: string; error?: string }[] = []

  for (const v of missing) {
    try {
      const cl = await queryOne<{
        employee_name: string
        obs_greeted_customer: boolean; obs_offered_mim: boolean; obs_offered_hsi: boolean
        obs_pitched_accessories: boolean; obs_open_ended_questions: boolean; obs_educated_survey: boolean
        obs_primary_issue: string | null
        rp_score: string | null; rp_notes: string | null
        kc_mim_knowledge: string | null; kc_hsi_knowledge: string | null
        kc_objection_handling: string | null; kc_gap_notes: string | null
        commitments_gained: string | null; fu_follow_up_date: string | null
      }>(`
        SELECT * FROM dm_coaching_checklists
        WHERE submitted_by_id = $1 AND store_address = $2
        ORDER BY ABS(EXTRACT(EPOCH FROM submitted_at) - (
          SELECT EXTRACT(EPOCH FROM submitted_at) FROM dm_store_visits WHERE id = $3
        )) LIMIT 1
      `, [v.submitted_by_id, v.store_address, v.id])

      if (!cl) {
        results.push({ id: v.id, dm_name: v.dm_name, employee: '?', grade: 'SKIP', error: 'No checklist found' })
        continue
      }

      const dmUser = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [v.submitted_by_id])

      // For remote coaching, get remote data
      let remoteContext
      if (v.visit_type === 'remote_coaching') {
        const rd = await queryOne<{ remote_coaching_data: Record<string, string | null> }>(
          `SELECT remote_coaching_data FROM dm_store_visits WHERE id = $1`, [v.id]
        )
        if (rd?.remote_coaching_data) {
          const d = rd.remote_coaching_data
          remoteContext = {
            mlbGrade: d.mlb_current_grade || null,
            skillOrWill: d.cc_skill_or_will || null,
            saTheme: d.sa_theme || null,
            saCompletedProperly: d.sa_completed_properly || null,
            transactionCount: d.sa_transaction_count || null,
            transactionsDocumented: d.sa_transactions_documented || null,
            prevCommitment: d.prev_commitment || null,
            prevCompleted: d.prev_completed || null,
            prevResult: d.prev_result || null,
            strength: d.cc_strength || null,
            learned: d.cc_learned || null,
            behaviorChange: d.cc_behavior_change || null,
            impact: d.cc_impact || null,
            mlbStrength: d.mlb_strength || null,
            mlbOpportunity: d.mlb_opportunity || null,
            priorities: [d.mlb_priority_1, d.mlb_priority_2, d.mlb_priority_3].filter(Boolean).join(', ') || null,
            mainFocus: d.mlb_main_focus || null,
          }
        }
      }

      const grade = await gradeCoaching({
        visitId: v.id,
        dmId: v.submitted_by_id,
        dmName: v.dm_name,
        dmEmail: dmUser?.email ?? '',
        orgId: v.org_id,
        storeAddress: v.store_address,
        employeeCoachedName: cl.employee_name,
        coaching1: v.quick_takeaways?.trim() || v.quick_impact?.trim() || '',
        coaching2: cl.commitments_gained?.trim() || '',
        coaching3: cl.fu_follow_up_date?.trim() || '',
        obsData: {
          greeted_customer: !!cl.obs_greeted_customer,
          offered_mim: !!cl.obs_offered_mim,
          offered_hsi: !!cl.obs_offered_hsi,
          pitched_accessories: !!cl.obs_pitched_accessories,
          open_ended_questions: !!cl.obs_open_ended_questions,
          educated_survey: !!cl.obs_educated_survey,
          primary_issue: cl.obs_primary_issue || null,
        },
        rpData: { score: cl.rp_score || null, notes: cl.rp_notes || null },
        kcData: {
          mim_knowledge: cl.kc_mim_knowledge || null,
          hsi_knowledge: cl.kc_hsi_knowledge || null,
          objection_handling: cl.kc_objection_handling || null,
          gap_notes: cl.kc_gap_notes || null,
        },
        commitments: cl.commitments_gained?.trim() || null,
        followUpDate: cl.fu_follow_up_date?.trim() || null,
        remoteContext,
      })

      await query(`UPDATE dm_store_visits SET coaching_grade = $1 WHERE id = $2`, [grade.overall_grade, v.id])
      results.push({ id: v.id, dm_name: v.dm_name, employee: cl.employee_name, grade: grade.overall_grade })
    } catch (err) {
      results.push({ id: v.id, dm_name: v.dm_name, employee: '?', grade: 'ERROR', error: String(err) })
    }
  }

  return NextResponse.json({ ok: true, regraded: results })
}
