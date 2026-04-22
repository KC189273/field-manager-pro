import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/notifications'

const ADMIN_EMAIL = process.env.REPORT_EMAIL_TO ?? process.env.REPORT_EMAIL_FROM!

export async function POST(req: NextRequest) {
  const { businessName, contactName, email, phone, teamSize, industry, challenge, currentSoftware, timeline, message } = await req.json()

  if (!businessName || !contactName || !email || !teamSize) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">New Access Request</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:16px;font-weight:700;color:#1c1c1e;margin:0 0 16px;">A new business has requested access to Field Manager Pro.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;width:130px;">Business</td>
            <td style="padding:10px 0;color:#1c1c1e;font-weight:600;">${businessName}</td>
          </tr>
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;">Contact</td>
            <td style="padding:10px 0;color:#1c1c1e;">${contactName}</td>
          </tr>
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;">Email</td>
            <td style="padding:10px 0;color:#1c1c1e;"><a href="mailto:${email}" style="color:#7c3aed;">${email}</a></td>
          </tr>
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;">Phone</td>
            <td style="padding:10px 0;color:#1c1c1e;">${phone || '—'}</td>
          </tr>
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;">Team Size</td>
            <td style="padding:10px 0;color:#1c1c1e;">${teamSize}</td>
          </tr>
          ${industry ? `
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;">Industry</td>
            <td style="padding:10px 0;color:#1c1c1e;">${industry}</td>
          </tr>` : ''}
          ${challenge ? `
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;">Biggest Challenge</td>
            <td style="padding:10px 0;color:#1c1c1e;">${challenge}</td>
          </tr>` : ''}
          ${currentSoftware ? `
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;">Current Software</td>
            <td style="padding:10px 0;color:#1c1c1e;">${currentSoftware}</td>
          </tr>` : ''}
          ${timeline ? `
          <tr style="border-bottom:1px solid #f2f2f7;">
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;">Timeline</td>
            <td style="padding:10px 0;color:#1c1c1e;">${timeline}</td>
          </tr>` : ''}
          ${message ? `
          <tr>
            <td style="padding:10px 0;color:#8e8e93;font-weight:600;vertical-align:top;">Message</td>
            <td style="padding:10px 0;color:#1c1c1e;">${message}</td>
          </tr>` : ''}
        </table>
        <p style="font-size:12px;color:#8e8e93;margin:0;">Submitted via the Field Manager Pro app — reply to <a href="mailto:${email}" style="color:#7c3aed;">${email}</a> to follow up.</p>
      </div>
    </div>
  `

  await sendEmail(ADMIN_EMAIL, `New FMP Access Request — ${businessName}`, html)

  return NextResponse.json({ ok: true })
}
