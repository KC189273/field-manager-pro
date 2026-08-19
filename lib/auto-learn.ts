import * as fs from 'fs'
import * as path from 'path'

const LEARNED_PATH = path.join(process.cwd(), 'lib/agents/knowledge/shared/learned-answers.md')

function ensureFile() {
  if (!fs.existsSync(LEARNED_PATH)) {
    const date = new Date().toISOString().split('T')[0]
    const header = `---
sources: []
features:
  - learned-answers
permissions:
  - "auto-generated from resolved support conversations and escalation replies"
verified: ${date}
---
# Learned Answers

These answers were learned from successful support conversations and escalation replies. The AI Assistant uses these to answer similar questions without escalating again.
`
    fs.writeFileSync(LEARNED_PATH, header)
  }
}

function updateVerifiedDate() {
  const date = new Date().toISOString().split('T')[0]
  const content = fs.readFileSync(LEARNED_PATH, 'utf-8')
  const updated = content.replace(/verified: \d{4}-\d{2}-\d{2}/, `verified: ${date}`)
  fs.writeFileSync(LEARNED_PATH, updated)
}

/** Auto-learn from escalation replies (dev team answers) */
export function autoLearnEscalation(question: string, answer: string, userName: string) {
  try {
    ensureFile()
    const date = new Date().toISOString().split('T')[0]
    const entry = `\n\n## Q: ${question}\n**A:** ${answer}\n*Answered ${date} for ${userName} (escalation reply)*\n`
    fs.appendFileSync(LEARNED_PATH, entry)
    updateVerifiedDate()
  } catch (err) {
    console.error('Auto-learn escalation write failed:', err)
  }
}

/** Auto-learn from successfully resolved conversations (AI solved it) */
export function autoLearnResolved(question: string, finalAnswer: string, userName: string) {
  try {
    ensureFile()

    // Check if a similar question is already in the learned answers (avoid duplicates)
    const existing = fs.readFileSync(LEARNED_PATH, 'utf-8')
    const normalizedQ = question.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    if (normalizedQ.length < 15) return // Too short to be useful

    // Simple dedup: check if question keywords are already present
    const keywords = normalizedQ.split(' ').filter(w => w.length > 4)
    if (keywords.length >= 2) {
      const matchCount = keywords.filter(k => existing.toLowerCase().includes(k)).length
      if (matchCount >= keywords.length * 0.7) return // Likely already learned
    }

    const date = new Date().toISOString().split('T')[0]
    const entry = `\n\n## Q: ${question}\n**A:** ${finalAnswer}\n*Auto-learned ${date} from resolved conversation with ${userName}*\n`
    fs.appendFileSync(LEARNED_PATH, entry)
    updateVerifiedDate()
  } catch (err) {
    console.error('Auto-learn resolved write failed:', err)
  }
}
