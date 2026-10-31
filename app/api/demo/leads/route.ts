import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// GET — list all leads (developer only)
export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const leads = await query(`
    SELECT id, first_name, last_name, email, company, industry, team_size, phone,
           notes, status, contact_log, created_at, updated_at
    FROM demo_leads
    ORDER BY
      CASE status WHEN 'new' THEN 0 WHEN 'follow_up' THEN 1 WHEN 'contacted' THEN 2 WHEN 'converted' THEN 3 ELSE 4 END,
      created_at DESC
  `)

  return NextResponse.json({ leads })
}

// PATCH — update lead status or add contact log entry
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { leadId, status, logEntry } = await req.json()
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  if (status) {
    await query(`UPDATE demo_leads SET status = $1, updated_at = NOW() WHERE id = $2`, [status, leadId])
  }

  if (logEntry) {
    const lead = await queryOne<{ contact_log: Array<{ date: string; note: string }> }>(
      `SELECT contact_log FROM demo_leads WHERE id = $1`, [leadId]
    )
    const log = lead?.contact_log ?? []
    log.push({ date: new Date().toISOString(), note: logEntry })
    await query(`UPDATE demo_leads SET contact_log = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(log), leadId])
  }

  return NextResponse.json({ ok: true })
}
