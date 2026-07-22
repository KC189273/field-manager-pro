import Anthropic from '@anthropic-ai/sdk'
import type { Tool, RunContext } from '../types'
import { scrubPII } from './guardrails'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const DEFAULT_MODEL = process.env.AGENTS_MODEL ?? 'claude-haiku-4-5-20251001'

interface ClaudeLoopResult {
  summary: string
  inputTokens: number
  outputTokens: number
}

export async function runClaudeLoop(
  systemPrompt: string,
  userMessage: string,
  tools: Tool[],
  ctx: RunContext,
  maxSteps: number
): Promise<ClaudeLoopResult> {
  let totalInputTokens = 0
  let totalOutputTokens = 0

  // Build Anthropic tool definitions
  const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }))

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: scrubPII(userMessage) },
  ]

  let steps = 0
  let finalText = ''

  while (steps < maxSteps) {
    steps++

    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      messages,
    })

    totalInputTokens += response.usage.input_tokens
    totalOutputTokens += response.usage.output_tokens

    // Check cost guard after each step
    ctx.spendGuard(totalInputTokens, totalOutputTokens)

    // Extract text blocks and tool use blocks
    const textBlocks = response.content.filter(b => b.type === 'text')
    const toolBlocks = response.content.filter(b => b.type === 'tool_use')

    if (textBlocks.length > 0) {
      finalText = textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n')
    }

    // If no tool calls, we're done
    if (toolBlocks.length === 0 || response.stop_reason === 'end_turn') {
      break
    }

    // Add assistant message with all content blocks
    messages.push({ role: 'assistant', content: response.content })

    // Execute each tool call and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of toolBlocks) {
      if (block.type !== 'tool_use') continue
      const tool = tools.find(t => t.name === block.name)
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
          is_error: true,
        })
        continue
      }

      try {
        const result = await tool.run(block.input as Record<string, unknown>, ctx)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: String(err) }),
          is_error: true,
        })
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }

  return {
    summary: finalText || '(no text output)',
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  }
}
