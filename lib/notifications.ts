import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  attachments?: { filename: string; content: string }[]
): Promise<void> {
  try {
    await resend.emails.send({
      from: process.env.REPORT_EMAIL_FROM!,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(attachments?.length ? { attachments } : {}),
    })
  } catch (e) {
    console.error('Email send failed:', e)
  }
}

export function welcomeEmailHtml(fullName: string, username: string, password: string, role: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  const roleLabel = role === 'manager' ? 'DM' : role === 'ops_manager' ? 'Ops Manager' : role === 'owner' ? 'Owner' : role === 'sales_director' ? 'Sales Director' : 'Employee'
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

export function expenseSubmittedHtml(submitterName: string, amount: string, category: string, description: string, date: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">New Expense Submitted</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        <p style="font-size:15px;color:#1c1c1e;margin:0 0 16px;"><strong>${submitterName}</strong> has submitted an expense for your review.</p>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;width:110px;">Date</td><td style="padding:5px 0;color:#1c1c1e;">${date}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Category</td><td style="padding:5px 0;color:#1c1c1e;">${category}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Amount</td><td style="padding:5px 0;color:#1c1c1e;font-weight:700;font-size:16px;">$${amount}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Notes</td><td style="padding:5px 0;color:#1c1c1e;">${description || '—'}</td></tr>
          </table>
        </div>
        <a href="${appUrl}/expenses" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Review Expense</a>
      </div>
    </div>
  `
}

export function expenseApprovedHtml(recipientName: string, amount: string, category: string, date: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Expense Approved</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        <div style="background:#e8f5e9;border-radius:10px;padding:14px 18px;margin-bottom:20px;">
          <p style="font-size:16px;font-weight:700;color:#2e7d32;margin:0 0 4px;">Expense Approved</p>
          <p style="font-size:14px;color:#555;margin:0;">Hi ${recipientName}, your expense has been approved.</p>
        </div>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;width:110px;">Date</td><td style="padding:5px 0;color:#1c1c1e;">${date}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Category</td><td style="padding:5px 0;color:#1c1c1e;">${category}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Amount</td><td style="padding:5px 0;color:#1c1c1e;font-weight:700;font-size:16px;">$${amount}</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#8e8e93;margin:0;">You will receive another notification once payment is processed. <a href="${appUrl}/expenses" style="color:#7c3aed;">View in FMP</a></p>
      </div>
    </div>
  `
}

export function expenseRejectedHtml(recipientName: string, amount: string, category: string, date: string, reason: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Expense Not Approved</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        <div style="background:#fbe9e7;border-radius:10px;padding:14px 18px;margin-bottom:20px;">
          <p style="font-size:16px;font-weight:700;color:#bf360c;margin:0 0 4px;">Expense Not Approved</p>
          <p style="font-size:14px;color:#555;margin:0;">Hi ${recipientName}, your expense submission was not approved.</p>
        </div>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;width:110px;">Date</td><td style="padding:5px 0;color:#1c1c1e;">${date}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Category</td><td style="padding:5px 0;color:#1c1c1e;">${category}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Amount</td><td style="padding:5px 0;color:#1c1c1e;font-weight:700;">$${amount}</td></tr>
          </table>
        </div>
        <div style="background:#fff3e0;border-radius:8px;padding:12px 14px;margin-bottom:20px;">
          <p style="font-size:13px;font-weight:600;color:#e65100;margin:0 0 4px;">Reason:</p>
          <p style="font-size:14px;color:#555;margin:0;">${reason}</p>
        </div>
        <a href="${appUrl}/expenses" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View in FMP</a>
      </div>
    </div>
  `
}

export function expensePaidHtml(recipientName: string, amount: string, category: string, date: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Expense Paid</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        <div style="background:#e8f5e9;border-radius:10px;padding:14px 18px;margin-bottom:20px;">
          <p style="font-size:16px;font-weight:700;color:#2e7d32;margin:0 0 4px;">Payment Processed</p>
          <p style="font-size:14px;color:#555;margin:0;">Hi ${recipientName}, your expense reimbursement has been marked as paid.</p>
        </div>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;width:110px;">Date</td><td style="padding:5px 0;color:#1c1c1e;">${date}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Category</td><td style="padding:5px 0;color:#1c1c1e;">${category}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Amount</td><td style="padding:5px 0;color:#1c1c1e;font-weight:700;font-size:16px;">$${amount}</td></tr>
          </table>
        </div>
        <a href="${appUrl}/expenses" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View in FMP</a>
      </div>
    </div>
  `
}


export function taskAssignedHtml(assigneeName: string, assignerName: string, title: string, description: string | null, weekOf: string, dueDate?: string | null): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  const dueLine = dueDate
    ? `<p style="font-size:13px;color:#bf360c;font-weight:600;margin:6px 0 0;">Due: ${new Date(dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>`
    : ''
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">New Task Assigned</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#1c1c1e;margin:0 0 16px;">Hi ${assigneeName}, you have been assigned a new task by <strong>${assignerName}</strong>.</p>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <p style="font-size:16px;font-weight:700;color:#1c1c1e;margin:0 0 6px;">${title}</p>
          ${description ? `<p style="font-size:14px;color:#555;margin:0 0 10px;">${description}</p>` : ''}
          <p style="font-size:13px;color:#8e8e93;margin:0;">Week of ${weekOf}</p>
          ${dueLine}
        </div>
        <a href="${appUrl}/tasks" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View Task</a>
      </div>
    </div>
  `
}

export function passwordResetHtml(fullName: string, resetUrl: string): string {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Password Reset Request</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#1c1c1e;margin:0 0 16px;">Hi ${fullName},</p>
        <p style="font-size:14px;color:#555;margin:0 0 20px;">We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-bottom:20px;">Reset My Password</a>
        <p style="font-size:13px;color:#8e8e93;margin:0;">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
      </div>
    </div>
  `
}

