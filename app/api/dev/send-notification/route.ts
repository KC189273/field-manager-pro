import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { userId, email, title, body, pushType, emailSubject, emailHtml } = await req.json()

  const results: string[] = []

  if (userId && title && body) {
    await sendPushToUser(userId, title, body, pushType || 'clock').catch(e => results.push('push-error: ' + String(e)))
    results.push('push-sent')
  }
  if (email && emailSubject && emailHtml) {
    await sendEmail(email, emailSubject, emailHtml).catch(e => results.push('email-error: ' + String(e)))
    results.push('email-sent')
  }

  return NextResponse.json({ ok: true, results })
}
