import { escapeHtml, escapeHtmlBr } from '@/lib/escape-html'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

export function levelLabel(level: string): string {
  if (level === 'verbal') return 'Verbal Notice'
  if (level === 'written') return 'Written Notice — 2nd Level'
  return 'Final Written Notice — 3rd Level'
}
export function levelShort(level: string): string {
  if (level === 'verbal') return 'VERBAL'
  if (level === 'written') return 'WRITTEN — 2ND LEVEL'
  return 'FINAL — 3RD LEVEL'
}
export function levelColor(level: string): string {
  if (level === 'verbal') return '#b45309'
  if (level === 'written') return '#c2410c'
  return '#991b1b'
}
export function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function buildFormalDocHtml(params: {
  refNumber: string; level: string; title: string
  subjectName: string; subjectRole: string; authorName: string; authorRole: string
  incidentDate: string; notes: string; expectations: string; docDate: string
  priorConvos?: Array<{ convo_date: string; notes: string }>
  linkedVerbals?: Array<{ ref_number: string; title: string; incident_date: string }>
  ackLink?: string; isRetainedCopy?: boolean; isSdCopy?: boolean
}): string {
  const {
    refNumber, level, title, subjectName, subjectRole, authorName, authorRole,
    incidentDate, notes, expectations, docDate, priorConvos, linkedVerbals, ackLink, isRetainedCopy, isSdCopy,
  } = params
  const authorRoleLabel = authorRole === 'manager' ? 'District Manager' : authorRole === 'sales_director' ? 'Sales Director' : authorRole
  const subjectRoleLabel = subjectRole === 'employee' ? 'Team Member' : subjectRole === 'manager' ? 'District Manager' : subjectRole

  const priorConvosHtml = priorConvos?.length ? `<div style="margin-bottom:24px;"><h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Prior Conversations on Record</h3>${priorConvos.map((c, i) => `<div style="margin-bottom:12px;padding:12px 14px;background:#fefce8;border-left:3px solid #ca8a04;"><p style="font-size:12px;font-weight:bold;color:#92400e;margin:0 0 6px;font-family:'Arial',sans-serif;">Conversation ${i + 1} — ${formatDate(c.convo_date)}</p><p style="font-size:13px;color:#333;margin:0;line-height:1.6;">${escapeHtmlBr(c.notes)}</p></div>`).join('')}</div>` : ''

  const linkedVerbalsHtml = linkedVerbals?.length ? `<div style="margin-bottom:24px;"><h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Related Prior Accountability Records</h3>${linkedVerbals.map(v => `<div style="padding:10px 14px;background:#f8fafc;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:8px;"><p style="font-size:13px;font-weight:bold;color:#0f172a;margin:0;font-family:'Arial',sans-serif;">${v.ref_number} — ${v.title}</p><p style="font-size:12px;color:#94a3b8;margin:3px 0 0;font-family:'Arial',sans-serif;">Date of Incident: ${formatDate(v.incident_date)}</p></div>`).join('')}</div>` : ''

  const finalWarningHtml = level === 'final' ? `<div style="margin-bottom:24px;padding:16px 20px;background:#fef2f2;border:2px solid #dc2626;border-radius:4px;"><p style="font-size:12px;font-weight:bold;color:#991b1b;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-family:'Arial',sans-serif;">⚠ Final Written Notice</p><p style="font-size:13px;color:#7f1d1d;margin:0;line-height:1.7;font-family:'Arial',sans-serif;">This serves as your <strong>third and final written notice</strong>. Failure to correct the issues outlined in this document could result in further disciplinary action, up to and including termination of employment.</p></div>` : ''

  const ackHtml = ackLink ? `<div style="margin-top:30px;padding:20px 24px;background:#f0f4ff;border:2px solid #3b4db8;border-radius:6px;text-align:center;"><p style="font-size:14px;font-weight:bold;color:#1e2a7a;margin:0 0 8px;font-family:'Arial',sans-serif;">Acknowledgment of Receipt Required</p><p style="font-size:12px;color:#374151;margin:0 0 16px;line-height:1.6;font-family:'Arial',sans-serif;">By clicking the button below, you confirm you have received and reviewed this official document.<br><strong>This is not an admission of guilt or agreement with its contents</strong> — it is solely an acknowledgment that you have received it.<br><em>Failure to acknowledge receipt may result in administrative action including restriction from returning to scheduled duties until acknowledgment is completed.</em></p><a href="${ackLink}" style="display:inline-block;background:#1e2a7a;color:#ffffff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold;font-family:'Arial',sans-serif;letter-spacing:0.5px;">Acknowledge Receipt</a><p style="font-size:11px;color:#9ca3af;margin:12px 0 0;font-family:'Arial',sans-serif;">If the button above does not work, copy and paste this link:<br><span style="color:#3b4db8;">${ackLink}</span></p></div>` : ''

  const copyBanner = isRetainedCopy
    ? `<tr><td style="background:#1a3a1a;padding:10px 40px;text-align:center;"><p style="color:#86efac;font-size:11px;font-family:'Arial',sans-serif;letter-spacing:2px;text-transform:uppercase;margin:0;">RETAINED COPY — FOR YOUR RECORDS</p></td></tr>`
    : isSdCopy
    ? `<tr><td style="background:#1a2a3a;padding:10px 40px;text-align:center;"><p style="color:#93c5fd;font-size:11px;font-family:'Arial',sans-serif;letter-spacing:2px;text-transform:uppercase;margin:0;">SALES DIRECTOR COPY — APPROVED &amp; FILED</p></td></tr>`
    : ''

  const safeTitle = escapeHtml(title)
  const safeSubjectName = escapeHtml(subjectName)
  const safeAuthorName = escapeHtml(authorName)

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#e5e7eb;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;"><tr><td align="center"><table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #d1d5db;"><tr><td style="background:#0f172a;padding:28px 40px;text-align:center;"><p style="color:#94a3b8;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px;font-family:'Arial',sans-serif;">FIELD MANAGER PRO</p><h1 style="color:#f1f5f9;font-size:18px;letter-spacing:2px;text-transform:uppercase;margin:0;font-family:'Arial',sans-serif;font-weight:bold;">OFFICIAL EMPLOYEE ACCOUNTABILITY NOTICE</h1></td></tr>${copyBanner}<tr><td style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:14px 40px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-family:'Arial',sans-serif;"><span style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Reference Number</span><br><strong style="font-size:20px;color:#0f172a;letter-spacing:1px;">${refNumber}</strong></td><td align="right"><span style="background:${levelColor(level)};color:#ffffff;padding:6px 14px;font-size:10px;font-weight:bold;font-family:'Arial',sans-serif;letter-spacing:1.5px;text-transform:uppercase;">${levelShort(level)}</span></td></tr></table></td></tr><tr><td style="padding:30px 40px;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;margin-bottom:28px;font-family:'Arial',sans-serif;"><tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;width:170px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Employee</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;"><strong>${safeSubjectName}</strong> <span style="color:#94a3b8;font-size:11px;">(${subjectRoleLabel})</span></td></tr><tr><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Issued By</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${safeAuthorName} <span style="color:#94a3b8;font-size:11px;">(${authorRoleLabel})</span></td></tr><tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Date of Incident</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${formatDate(incidentDate)}</td></tr><tr><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Notice Level</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${levelLabel(level)}</td></tr><tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;">Document Date</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;">${docDate}</td></tr></table><h2 style="font-size:17px;color:#0f172a;margin:0 0 22px;padding-bottom:10px;border-bottom:2px solid #0f172a;font-family:'Arial',sans-serif;">${safeTitle}</h2>${priorConvosHtml}${linkedVerbalsHtml}<div style="margin-bottom:24px;"><h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Summary of Discussion &amp; Documented Events</h3><div style="background:#f8fafc;border-left:4px solid #0f172a;padding:14px 16px;font-size:13px;color:#1e293b;line-height:1.75;font-family:'Georgia',serif;">${escapeHtmlBr(notes)}</div></div><div style="margin-bottom:24px;"><h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Clear Expectations Moving Forward</h3><div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:14px 16px;font-size:13px;color:#14532d;line-height:1.75;font-family:'Georgia',serif;">${escapeHtmlBr(expectations)}</div></div>${finalWarningHtml}${ackHtml}</td></tr><tr><td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:18px 40px;"><p style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;margin:0;line-height:1.7;">This is an official HR document generated by Field Manager Pro on <strong>${docDate}</strong>.<br>Reference: <strong>${refNumber}</strong> &nbsp;|&nbsp; This document is permanently on file and cannot be altered or deleted.<br>Confidential — For authorized personnel only. &copy; ${new Date().getFullYear()} Field Manager Pro.</p></td></tr></table></td></tr></table></body></html>`
}