export function overstaffingAlertHtml(dmName: string, storeAddress: string, employeeNames: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#dc2626;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Overstaffing Alert</p>
      </div>
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:16px;font-weight:700;color:#b91c1c;margin:0 0 12px;">Action Required: Too Many Employees Clocked In</p>
        <p style="font-size:14px;color:#555;margin:0 0 6px;">Hi ${dmName},</p>
        <p style="font-size:14px;color:#555;margin:0 0 16px;">Your 1-employee store has had two employees clocked in together for over an hour. One needs to be sent home.</p>
        <div style="background:white;border:1px solid #fca5a5;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <p style="font-size:13px;color:#8e8e93;font-weight:600;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;">Store</p>
          <p style="font-size:15px;font-weight:600;color:#1c1c1e;margin:0 0 12px;">${storeAddress}</p>
          <p style="font-size:13px;color:#8e8e93;font-weight:600;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;">Employees Clocked In</p>
          <p style="font-size:15px;font-weight:600;color:#b91c1c;margin:0;">${employeeNames}</p>
        </div>
        <a href="${appUrl}/timecards" style="display:inline-block;background:#dc2626;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View Timecards</a>
      </div>
    </div>
  `
}

export function timeOffRequestedHtml(approverName: string, requesterName: string, startDate: string, endDate: string, reason: string | null): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  const dateRange = startDate === endDate ? startDate : `${startDate} – ${endDate}`
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Time Off Request</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#1c1c1e;margin:0 0 16px;">Hi ${approverName}, <strong>${requesterName}</strong> has submitted a time off request for your approval.</p>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;width:80px;">Dates</td><td style="padding:5px 0;color:#1c1c1e;font-weight:700;">${dateRange}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Reason</td><td style="padding:5px 0;color:#1c1c1e;">${reason ?? '—'}</td></tr>
          </table>
        </div>
        <a href="${appUrl}/time-off" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Review Request</a>
      </div>
    </div>
  `
}

