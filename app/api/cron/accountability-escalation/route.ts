import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

let ensured = false
async function ensureColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS ack_subject_reminded_at TIMESTAMPTZ`)
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_status TEXT`)
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_approved_at TIMESTAMPTZ`)
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_reminder_sent_at TIMESTAMPTZ`)
  await query(`ALTER TABLE accountability_docs ADD COLUMN IF NOT EXISTS conversation_escalated_at TIMESTAMPTZ`)
}

export async function GET(_req: NextRequest) {
  const authHeader = _req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try { await ensureColumns() } catch {}

  let escalated = 0
  let ackReminders = 0
  let subjectReminders = 0
  let convoReminders = 0
  let convoEscalations = 0

  try {
    // ── 12-hour voice conversation reminder to DM ────────────────────────────
    // DM hasn't marked voice conversation complete after 12 hours
    const needsConvoReminder = await query<{
      id: string; ref_number: string; level: string; title: string
      subject_name: string; author_id: string; author_name: string
      conversation_approved_at: string
    }>(
      `SELECT id, ref_number, level, title, subject_name, author_id, author_name, conversation_approved_at
       FROM accountability_docs
       WHERE status = 'approved'
         AND conversation_status = 'pending'
         AND conversation_reminder_sent_at IS NULL
         AND conversation_approved_at < NOW() - INTERVAL '12 hours'`
    )

    for (const doc of needsConvoReminder) {
      sendPushToUser(
        doc.author_id,
        'Voice Conversation Required — Reminder',
        `You have 12 hours left to complete the voice conversation with ${doc.subject_name} for ${doc.ref_number}. Mark it complete in Field Manager Pro.`,
        'accountability'
      ).catch(() => {})

      await query(
        `UPDATE accountability_docs SET conversation_reminder_sent_at = NOW() WHERE id = $1`,
        [doc.id]
      )
      await query(
        `INSERT INTO accountability_audit_log (doc_id, action, notes)
         VALUES ($1, 'convo_reminder_sent', '12-hour voice conversation reminder sent to DM')`,
        [doc.id]
      ).catch(() => {})

      convoReminders++
    }

    // ── 24-hour voice conversation escalation to SD ──────────────────────────
    // DM still hasn't marked conversation complete after 24 hours — escalate to SD
    const needsConvoEscalation = await query<{
      id: string; ref_number: string; level: string; title: string
      subject_name: string; author_id: string; author_name: string
      org_id: string; sd_id: string | null; sd_name: string | null
      conversation_approved_at: string
    }>(
      `SELECT id, ref_number, level, title, subject_name, author_id, author_name,
              org_id, sd_id, sd_name, conversation_approved_at
       FROM accountability_docs
       WHERE status = 'approved'
         AND conversation_status = 'pending'
         AND conversation_escalated_at IS NULL
         AND conversation_approved_at < NOW() - INTERVAL '24 hours'`
    )

    for (const doc of needsConvoEscalation) {
      // Push to SD
      if (doc.sd_id) {
        sendPushToUser(
          doc.sd_id,
          'Action Required — Voice Conversation Overdue',
          `${doc.author_name} has not completed the voice conversation for ${doc.ref_number} (${doc.subject_name}). You can force-send the notice from the accountability section.`,
          'accountability'
        ).catch(() => {})
      }

      // Also alert owners
      const owners = await query<{ id: string }>(
        `SELECT id FROM users WHERE org_id = $1 AND role IN ('owner', 'developer') AND is_active = TRUE`,
        [doc.org_id]
      )
      if (owners.length) {
        sendPushToUsers(
          owners.map(o => o.id),
          'Accountability — Voice Conversation Overdue',
          `${doc.author_name} has not completed voice conversation for ${doc.ref_number} after 24 hours. SD has been notified.`,
          'accountability'
        ).catch(() => {})
      }

      await query(
        `UPDATE accountability_docs
         SET conversation_status = 'escalated', conversation_escalated_at = NOW()
         WHERE id = $1`,
        [doc.id]
      )
      await query(
        `INSERT INTO accountability_audit_log (doc_id, action, notes)
         VALUES ($1, 'convo_escalated', '24-hour voice conversation deadline missed — escalated to SD')`,
        [doc.id]
      ).catch(() => {})

      convoEscalations++
    }

    // ── 72-hour approval escalation ─────────────────────────────────────────
    // Docs pending approval for 72+ hours where escalation hasn't been sent
    const overdueApprovals = await query<{
      id: string; ref_number: string; level: string; title: string
      subject_name: string; author_name: string
      org_id: string; sd_id: string | null
      created_at: string
    }>(
      `SELECT id, ref_number, level, title, subject_name, author_name, org_id, sd_id, created_at
       FROM accountability_docs
       WHERE status = 'pending_approval'
         AND escalation_sent_at IS NULL
         AND created_at < NOW() - INTERVAL '72 hours'`
    )

    for (const doc of overdueApprovals) {
      // Find all owners in this org
      const owners = await query<{ id: string; email: string; full_name: string }>(
        `SELECT id, email, full_name FROM users
         WHERE role IN ('owner','developer') AND org_id = $1 AND is_active = TRUE`,
        [doc.org_id]
      )

      const ownerIds = owners.map(o => o.id)
      const ownerEmails = owners.map(o => o.email)

      if (ownerIds.length) {
        sendPushToUsers(ownerIds,
          'Accountability Doc Needs Approval',
          `${doc.ref_number} (${doc.level}) — ${doc.subject_name} — has been pending for over 72 hours. Immediate review required.`,
          'accountability'
        ).catch(() => {})
      }

      const levelLabel = doc.level === 'verbal' ? 'Verbal' : doc.level === 'written' ? 'Written (2nd Level)' : 'Final (3rd Level)'

      for (const email of ownerEmails) {
        sendEmail(
          email,
          `[URGENT] Accountability Doc Awaiting Approval — 72 Hours Exceeded | Ref: ${doc.ref_number}`,
          `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#e5e7eb;font-family:'Arial',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d1d5db;">
<tr><td style="background:#7c2d12;padding:22px 32px;text-align:center;">
  <h1 style="color:#fef3c7;font-size:15px;letter-spacing:1px;text-transform:uppercase;margin:0;">⚠ Urgent — Approval Required</h1>
</td></tr>
<tr><td style="padding:28px 32px;">
  <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
    The following accountability document has been <strong>pending approval for more than 72 hours</strong> and requires your immediate attention:
  </p>
  <table style="width:100%;border:1px solid #e2e8f0;margin-bottom:20px;">
    <tr style="background:#f8fafc;"><td style="padding:9px 13px;font-size:11px;color:#94a3b8;text-transform:uppercase;width:140px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Reference</td><td style="padding:9px 13px;font-size:13px;font-weight:bold;color:#0f172a;border-bottom:1px solid #e2e8f0;">${doc.ref_number}</td></tr>
    <tr><td style="padding:9px 13px;font-size:11px;color:#94a3b8;text-transform:uppercase;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Level</td><td style="padding:9px 13px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${levelLabel}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:9px 13px;font-size:11px;color:#94a3b8;text-transform:uppercase;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Subject</td><td style="padding:9px 13px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${doc.subject_name}</td></tr>
    <tr><td style="padding:9px 13px;font-size:11px;color:#94a3b8;text-transform:uppercase;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Submitted By</td><td style="padding:9px 13px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${doc.author_name}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:9px 13px;font-size:11px;color:#94a3b8;text-transform:uppercase;border-right:1px solid #e2e8f0;">Submitted</td><td style="padding:9px 13px;font-size:13px;color:#0f172a;">${new Date(doc.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })}</td></tr>
  </table>
  <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">Please log in to <a href="${APP_URL}/accountability" style="color:#7c2d12;">Field Manager Pro</a> to review and take action on this document immediately.</p>
  <p style="font-size:11px;color:#9ca3af;margin:0;">This is an automated escalation alert. The Sales Director assigned to this document has had 72 hours to act and has not done so.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`
        ).catch(() => {})
      }

      await query(
        `UPDATE accountability_docs SET escalation_sent_at = NOW() WHERE id = $1`,
        [doc.id]
      )
      await query(
        `INSERT INTO accountability_audit_log (doc_id, action, notes) VALUES ($1, '72hr_escalation_sent', 'Owner alerted — 72 hour SLA exceeded')`,
        [doc.id]
      ).catch(() => {})

      escalated++
    }

    // ── 21-hour subject acknowledgment reminder ─────────────────────────────
    // 3 hours before the 24-hour deadline — push the subject directly
    const needsSubjectReminder = await query<{
      id: string; ref_number: string; level: string; title: string
      subject_id: string; subject_name: string; author_name: string
      approved_at: string
    }>(
      `SELECT id, ref_number, level, title, subject_id, subject_name, author_name, approved_at
       FROM accountability_docs
       WHERE status = 'approved'
         AND ack_status = 'pending'
         AND ack_subject_reminded_at IS NULL
         AND approved_at < NOW() - INTERVAL '21 hours'`
    )

    for (const doc of needsSubjectReminder) {
      const levelLabel = doc.level === 'verbal' ? 'Verbal Notice'
        : doc.level === 'written' ? 'Written Notice (2nd Level)' : 'Final Written Notice (3rd Level)'

      sendPushToUser(
        doc.subject_id,
        'Action Required — Acknowledge Your Notice',
        `You have 3 hours left to acknowledge your ${levelLabel} (${doc.ref_number}). Open Field Manager Pro now.`,
        'accountability'
      ).catch(() => {})

      await query(
        `UPDATE accountability_docs SET ack_subject_reminded_at = NOW() WHERE id = $1`,
        [doc.id]
      )
      await query(
        `INSERT INTO accountability_audit_log (doc_id, action, notes)
         VALUES ($1, 'ack_subject_reminder_sent', '21-hour reminder push sent to subject — 3 hours remaining to acknowledge')`,
        [doc.id]
      ).catch(() => {})

      subjectReminders++
    }

    // ── 24-hour acknowledgment reminder ────────────────────────────────────
    // Approved docs where subject hasn't acknowledged within 24 hours
    const unacknowledged = await query<{
      id: string; ref_number: string; level: string; title: string
      subject_name: string; author_id: string; author_name: string
      author_email: string; sd_id: string | null; sd_name: string | null
      approved_at: string
    }>(
      `SELECT id, ref_number, level, title, subject_name, author_id, author_name,
              author_email, sd_id, sd_name, approved_at
       FROM accountability_docs
       WHERE status = 'approved'
         AND ack_status = 'pending'
         AND ack_reminded_at IS NULL
         AND approved_at < NOW() - INTERVAL '24 hours'`
    )

    for (const doc of unacknowledged) {
      // Push + email author (DM/SD) that subject hasn't acknowledged
      sendPushToUser(
        doc.author_id,
        'Acknowledgment Overdue',
        `${doc.subject_name} has not acknowledged ${doc.ref_number} after 24 hours. Action may be required.`,
        'accountability'
      ).catch(() => {})

      sendEmail(
        doc.author_email,
        `[ACTION MAY BE REQUIRED] ${doc.subject_name} Has Not Acknowledged ${doc.ref_number}`,
        `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#e5e7eb;font-family:'Arial',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d1d5db;">
<tr><td style="background:#1e3a5f;padding:22px 32px;text-align:center;">
  <h1 style="color:#bfdbfe;font-size:15px;letter-spacing:1px;text-transform:uppercase;margin:0;">Acknowledgment Overdue — Action May Be Required</h1>
</td></tr>
<tr><td style="padding:28px 32px;">
  <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
    <strong>${doc.subject_name}</strong> has not acknowledged receipt of accountability document <strong>${doc.ref_number}</strong> within the required 24-hour window.
  </p>
  <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.6;">
    Per company policy, failure to acknowledge may restrict the employee from returning to scheduled duties. Please follow up directly with ${doc.subject_name} and document any refusal accordingly.
  </p>
  <div style="background:#fef9c3;border-left:4px solid #ca8a04;padding:12px 16px;margin-bottom:20px;">
    <p style="font-size:13px;color:#92400e;margin:0;line-height:1.6;">
      <strong>Note:</strong> If the employee refuses to acknowledge, they are to be informed that they may not return to scheduled work duties until the acknowledgment is completed. Document this interaction and contact your Sales Director.
    </p>
  </div>
  <p style="font-size:12px;color:#9ca3af;margin:0;">Document: ${doc.ref_number} | Approved: ${new Date(doc.approved_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })}</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`
      ).catch(() => {})

      // Also notify SD if assigned
      if (doc.sd_id) {
        sendPushToUser(
          doc.sd_id,
          'Acknowledgment Overdue',
          `${doc.subject_name} has not acknowledged ${doc.ref_number} — DM ${doc.author_name} has been notified.`,
          'accountability'
        ).catch(() => {})
      }

      await query(
        `UPDATE accountability_docs SET ack_reminded_at = NOW() WHERE id = $1`,
        [doc.id]
      )
      await query(
        `INSERT INTO accountability_audit_log (doc_id, action, notes) VALUES ($1, 'ack_reminder_sent', '24-hour reminder sent to author and SD')`,
        [doc.id]
      ).catch(() => {})

      ackReminders++
    }

  } catch (e) {
    console.error('accountability-escalation cron error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, escalated, subjectReminders, ackReminders, convoReminders, convoEscalations })
}