export function buildTerminationEmailHtml(params: {
  employeeName: string
  orgName: string
  dmName: string
  sdName: string
  reasons: string
  terminationDate: string
  accountabilityDocs: Array<{ ref_number: string; level: string; title: string; incident_date: string }>
  isCopy?: boolean
  copyFor?: string
}): string {
  const { employeeName, orgName, dmName, sdName, reasons, terminationDate, accountabilityDocs, isCopy, copyFor } = params
  const safeEmployeeName = escapeHtml(employeeName)
  const safeOrgName = escapeHtml(orgName)
  const safeDmName = escapeHtml(dmName)
  const safeSdName = escapeHtml(sdName)
  const safeReasons = escapeHtmlBr(reasons)

  const docsHtml = accountabilityDocs.length
    ? accountabilityDocs.map(d => {
        const lbl = d.level === 'verbal' ? 'Verbal Notice' : d.level === 'written' ? 'Written Notice — 2nd Level' : 'Final Written Notice — 3rd Level'
        const clr = d.level === 'verbal' ? '#b45309' : d.level === 'written' ? '#c2410c' : '#991b1b'
        return `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:9px 14px;font-size:12px;font-weight:bold;color:#0f172a;font-family:'Arial',sans-serif;">${d.ref_number}</td><td style="padding:9px 14px;"><span style="background:${clr};color:#fff;font-size:10px;font-weight:bold;padding:2px 8px;font-family:'Arial',sans-serif;">${lbl.toUpperCase()}</span></td><td style="padding:9px 14px;font-size:12px;color:#374151;font-family:'Arial',sans-serif;">${d.title}</td><td style="padding:9px 14px;font-size:11px;color:#94a3b8;font-family:'Arial',sans-serif;">${formatDate(d.incident_date)}</td></tr>`
      }).join('')
    : `<tr><td colspan="4" style="padding:14px;font-size:12px;color:#94a3b8;font-family:'Arial',sans-serif;text-align:center;">No prior accountability documents on file.</td></tr>`

  const copyBanner = isCopy
    ? `<tr><td style="background:#1a2a3a;padding:10px 40px;text-align:center;"><p style="color:#93c5fd;font-size:11px;font-family:'Arial',sans-serif;letter-spacing:2px;text-transform:uppercase;margin:0;">MANAGEMENT COPY — ${(copyFor ?? '').toUpperCase()}</p></td></tr>`
    : ''

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#e5e7eb;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;"><tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #d1d5db;">
<tr><td style="background:#450a0a;padding:28px 40px;text-align:center;">
  <p style="color:#fca5a5;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px;font-family:'Arial',sans-serif;">${safeOrgName}</p>
  <h1 style="color:#ffffff;font-size:18px;letter-spacing:2px;text-transform:uppercase;margin:0;font-family:'Arial',sans-serif;font-weight:bold;">NOTICE OF EMPLOYMENT TERMINATION</h1>
</td></tr>
${copyBanner}
<tr><td style="padding:30px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;margin-bottom:28px;font-family:'Arial',sans-serif;">
    <tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;width:170px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Employee</td><td style="padding:10px 14px;font-size:13px;font-weight:bold;color:#0f172a;border-bottom:1px solid #e2e8f0;">${safeEmployeeName}</td></tr>
    <tr><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Organization</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${safeOrgName}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Effective Date</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${terminationDate}</td></tr>
    <tr><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">District Manager</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${safeDmName}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:10px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-right:1px solid #e2e8f0;">Approved By</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;">${safeSdName}</td></tr>
  </table>

  <p style="font-size:14px;color:#1e293b;line-height:1.8;margin:0 0 24px;font-family:'Arial',sans-serif;">
    Dear <strong>${safeEmployeeName}</strong>,<br><br>
    This letter serves as formal notification that your employment with <strong>${safeOrgName}</strong> has been terminated, effective <strong>${terminationDate}</strong>.
  </p>

  <div style="margin-bottom:28px;">
    <h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Reason(s) for Termination</h3>
    <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:14px 16px;font-size:13px;color:#1e293b;line-height:1.75;font-family:'Georgia',serif;">${escapeHtmlBr(reasons)}</div>
  </div>

  <div style="margin-bottom:28px;">
    <h3 style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Accountability Documentation on File</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;">
      <tr style="background:#f8fafc;"><th style="padding:8px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;text-align:left;font-family:'Arial',sans-serif;">Ref #</th><th style="padding:8px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;text-align:left;font-family:'Arial',sans-serif;">Level</th><th style="padding:8px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;text-align:left;font-family:'Arial',sans-serif;">Document</th><th style="padding:8px 14px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;text-align:left;font-family:'Arial',sans-serif;">Date</th></tr>
      ${docsHtml}
    </table>
  </div>

  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:16px 20px;margin-bottom:24px;">
    <p style="font-size:13px;color:#374151;margin:0;line-height:1.7;font-family:'Arial',sans-serif;">
      Please coordinate with <strong>${safeDmName}</strong> regarding your final paycheck, return of any company property, and any questions about this notice.
      You may retain this email for your records.
    </p>
  </div>

  <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.7;font-family:'Arial',sans-serif;">
    This termination decision was reviewed and approved by <strong>${safeSdName}</strong> on <strong>${terminationDate}</strong>.<br>
    This document is permanently on file and cannot be altered or deleted.
  </p>
</td></tr>
<tr><td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:18px 40px;">
  <p style="font-size:10px;color:#94a3b8;font-family:'Arial',sans-serif;margin:0;line-height:1.7;">
    Official HR document generated by Field Manager Pro on <strong>${terminationDate}</strong>.<br>
    Confidential — For authorized personnel only. &copy; ${new Date().getFullYear()} ${safeOrgName}.
  </p>
</td></tr>
</table></td></tr></table>
</body></html>`
}

export { APP_URL }
