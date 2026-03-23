import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function sendEmail(to: string | string[], subject: string, html: string): Promise<void> {
  try {
    await resend.emails.send({
      from: process.env.REPORT_EMAIL_FROM!,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    })
  } catch (e) {
    console.error('Email send failed:', e)
  }
}

export function welcomeEmailHtml(fullName: string, username: string, password: string, role: string): string {
  const appUrl = process.env.APP_URL ?? 'https://field-manager-pro-juo3-sg2425231-2580s-projects.vercel.app'
  const roleLabel = role === 'manager' ? 'Manager' : role === 'ops_manager' ? 'Ops Manager' : 'Employee'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Welcome to the team</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:16px;color:#1c1c1e;margin:0 0 16px;">Hi ${fullName},</p>
        <p style="font-size:14px;color:#555;margin:0 0 20px;">Your Field Manager Pro account has been created. Use the credentials below to sign in.</p>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#8e8e93;font-weight:600;width:110px;">Role</td><td style="padding:6px 0;color:#1c1c1e;">${roleLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#8e8e93;font-weight:600;">Username</td><td style="padding:6px 0;color:#1c1c1e;font-family:monospace;">${username}</td></tr>
            <tr><td style="padding:6px 0;color:#8e8e93;font-weight:600;">Password</td><td style="padding:6px 0;color:#1c1c1e;font-family:monospace;">${password}</td></tr>
          </table>
        </div>
        <a href="${appUrl}/login" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-bottom:20px;">Sign In to Field Manager Pro</a>
        <p style="font-size:12px;color:#8e8e93;margin:0;">Or copy this link: <span style="color:#7c3aed;">${appUrl}/login</span></p>
        <p style="font-size:12px;color:#8e8e93;margin:16px 0 0;">Please change your password after your first login.</p>
      </div>
    </div>
  `
}

export function flagAlertHtml(employeeName: string, flagType: string, date: string, detail: string): string {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Time Tracking Alert</p>
      </div>
      <div style="background:#fff3e0;border:1px solid #ff9f0a;border-radius:0 0 12px 12px;padding:20px 24px;">
        <p style="font-size:16px;font-weight:700;color:#e65100;margin:0 0 8px;">⚠ ${flagType}</p>
        <p style="font-size:14px;color:#555;margin:0 0 4px;"><strong>Employee:</strong> ${employeeName}</p>
        <p style="font-size:14px;color:#555;margin:0 0 4px;"><strong>Date:</strong> ${date}</p>
        <p style="font-size:14px;color:#555;margin:0;"><strong>Detail:</strong> ${detail}</p>
        <p style="font-size:12px;color:#8e8e93;margin:16px 0 0;">Log in to Field Manager Pro to review and resolve this flag.</p>
      </div>
    </div>
  `
}

export function scheduleSubmittedHtml(employeeName: string, weekStart: string, days: string[]): string {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Schedule Submitted</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        <p style="font-size:15px;color:#1c1c1e;margin:0 0 12px;"><strong>${employeeName}</strong> has submitted their schedule for the week of <strong>${weekStart}</strong>.</p>
        <p style="font-size:14px;color:#555;margin:0 0 8px;">Working days:</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
          ${days.map(d => `<span style="background:#ede9fe;color:#7c3aed;padding:4px 10px;border-radius:20px;font-size:13px;font-weight:600;">${d}</span>`).join('')}
        </div>
        <p style="font-size:12px;color:#8e8e93;margin:0;">Log in to Field Manager Pro to view all schedule submissions.</p>
      </div>
    </div>
  `
}

export function manualTimeEntryHtml(employeeName: string, date: string, clockIn: string, clockOut: string, note: string, managerName: string): string {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Time Entry Adjustment</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        <p style="font-size:15px;color:#1c1c1e;margin:0 0 12px;">Your time entry for <strong>${date}</strong> has been adjusted by <strong>${managerName}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">
          <tr style="background:#f2f2f7;"><td style="padding:8px 12px;font-weight:600;">Clock In</td><td style="padding:8px 12px;">${clockIn}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Clock Out</td><td style="padding:8px 12px;">${clockOut}</td></tr>
        </table>
        <div style="background:#fbe9e7;border-radius:8px;padding:12px 14px;">
          <p style="font-size:13px;font-weight:600;color:#bf360c;margin:0 0 4px;">Manager's Note:</p>
          <p style="font-size:14px;color:#555;margin:0;">${note}</p>
        </div>
        <p style="font-size:12px;color:#8e8e93;margin:16px 0 0;">Log in to Field Manager Pro to view your full time history.</p>
      </div>
    </div>
  `
}
