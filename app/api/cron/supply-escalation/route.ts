import { NextResponse } from 'next/server'

// Supply escalation cron — DISABLED
// Supply requests now go to DM only. No auto-escalation.
export async function GET() {
  return NextResponse.json({ ok: true, disabled: true })
}
