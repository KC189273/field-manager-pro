import { query, queryOne } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'
import Anthropic from '@anthropic-ai/sdk'

const MONTHLY_CAP_USD = 20.0
const FULL_CHECK_THRESHOLD = 15.0 // Switch to targeted mode above this
const COST_PER_CHECK = 0.005 // Estimated cost per Haiku vision call

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

interface UniformResult {
  result: 'pass' | 'fail' | 'unclear' | 'skipped'
  shirt_ok: boolean | null
  nametag_ok: boolean | null
  details: string
  cost_usd: number
}

/** Get monthly spend on uniform checks */
async function getMonthlySpend(): Promise<number> {
  const row = await queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(cost_usd), 0)::float as total
    FROM uniform_checks
    WHERE created_at >= DATE_TRUNC('month', NOW())
  `)
  return row?.total ?? 0
}

/** Check if this user has prior uniform violations */
async function hasPriorViolations(userId: string): Promise<boolean> {
  const row = await queryOne<{ cnt: number }>(`
    SELECT COUNT(*)::int as cnt FROM uniform_checks
    WHERE user_id = $1 AND result = 'fail' AND created_at >= NOW() - INTERVAL '90 days'
  `, [userId])
  return (row?.cnt ?? 0) > 0
}

/**
 * Check a clock-in photo for uniform compliance.
 * Fire-and-forget — never blocks clock-in, runs async after shift is created.
 */
export async function checkUniformPhoto(
  shiftId: string,
  userId: string,
  photoKey: string,
  userName: string,
  legalName: string | null,
  managerId: string | null,
): Promise<void> {
  try {
    const monthlySpend = await getMonthlySpend()

    // Hard cap — stop checking
    if (monthlySpend >= MONTHLY_CAP_USD) {
      await query(
        `INSERT INTO uniform_checks (shift_id, user_id, photo_key, result, details, cost_usd)
         VALUES ($1, $2, $3, 'skipped', 'Monthly cost cap reached ($20)', 0)`,
        [shiftId, userId, photoKey]
      )
      return
    }

    // Targeted mode — only check repeat offenders
    if (monthlySpend >= FULL_CHECK_THRESHOLD) {
      const prior = await hasPriorViolations(userId)
      if (!prior) {
        await query(
          `INSERT INTO uniform_checks (shift_id, user_id, photo_key, result, details, cost_usd)
           VALUES ($1, $2, $3, 'skipped', 'Targeted mode — no prior violations', 0)`,
          [shiftId, userId, photoKey]
        )
        return
      }
    }

    // Get presigned URL for the photo
    const photoUrl = await getReceiptViewUrl(photoKey)

    // Call Claude Haiku vision
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: photoUrl },
          },
          {
            type: 'text',
            text: `You are checking a retail employee's clock-in selfie for uniform compliance.

IMPORTANT: This is a SELFIE taken with a front-facing camera. Text on clothing will appear MIRROR-REVERSED in the image. When checking for logos or text, mentally flip/reverse any text you see. "eliboM-T" reversed is "T-Mobile". "orteM" reversed is "Metro". DO NOT flag reversed text as non-compliant — it is the expected result of a selfie camera.

The employee's preferred name is: ${userName}
${legalName && legalName !== userName ? `The employee's legal name is: ${legalName}` : ''}

Check for:
1. SHIRT: Is the person wearing a T-Mobile or Metro by T-Mobile branded shirt? Look for magenta/pink color and/or T-Mobile/Metro logo (may appear reversed in selfie). A magenta/pink polo or t-shirt with any T-Mobile or Metro branding counts as compliant.
2. NAME TAG: Is a name badge/tag visible? If you can read the name on the tag, does it match or closely match "${userName}"${legalName && legalName !== userName ? ` OR "${legalName}"` : ''}? Either name is acceptable. If the name is completely different from both, flag it.
3. HAT: If the person is wearing a hat, is it a T-Mobile or Metro by T-Mobile branded hat? A hat is NOT required — only flag if they ARE wearing a hat that is not T-Mobile/Metro branded.

Respond with ONLY a JSON object (no markdown):
{"shirt_ok": true/false, "nametag_ok": true/false, "nametag_name_match": true/false/null, "hat_ok": true/false/null, "details": "brief description of what you see"}

Rules:
- shirt_ok: true if wearing T-Mobile/Metro shirt (even if text is reversed in selfie), false if clearly not
- nametag_ok: true if a name badge is visible, false if no badge visible
- nametag_name_match: true if name on tag matches "${userName}"${legalName && legalName !== userName ? ` or "${legalName}"` : ''}, false if a completely different name is visible, null if can't read the name
- hat_ok: true if wearing a T-Mobile/Metro hat OR no hat at all, false if wearing a non-branded hat, null if can't tell
- If the photo is too dark, blurry, or you genuinely can't tell, use null for that field`,
          },
        ],
      }],
    })

    // Parse response
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0
    // Haiku pricing: $0.80/MTok input, $4/MTok output for vision
    const cost = (inputTokens * 0.0000008) + (outputTokens * 0.000004)

    let parsed: { shirt_ok: boolean | null; nametag_ok: boolean | null; nametag_name_match: boolean | null; hat_ok: boolean | null; details: string }
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { shirt_ok: null, nametag_ok: null, nametag_name_match: null, hat_ok: null, details: text.slice(0, 500) }
    }

    const result: UniformResult['result'] =
      (parsed.shirt_ok === false || parsed.nametag_ok === false || parsed.hat_ok === false || parsed.nametag_name_match === false) ? 'fail' :
      (parsed.shirt_ok === null || parsed.nametag_ok === null) ? 'unclear' : 'pass'

    // Save result
    await query(
      `INSERT INTO uniform_checks (shift_id, user_id, photo_key, result, shirt_ok, nametag_ok, details, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [shiftId, userId, photoKey, result, parsed.shirt_ok, parsed.nametag_ok, parsed.details?.slice(0, 500) || '', cost]
    )

    // If fail — flag and notify DM
    if (result === 'fail') {
      const issues: string[] = []
      if (parsed.shirt_ok === false) issues.push('not wearing T-Mobile/Metro shirt')
      if (parsed.nametag_ok === false) issues.push('no visible name tag')
      if (parsed.nametag_name_match === false) issues.push('wrong name on name tag')
      if (parsed.hat_ok === false) issues.push('wearing non-branded hat')

      const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
      await query(
        `INSERT INTO flags (user_id, shift_id, type, date, detail)
         VALUES ($1, $2, 'uniform_violation', $3, $4)`,
        [userId, shiftId, todayCST,
         `${userName}: ${issues.join(', ')}. AI confidence: ${parsed.details || 'N/A'}`]
      )

      if (managerId) {
        const { sendPushToUser } = await import('@/lib/apns')
        sendPushToUser(
          managerId,
          'Uniform Issue Detected',
          `${userName} clocked in — ${issues.join(', ')}.`,
          'flag_created'
        ).catch(() => {})
      }
    }
  } catch (err) {
    console.error('Uniform check error:', err)
    // Never block — just log the error
    await query(
      `INSERT INTO uniform_checks (shift_id, user_id, photo_key, result, details, cost_usd)
       VALUES ($1, $2, $3, 'skipped', $4, 0)`,
      [shiftId, userId, photoKey, `Error: ${String(err).slice(0, 200)}`]
    ).catch(() => {})
  }
}
