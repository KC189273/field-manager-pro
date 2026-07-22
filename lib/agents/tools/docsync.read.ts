import * as fs from 'fs'
import * as path from 'path'
import type { Tool, RunContext } from '../types'

const KNOWLEDGE_DIR = path.join(process.cwd(), 'lib/agents/knowledge')

interface DocMapping {
  file: string
  sources: string[]
  features: string[]
  permissions: string[]
  verified: string
  content: string
}

function parseFrontmatter(filePath: string): DocMapping | null {
  const raw = fs.readFileSync(filePath, 'utf-8')
  if (!raw.startsWith('---\n')) return null

  const endIdx = raw.indexOf('\n---\n', 4)
  if (endIdx === -1) return null

  const frontmatter = raw.substring(4, endIdx)
  const content = raw.substring(endIdx + 5)
  const relPath = path.relative(KNOWLEDGE_DIR, filePath)

  const sources: string[] = []
  const features: string[] = []
  const permissions: string[] = []
  let verified = ''
  let currentList: string[] | null = null

  for (const line of frontmatter.split('\n')) {
    if (line.startsWith('sources:')) { currentList = sources; continue }
    if (line.startsWith('features:')) { currentList = features; continue }
    if (line.startsWith('permissions:')) { currentList = permissions; continue }
    if (line.startsWith('verified:')) { verified = line.replace('verified:', '').trim(); currentList = null; continue }
    if (currentList && line.startsWith('  - ')) {
      currentList.push(line.replace('  - ', '').replace(/^"|"$/g, ''))
    }
  }

  return { file: relPath, sources, features, permissions, verified, content }
}

// Get all doc mappings with their frontmatter
export const getDocMappingsTool: Tool = {
  name: 'get_doc_mappings',
  description: 'Load all help docs with their frontmatter mappings (source files, features, permissions, last verified date). Use this to identify docs that may be stale based on the verified date or source file changes.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async run(_input: Record<string, unknown>, _ctx: RunContext) {
    const docs: DocMapping[] = []

    for (const namespace of ['wireless_retail', 'barbershop', 'shared']) {
      const dir = path.join(KNOWLEDGE_DIR, namespace)
      if (!fs.existsSync(dir)) continue
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const mapping = parseFrontmatter(path.join(dir, file))
        if (mapping) docs.push(mapping)
      }
    }

    // Sort by verified date (oldest first = most likely stale)
    docs.sort((a, b) => (a.verified || '9999').localeCompare(b.verified || '9999'))

    return {
      total: docs.length,
      docs: docs.map(d => ({
        file: d.file,
        sources: d.sources,
        features: d.features,
        permissions: d.permissions,
        verified: d.verified,
        content_length: d.content.length,
        content_preview: d.content.substring(0, 200),
      })),
    }
  },
}

// Get the full content of a specific doc for review
export const getDocContentTool: Tool = {
  name: 'get_doc_content',
  description: 'Get the full content of a specific help doc by its file path (e.g., "wireless_retail/clock-in.md"). Use this when you need to review a doc to check if it needs updating.',
  input_schema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Doc file path relative to knowledge dir (e.g., "wireless_retail/clock-in.md")' },
    },
    required: ['file'],
  },
  async run(input: Record<string, unknown>, _ctx: RunContext) {
    const file = input.file as string
    const filePath = path.join(KNOWLEDGE_DIR, file)
    if (!fs.existsSync(filePath)) return { error: `File not found: ${file}` }
    const mapping = parseFrontmatter(filePath)
    if (!mapping) return { error: 'Could not parse frontmatter' }
    return mapping
  },
}