export function timeOffDecisionHtml(requesterName: string, status: 'approved' | 'denied', startDate: string, endDate: string, notes: string | null): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  const dateRange = startDate === endDate ? startDate : `${startDate} – ${endDate}`
  const isApproved = status === 'approved'
  const headerBg = isApproved ? '#16a34a' : '#b91c1c'
  const badgeBg = isApproved ? '#e8f5e9' : '#fbe9e7'
  const badgeColor = isApproved ? '#2e7d32' : '#bf360c'
  const label = isApproved ? 'Time Off Approved' : 'Time Off Request Denied'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:${headerBg};padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">${label}</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <div style="background:${badgeBg};border-radius:10px;padding:14px 18px;margin-bottom:16px;">
          <p style="font-size:16px;font-weight:700;color:${badgeColor};margin:0 0 4px;">${label}</p>
          <p style="font-size:14px;color:#555;margin:0;">Hi ${requesterName}, your time off request has been ${status}.</p>
        </div>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:${notes ? '16px' : '20px'};">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;width:80px;">Dates</td><td style="padding:5px 0;color:#1c1c1e;font-weight:700;">${dateRange}</td></tr>
            <tr><td style="padding:5px 0;color:#8e8e93;font-weight:600;">Status</td><td style="padding:5px 0;color:${badgeColor};font-weight:700;">${status.charAt(0).toUpperCase() + status.slice(1)}</td></tr>
          </table>
        </div>
        ${notes ? `<div style="background:#fff3e0;border-radius:8px;padding:12px 14px;margin-bottom:20px;"><p style="font-size:13px;font-weight:600;color:#e65100;margin:0 0 4px;">Note:</p><p style="font-size:14px;color:#555;margin:0;">${notes}</p></div>` : ''}
        <a href="${appUrl}/time-off" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View in FMP</a>
      </div>
    </div>
  `
}

export function taskReminderHtml(assigneeName: string, title: string, description: string | null, dueDate: string, assignerName: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#b45309;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Task Reminder</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <div style="background:#fff7ed;border-radius:10px;padding:14px 18px;margin-bottom:16px;">
          <p style="font-size:16px;font-weight:700;color:#92400e;margin:0 0 4px;">⏰ Reminder: Task Pending</p>
          <p style="font-size:14px;color:#555;margin:0;">Hi ${assigneeName}, you have an incomplete task assigned by <strong>${assignerName}</strong>.</p>
        </div>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <p style="font-size:15px;font-weight:600;color:#1c1c1e;margin:0 0 6px;">${title}</p>
          ${description ? `<p style="font-size:14px;color:#555;margin:0 0 8px;">${description}</p>` : ''}
          <p style="font-size:13px;color:#b91c1c;font-weight:600;margin:0;">Due: ${dueDate}</p>
        </div>
        <a href="${appUrl}/tasks" style="display:inline-block;background:#b45309;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Complete Task</a>
      </div>
    </div>
  `
}

export function taskCompletedHtml(assignerName: string, assigneeName: string, title: string, note: string | null, completedAt: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Task Completed</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <div style="background:#e8f5e9;border-radius:10px;padding:14px 18px;margin-bottom:16px;">
          <p style="font-size:16px;font-weight:700;color:#2e7d32;margin:0 0 4px;">Task Completed</p>
          <p style="font-size:14px;color:#555;margin:0;">Hi ${assignerName}, <strong>${assigneeName}</strong> has completed a task you assigned.</p>
        </div>
        <div style="background:#f2f2f7;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
          <p style="font-size:15px;font-weight:600;color:#1c1c1e;margin:0 0 6px;">${title}</p>
          <p style="font-size:13px;color:#8e8e93;margin:0;">Completed ${completedAt}</p>
        </div>
        ${note ? `<div style="background:#fff3e0;border-radius:8px;padding:12px 14px;margin-bottom:20px;"><p style="font-size:13px;font-weight:600;color:#e65100;margin:0 0 4px;">Note:</p><p style="font-size:14px;color:#555;margin:0;">${note}</p></div>` : ''}
        <a href="${appUrl}/tasks" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View Tasks</a>
      </div>
    </div>
  `
}


export function shiftSwapRequestedHtml(targetName: string, requesterName: string, shiftDateLabel: string): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Shift Swap Request</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#1c1c1e;">Hi ${targetName},</p>
        <p style="font-size:14px;color:#555;"><strong>${requesterName}</strong> has requested to swap their <strong>${shiftDateLabel}</strong> shift with one of yours.</p>
        <p style="font-size:14px;color:#555;">Open the app to review the details and accept or decline.</p>
        <a href="${appUrl}/shift-swaps" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-top:8px;">View Swap Request</a>
      </div>
    </div>
  `
}

interface SwapShiftInfo {
  shift_date: string
  start_time: string
  end_time: string
}

interface SwapHoursImpact {
  currentPeriodHours: number
  projectedPeriodHours: number
  weekOtRisk: boolean
  periodOtRisk: boolean
}

