import Anthropic from '@anthropic-ai/sdk'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MODEL = 'claude-haiku-4-5-20251001'

export interface CoachingGradeResult {
  overall_grade: string // A+ through F
  overall_score: number // 0-100
  specificity: { grade: string; score: number; feedback: string }
  actionability: { grade: string; score: number; feedback: string }
  follow_up: { grade: string; score: number; feedback: string }
  depth: { grade: string; score: number; feedback: string }
  prior_reference: { grade: string; score: number; feedback: string }
  summary: string
  improvement_tips: string[]
}

const GRADE_MAP: [number, string][] = [
  [97, 'A+'], [93, 'A'], [90, 'A-'],
  [87, 'B+'], [83, 'B'], [80, 'B-'],
  [77, 'C+'], [73, 'C'], [70, 'C-'],
  [67, 'D+'], [63, 'D'], [60, 'D-'],
  [0, 'F'],
]

export function scoreToGrade(score: number): string {
  for (const [min, grade] of GRADE_MAP) {
    if (score >= min) return grade
  }
  return 'F'
}

export function gradeToScore(grade: string): number {
  const map: Record<string, number> = {
    'A+': 98, 'A': 95, 'A-': 91,
    'B+': 88, 'B': 85, 'B-': 81,
    'C+': 78, 'C': 75, 'C-': 71,
    'D+': 68, 'D': 65, 'D-': 61,
    'F': 50,
  }
  return map[grade] ?? 50
}

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS coaching_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      visit_id UUID NOT NULL,
      dm_id UUID NOT NULL,
      dm_name TEXT NOT NULL,
      org_id UUID,
      store_address TEXT,
      employee_coached TEXT,
      graded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      overall_grade TEXT NOT NULL,
      overall_score INT NOT NULL,
      specificity_grade TEXT, specificity_score INT, specificity_feedback TEXT,
      actionability_grade TEXT, actionability_score INT, actionability_feedback TEXT,
      follow_up_grade TEXT, follow_up_score INT, follow_up_feedback TEXT,
      depth_grade TEXT, depth_score INT, depth_feedback TEXT,
      prior_reference_grade TEXT, prior_reference_score INT, prior_reference_feedback TEXT,
      summary TEXT,
      improvement_tips JSONB,
      raw_response JSONB
    )
  `).catch(() => {})
  await query(`CREATE INDEX IF NOT EXISTS idx_coaching_grades_dm ON coaching_grades(dm_id, graded_at DESC)`).catch(() => {})
  await query(`CREATE INDEX IF NOT EXISTS idx_coaching_grades_org ON coaching_grades(org_id, graded_at DESC)`).catch(() => {})
}

export async function gradeCoaching(params: {
  visitId: string
  dmId: string
  dmName: string
  dmEmail: string
  orgId: string | null
  storeAddress: string
  employeeCoachedName: string | null
  coaching1: string // Behaviors / Skills Coached
  coaching2: string // Action Items Agreed Upon
  coaching3: string // Follow-Up Plan
  // Coaching checklist data (if quick_coaching)
  obsData?: {
    greeted_customer: boolean; offered_mim: boolean; offered_hsi: boolean
    pitched_accessories: boolean; open_ended_questions: boolean; educated_survey: boolean
    primary_issue: string | null
  }
  rpData?: { score: string | null; notes: string | null }
  kcData?: {
    mim_knowledge: string | null; hsi_knowledge: string | null
    objection_handling: string | null; gap_notes: string | null
  }
  commitments: string | null
  followUpDate: string | null
  // Remote coaching extra context
  remoteContext?: {
    mlbGrade: string | null
    skillOrWill: string | null
    saTheme: string | null
    saCompletedProperly: string | null
    transactionCount: string | null
    transactionsDocumented: string | null
    prevCommitment: string | null
    prevCompleted: string | null
    prevResult: string | null
    strength: string | null
    learned: string | null
    behaviorChange: string | null
    impact: string | null
    mlbStrength: string | null
    mlbOpportunity: string | null
    priorities: string | null
    mainFocus: string | null
  }
}): Promise<CoachingGradeResult> {
  await ensureTable()

  // Get prior coaching grades for this DM (for context on improvement)
  const priorGrades = await query<{ overall_grade: string; graded_at: string; store_address: string }>(`
    SELECT overall_grade, graded_at::text, store_address FROM coaching_grades
    WHERE dm_id = $1 ORDER BY graded_at DESC LIMIT 5
  `, [params.dmId]).catch(() => [])

  const priorContext = priorGrades.length > 0
    ? `\nThis DM's last ${priorGrades.length} coaching grades: ${priorGrades.map(g => `${g.overall_grade} (${g.graded_at.slice(0, 10)} at ${g.store_address})`).join(', ')}`
    : '\nThis is the first coaching submission from this DM — no prior grades to compare.'

  // Build coaching data summary for AI
  let checklistSummary = ''
  if (params.obsData) {
    const obs = params.obsData
    const checks = [
      ['Greeted customer', obs.greeted_customer],
      ['Offered MiM', obs.offered_mim],
      ['Offered HSI', obs.offered_hsi],
      ['Pitched accessories', obs.pitched_accessories],
      ['Asked open-ended questions', obs.open_ended_questions],
      ['Educated on survey', obs.educated_survey],
    ]
    checklistSummary += '\nObservation Checklist:\n' + checks.map(([label, val]) => `  ${val ? '✓' : '✗'} ${label}`).join('\n')
    if (obs.primary_issue) checklistSummary += `\n  Primary Issue Observed: ${obs.primary_issue}`
  }
  if (params.rpData?.score) {
    checklistSummary += `\nRole Play Score: ${params.rpData.score}`
    if (params.rpData.notes) checklistSummary += `\n  Role Play Notes: ${params.rpData.notes}`
  }
  if (params.kcData) {
    const kc = params.kcData
    if (kc.mim_knowledge || kc.hsi_knowledge || kc.objection_handling) {
      checklistSummary += '\nKnowledge Check:'
      if (kc.mim_knowledge) checklistSummary += `\n  MiM Knowledge: ${kc.mim_knowledge}`
      if (kc.hsi_knowledge) checklistSummary += `\n  HSI Knowledge: ${kc.hsi_knowledge}`
      if (kc.objection_handling) checklistSummary += `\n  Objection Handling: ${kc.objection_handling}`
      if (kc.gap_notes) checklistSummary += `\n  Knowledge Gaps: ${kc.gap_notes}`
    }
  }
  if (params.commitments) checklistSummary += `\nCommitments Gained: ${params.commitments}`
  if (params.followUpDate) checklistSummary += `\nFollow-Up Date: ${params.followUpDate}`

  // Remote coaching specific context
  let remoteSection = ''
  if (params.remoteContext) {
    const rc = params.remoteContext
    remoteSection = '\n\nREMOTE COACHING SESSION DATA:'
    if (rc.mlbGrade) remoteSection += `\nStore MLB (Metro Leaderboard) Grade: ${rc.mlbGrade}`
    if (rc.skillOrWill) remoteSection += `\nIdentified as: ${rc.skillOrWill} issue`
    if (rc.saTheme) remoteSection += `\nService Analysis Theme: ${rc.saTheme}`
    if (rc.saCompletedProperly) remoteSection += `\nService Analysis Completed Properly: ${rc.saCompletedProperly}`
    if (rc.transactionCount) remoteSection += `\nTransaction Count: ${rc.transactionCount}`
    if (rc.transactionsDocumented) remoteSection += `\nTransactions Documented: ${rc.transactionsDocumented}`
    if (rc.prevCommitment) remoteSection += `\nPrevious Commitment: ${rc.prevCommitment} (Completed: ${rc.prevCompleted || 'N/A'})`
    if (rc.prevResult) remoteSection += `\nPrevious Result: ${rc.prevResult}`
    if (rc.strength) remoteSection += `\nStrength Recognized: ${rc.strength}`
    if (rc.learned) remoteSection += `\nLearned from Rep: ${rc.learned}`
    if (rc.behaviorChange) remoteSection += `\nBehavior to Change: ${rc.behaviorChange}`
    if (rc.impact) remoteSection += `\nConversation Impact: ${rc.impact}`
    if (rc.mlbStrength) remoteSection += `\nMLB Strength: ${rc.mlbStrength}`
    if (rc.mlbOpportunity) remoteSection += `\nMLB Opportunity: ${rc.mlbOpportunity}`
    if (rc.priorities) remoteSection += `\nTop Priorities: ${rc.priorities}`
    if (rc.mainFocus) remoteSection += `\nMain Store Focus: ${rc.mainFocus}`
  }

  const mlbGradeContext = params.remoteContext?.mlbGrade
    ? `\n\nIMPORTANT — MLB GRADE CONTEXT: This store has an MLB grade of "${params.remoteContext.mlbGrade}". Adjust your expectations accordingly:
- A-grade store: Coaching can be lighter and conversational. Focus on maintaining excellence and stretch goals.
- B-grade store: Solid but room to grow. Coaching should identify specific areas to push from good to great.
- C-grade store: Average. Coaching needs to be more structured with clear measurables and accountability.
- D-grade store: Below expectations. Coaching MUST be highly detailed, specific about root causes, with aggressive commitments and tight follow-up.
- F-grade store: Critical. Coaching must be extremely thorough — no room for vague or light coaching. Expect specific behavioral changes, daily commitments, and immediate follow-up plans. Grade harshly if the coaching doesn't match the urgency of an F-ranked store.`
    : ''

  const prompt = `You are an expert coaching quality assessor for a wireless retail district manager team. Grade this DM's coaching session.

COACHING SUBMISSION:
Store: ${params.storeAddress}
Employee Coached: ${params.employeeCoachedName || 'Not specified'}
Behaviors / Skills Coached: ${params.coaching1 || '(empty)'}
Action Items Agreed Upon: ${params.coaching2 || '(empty)'}
Follow-Up Plan: ${params.coaching3 || '(empty)'}
${checklistSummary}${remoteSection}
${priorContext}${mlbGradeContext}

GRADING CRITERIA (weighted):
1. SPECIFICITY (25%): Did the DM describe specific behaviors they observed? Did they reference concrete examples? Vague coaching like "work on sales" = low score. "I noticed you didn't offer Home Internet to the last 3 customers — here's how to naturally bring it up..." = high score.
2. ACTIONABILITY (25%): Are the action items concrete and measurable? Can the employee actually do something different tomorrow? "Improve sales" = low. "Practice the MiM pitch with your opening 3 customers tomorrow and track conversion" = high.
3. FOLLOW-UP QUALITY (20%): Is there a specific follow-up plan? Date set? Clear accountability? "I'll check in" = low. "Follow-up on Friday 8/22 to review MiM conversion rate and role-play the HSI objection script" = high.
4. DEPTH OF OBSERVATION (20%): How thorough was the observation? Did they use the checklist fully? Did they identify root causes, not just symptoms? One checkbox = low. Full checklist with detailed notes on each area = high.
5. REFERENCE TO PRIOR COACHING (10%): Did the DM connect this session to previous coaching? Show progress tracking? First-time DMs get a baseline pass here.

RESPONSE FORMAT (JSON only, no markdown):
{
  "overall_score": <0-100>,
  "specificity": { "score": <0-100>, "feedback": "..." },
  "actionability": { "score": <0-100>, "feedback": "..." },
  "follow_up": { "score": <0-100>, "feedback": "..." },
  "depth": { "score": <0-100>, "feedback": "..." },
  "prior_reference": { "score": <0-100>, "feedback": "..." },
  "summary": "2-3 sentence overall assessment",
  "improvement_tips": ["tip 1", "tip 2", "tip 3"]
}

Be fair but demanding. Great coaching develops people — generic coaching wastes everyone's time. Grade honestly.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  let parsed: {
    overall_score: number
    specificity: { score: number; feedback: string }
    actionability: { score: number; feedback: string }
    follow_up: { score: number; feedback: string }
    depth: { score: number; feedback: string }
    prior_reference: { score: number; feedback: string }
    summary: string
    improvement_tips: string[]
  }

  try {
    const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    parsed = JSON.parse(jsonStr)
  } catch {
    // Fallback if AI response isn't valid JSON
    parsed = {
      overall_score: 70,
      specificity: { score: 70, feedback: 'Could not parse AI response' },
      actionability: { score: 70, feedback: '' },
      follow_up: { score: 70, feedback: '' },
      depth: { score: 70, feedback: '' },
      prior_reference: { score: 70, feedback: '' },
      summary: 'Grading temporarily unavailable.',
      improvement_tips: [],
    }
  }

  // Calculate weighted overall score
  const weightedScore = Math.round(
    parsed.specificity.score * 0.25 +
    parsed.actionability.score * 0.25 +
    parsed.follow_up.score * 0.20 +
    parsed.depth.score * 0.20 +
    parsed.prior_reference.score * 0.10
  )

  const result: CoachingGradeResult = {
    overall_grade: scoreToGrade(weightedScore),
    overall_score: weightedScore,
    specificity: { ...parsed.specificity, grade: scoreToGrade(parsed.specificity.score) },
    actionability: { ...parsed.actionability, grade: scoreToGrade(parsed.actionability.score) },
    follow_up: { ...parsed.follow_up, grade: scoreToGrade(parsed.follow_up.score) },
    depth: { ...parsed.depth, grade: scoreToGrade(parsed.depth.score) },
    prior_reference: { ...parsed.prior_reference, grade: scoreToGrade(parsed.prior_reference.score) },
    summary: parsed.summary,
    improvement_tips: parsed.improvement_tips,
  }

  // Save to database
  await query(`
    INSERT INTO coaching_grades (
      visit_id, dm_id, dm_name, org_id, store_address, employee_coached,
      overall_grade, overall_score,
      specificity_grade, specificity_score, specificity_feedback,
      actionability_grade, actionability_score, actionability_feedback,
      follow_up_grade, follow_up_score, follow_up_feedback,
      depth_grade, depth_score, depth_feedback,
      prior_reference_grade, prior_reference_score, prior_reference_feedback,
      summary, improvement_tips, raw_response
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
  `, [
    params.visitId, params.dmId, params.dmName, params.orgId, params.storeAddress,
    params.employeeCoachedName,
    result.overall_grade, result.overall_score,
    result.specificity.grade, result.specificity.score, result.specificity.feedback,
    result.actionability.grade, result.actionability.score, result.actionability.feedback,
    result.follow_up.grade, result.follow_up.score, result.follow_up.feedback,
    result.depth.grade, result.depth.score, result.depth.feedback,
    result.prior_reference.grade, result.prior_reference.score, result.prior_reference.feedback,
    result.summary, JSON.stringify(result.improvement_tips), JSON.stringify(parsed),
  ]).catch(err => console.error('Coaching grade save error:', err))

  // Send detailed email to DM
  const gradeColor = (g: string) => {
    if (g.startsWith('A')) return '#16a34a'
    if (g.startsWith('B')) return '#2563eb'
    if (g.startsWith('C')) return '#d97706'
    if (g.startsWith('D')) return '#ea580c'
    return '#dc2626'
  }

  const categoryRow = (label: string, weight: string, cat: { grade: string; score: number; feedback: string }) => `
    <div style="padding:12px 16px;border-bottom:1px solid #f3f4f6;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:600;color:#111827;font-size:14px;">${label} <span style="font-weight:400;color:#9ca3af;font-size:12px;">(${weight})</span></span>
        <span style="font-weight:700;color:${gradeColor(cat.grade)};font-size:16px;">${cat.grade}</span>
      </div>
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">${cat.feedback}</p>
    </div>`

  const emailHtml = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:${gradeColor(result.overall_grade)};padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <p style="color:rgba(255,255,255,0.8);margin:0 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Coaching Grade</p>
      <h1 style="color:white;margin:0;font-size:48px;font-weight:800;">${result.overall_grade}</h1>
      <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">${params.storeAddress}</p>
      <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:12px;">${params.employeeCoachedName ? `Coaching: ${params.employeeCoachedName} · ` : ''}${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' })}</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;background:white;">
      <div style="padding:16px;border-bottom:1px solid #e5e7eb;">
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${result.summary}</p>
      </div>
      ${categoryRow('Specificity', '25%', result.specificity)}
      ${categoryRow('Actionability', '25%', result.actionability)}
      ${categoryRow('Follow-Up Quality', '20%', result.follow_up)}
      ${categoryRow('Depth of Observation', '20%', result.depth)}
      ${categoryRow('Prior Coaching Reference', '10%', result.prior_reference)}
      ${result.improvement_tips.length > 0 ? `
        <div style="padding:16px;background:#f9fafb;">
          <p style="font-weight:700;color:#7c3aed;font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px;">How to Improve</p>
          ${result.improvement_tips.map(tip => `<div style="padding:6px 0;font-size:13px;color:#374151;line-height:1.5;">• ${tip}</div>`).join('')}
        </div>` : ''}
    </div>
    <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">AI Coaching Grade via Field Manager Pro</p>
  </div>`

  sendEmail(
    params.dmEmail,
    `Coaching Grade: ${result.overall_grade} — ${params.storeAddress}`,
    emailHtml
  ).catch(err => console.error('Coaching grade email error:', err))

  return result
}
