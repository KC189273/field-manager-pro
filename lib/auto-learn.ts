import { query, queryOne } from '@/lib/db'

/** Auto-learn from escalation replies (dev team answers) */
export async function autoLearnEscalation(question: string, answer: string, userName: string, orgId?: string | null) {
  try {
    if (!question || !answer || question.length < 10) return

    // Check for duplicate
    const existing = await queryOne<{ id: string }>(`
      SELECT id FROM learned_answers
      WHERE question = $1 AND source = 'escalation_reply'
      LIMIT 1
    `, [question])
    if (existing) return

    await query(`
      INSERT INTO learned_answers (question, answer, source, user_name, org_id)
      VALUES ($1, $2, 'escalation_reply', $3, $4)
    `, [question.trim(), answer.trim(), userName, orgId || null])
  } catch (err) {
    console.error('Auto-learn escalation failed:', err)
  }
}

/** Auto-learn from successfully resolved conversations (AI solved it) */
export async function autoLearnResolved(question: string, finalAnswer: string, userName: string, orgId?: string | null) {
  try {
    if (!question || !finalAnswer || question.length < 15) return

    // Dedup: check if similar question keywords already exist
    const normalizedQ = question.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const keywords = normalizedQ.split(' ').filter(w => w.length > 4)

    if (keywords.length >= 2) {
      const existing = await query<{ question: string }>(`
        SELECT question FROM learned_answers ORDER BY created_at DESC LIMIT 100
      `)
      const allText = existing.map(r => r.question.toLowerCase()).join(' ')
      const matchCount = keywords.filter(k => allText.includes(k)).length
      if (matchCount >= keywords.length * 0.7) return // Likely already learned
    }

    await query(`
      INSERT INTO learned_answers (question, answer, source, user_name, org_id)
      VALUES ($1, $2, 'resolved_conversation', $3, $4)
    `, [question.trim(), finalAnswer.trim(), userName, orgId || null])
  } catch (err) {
    console.error('Auto-learn resolved failed:', err)
  }
}

/** Load all learned answers as formatted text for the AI system prompt */
export async function loadLearnedAnswers(): Promise<string> {
  try {
    const rows = await query<{ question: string; answer: string; source: string; created_at: string }>(`
      SELECT question, answer, source, created_at::text
      FROM learned_answers
      ORDER BY created_at DESC
      LIMIT 200
    `)

    if (rows.length === 0) return ''

    const formatted = rows.map(r => {
      const sourceLabel = r.source === 'escalation_reply' ? 'dev team answer' : 'resolved by AI'
      const date = new Date(r.created_at).toISOString().split('T')[0]
      return `Q: ${r.question}\nA: ${r.answer}\n(${sourceLabel}, ${date})`
    }).join('\n\n---\n\n')

    return `\n\n# Previously Learned Answers\nThese are answers from past support conversations. Use them to answer similar questions without escalating.\n\n${formatted}`
  } catch (err) {
    console.error('Failed to load learned answers:', err)
    return ''
  }
}

/** Load recent changelog entries for the AI system prompt */
export async function loadChangelog(): Promise<string> {
  try {
    const rows = await query<{ change_date: string; change_type: string; title: string; description: string | null }>(`
      SELECT change_date::text, change_type, title, description
      FROM app_changelog
      ORDER BY change_date DESC
      LIMIT 50
    `)

    if (rows.length === 0) return ''

    const formatted = rows.map(r =>
      `- ${r.change_date} [${r.change_type}]: ${r.title}${r.description ? ' — ' + r.description : ''}`
    ).join('\n')

    return `\n\n# Recent App Changes\nUse these dates when users ask "when was X changed?" or "what's new?"\n\n${formatted}`
  } catch (err) {
    console.error('Failed to load changelog:', err)
    return ''
  }
}
