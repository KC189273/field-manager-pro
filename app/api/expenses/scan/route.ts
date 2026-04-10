import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getSession, canSubmitExpense } from '@/lib/auth'
import { getReceiptViewUrl } from '@/lib/s3'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canSubmitExpense(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { receiptKey } = await req.json()
  if (!receiptKey) {
    return NextResponse.json({ error: 'Missing receiptKey' }, { status: 400 })
  }

  const imageUrl = await getReceiptViewUrl(receiptKey)

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: imageUrl },
          },
          {
            type: 'text',
            text: `You are scanning a business expense receipt. Extract the following fields and respond ONLY with a valid JSON object. If a field cannot be determined, use null.

{
  "date": "YYYY-MM-DD",
  "amount": 0.00,
  "category": "Meals" | "Mileage" | "Supplies" | "Contest" | "Other",
  "description": "brief description of what was purchased"
}

Rules:
- date: use the receipt date in YYYY-MM-DD format
- amount: the total amount charged, as a number (no currency symbol)
- category: pick the best match from the allowed values
- description: 1-2 sentences max describing the purchase`,
          },
        ],
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')
    const data = JSON.parse(jsonMatch[0])
    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: 'Could not parse receipt' }, { status: 422 })
  }
}