export function shiftSwapDmReviewHtml(opts: {
  managerName: string
  requesterName: string
  targetName: string
  requesterShift: SwapShiftInfo
  targetShift: SwapShiftInfo
  requesterImpact: SwapHoursImpact
  targetImpact: SwapHoursImpact
  requesterNote: string | null
  targetNote: string | null
}): string {
  const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

  function fmtDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }
  function fmtTime(t: string) {
    const [h, m] = t.split(':').map(Number)
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }
  function hoursRow(impact: SwapHoursImpact, name: string) {
    const otBadge = (impact.weekOtRisk || impact.periodOtRisk)
      ? `<span style="background:#fee2e2;color:#b91c1c;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;margin-left:6px;">⚠ OT RISK</span>`
      : ''
    const delta = impact.projectedPeriodHours - impact.currentPeriodHours
    const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">${name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;text-align:center;">${impact.currentPeriodHours.toFixed(1)}h</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">
          <strong style="color:${impact.periodOtRisk ? '#dc2626' : '#059669'};">${impact.projectedPeriodHours.toFixed(1)}h</strong>
          <span style="color:#9ca3af;font-size:12px;margin-left:4px;">(${deltaStr}h)</span>
          ${otBadge}
        </td>
      </tr>
    `
  }

  const anyOt = opts.requesterImpact.weekOtRisk || opts.requesterImpact.periodOtRisk || opts.targetImpact.weekOtRisk || opts.targetImpact.periodOtRisk

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Shift Swap — Needs Your Approval</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#1c1c1e;">Hi ${opts.managerName},</p>
        <p style="font-size:14px;color:#555;margin-bottom:20px;"><strong>${opts.requesterName}</strong> and <strong>${opts.targetName}</strong> both agreed to swap shifts and are awaiting your approval.</p>

        ${anyOt ? `<div style="background:#fee2e2;border-radius:8px;padding:12px 16px;margin-bottom:20px;border:1px solid #fca5a5;">
          <p style="margin:0;color:#b91c1c;font-weight:700;font-size:14px;">⚠ Overtime Alert</p>
          <p style="margin:4px 0 0;color:#b91c1c;font-size:13px;">If approved, one or more employees may exceed overtime thresholds (40h/week or 80h/period).</p>
        </div>` : ''}

        <h3 style="color:#374151;font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;">Proposed Swap</h3>
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;font-size:13px;">
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:600;">Employee</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:600;">Gives Up</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:600;">Takes On</th>
          </tr>
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;">${opts.requesterName}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${fmtDate(opts.requesterShift.shift_date)}<br><span style="color:#6b7280;">${fmtTime(opts.requesterShift.start_time)} – ${fmtTime(opts.requesterShift.end_time)}</span></td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${fmtDate(opts.targetShift.shift_date)}<br><span style="color:#6b7280;">${fmtTime(opts.targetShift.start_time)} – ${fmtTime(opts.targetShift.end_time)}</span></td>
          </tr>
          <tr>
            <td style="padding:10px 12px;font-weight:600;color:#111827;">${opts.targetName}</td>
            <td style="padding:10px 12px;color:#374151;">${fmtDate(opts.targetShift.shift_date)}<br><span style="color:#6b7280;">${fmtTime(opts.targetShift.start_time)} – ${fmtTime(opts.targetShift.end_time)}</span></td>
            <td style="padding:10px 12px;color:#374151;">${fmtDate(opts.requesterShift.shift_date)}<br><span style="color:#6b7280;">${fmtTime(opts.requesterShift.start_time)} – ${fmtTime(opts.requesterShift.end_time)}</span></td>
          </tr>
        </table>

        <h3 style="color:#374151;font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;">Pay Period Hours (Scheduled)</h3>
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;font-size:13px;">
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:600;">Employee</th>
            <th style="padding:10px 12px;text-align:center;color:#6b7280;font-weight:600;">Current</th>
            <th style="padding:10px 12px;text-align:center;color:#6b7280;font-weight:600;">If Approved</th>
          </tr>
          ${hoursRow(opts.requesterImpact, opts.requesterName)}
          ${hoursRow(opts.targetImpact, opts.targetName)}
        </table>

        ${opts.requesterNote ? `<div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin-bottom:12px;">
          <p style="margin:0 0 4px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Note from ${opts.requesterName}</p>
          <p style="margin:0;color:#374151;font-size:14px;">${opts.requesterNote}</p>
        </div>` : ''}

        ${opts.targetNote ? `<div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
          <p style="margin:0 0 4px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Note from ${opts.targetName}</p>
          <p style="margin:0;color:#374151;font-size:14px;">${opts.targetNote}</p>
        </div>` : ''}

        <a href="${appUrl}/shift-swaps" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Review in App</a>
      </div>
    </div>
  `
}
