import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType,
} from 'docx'

function fmtDate(iso: string) {
  return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago',
  })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago',
  })
}
function levelLabel(level: string) {
  if (level === 'verbal') return 'Verbal Notice'
  if (level === 'written') return 'Written Notice — 2nd Level'
  return 'Final Written Notice — 3rd Level'
}
function roleLabel(role: string) {
  if (role === 'manager') return 'District Manager'
  if (role === 'sales_director') return 'Sales Director'
  if (role === 'owner') return 'Owner'
  if (role === 'ops_manager') return 'Ops Manager'
  return role
}
function actionLabel(action: string) {
  const map: Record<string, string> = {
    submitted: 'Document Submitted',
    approved: 'Document Approved',
    rejected: 'Document Rejected/Revised',
    emails_sent: 'Emails Sent to Employee & Management',
    pending_approval_notified: 'Approvers Notified',
    'ack-acknowledged': 'Acknowledged by Employee',
    'ack-refused': 'Employee Refused to Acknowledge',
    needs_revision: 'Revision Requested',
    email_reminder: 'Acknowledgment Reminder Sent',
    escalated: 'Escalated to Management',
    conversation_approved: 'Conversation Review Completed',
    force_sent: 'Forced Send (Override)',
  }
  return map[action] ?? action
}

function hr() {
  return new Paragraph({
    border: { bottom: { color: '4B5563', size: 6, style: BorderStyle.SINGLE } },
    spacing: { before: 120, after: 120 },
  })
}

function spacer() {
  return new Paragraph({ text: '', spacing: { before: 60, after: 60 } })
}

function sectionHeader(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, color: '1E1B4B', allCaps: true })],
    spacing: { before: 280, after: 80 },
    border: { bottom: { color: '7C3AED', size: 6, style: BorderStyle.SINGLE } },
  })
}

function labelValue(label: string, value: string) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 20, color: '374151' }),
      new TextRun({ text: value, size: 20, color: '111827' }),
    ],
    spacing: { before: 40, after: 40 },
  })
}

function bodyText(text: string, color = '374151') {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, color })],
    spacing: { before: 40, after: 40 },
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['manager', 'ops_manager', 'sales_director', 'owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: employeeId } = await params
  const orgFilter = await getOrgFilter(session)

  const termRequest = await queryOne<{
    id: string; employee_name: string; employee_email: string; org_id: string
    requested_by_name: string; requested_by_role: string; reasons: string
    approved_by_name: string | null; approved_at: string | null; created_at: string
  }>(`SELECT * FROM termination_requests WHERE employee_id = $1 AND status = 'approved' ORDER BY approved_at DESC LIMIT 1`, [employeeId])

  if (!termRequest) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (orgFilter.filterByOrg && orgFilter.orgId && termRequest.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgName = 'The Organization'

  const docs = await query<{
    id: string; ref_number: string; level: string; title: string; incident_date: string
    notes: string; expectations: string; author_name: string; author_role: string
    status: string; ack_status: string; ack_at: string | null; created_at: string
    audit_trail: Array<{ action: string; actor_name: string | null; notes: string | null; created_at: string }> | null
    prior_convos: Array<{ convo_date: string; notes: string }> | null
  }>(`
    SELECT d.id, d.ref_number, d.level, d.title, d.incident_date::text,
      d.notes, d.expectations, d.author_name, d.author_role,
      d.status, d.ack_status, d.ack_at, d.created_at,
      (SELECT json_agg(json_build_object('action', al.action, 'actor_name', al.actor_name, 'notes', al.notes, 'created_at', al.created_at) ORDER BY al.created_at) FROM accountability_audit_log al WHERE al.doc_id = d.id) AS audit_trail,
      (SELECT json_agg(json_build_object('convo_date', pc.convo_date::text, 'notes', pc.notes) ORDER BY pc.sort_order) FROM accountability_prior_convos pc WHERE pc.doc_id = d.id) AS prior_convos
    FROM accountability_docs d
    WHERE d.subject_id = $1 AND d.status IN ('approved','needs_revision','rejected')
    ORDER BY d.created_at ASC
  `, [employeeId])

  // ── Build DOCX ──────────────────────────────────────────────────────────
  const children: Paragraph[] = []

  // Cover header
  children.push(new Paragraph({
    children: [new TextRun({ text: 'FIELD MANAGER PRO', bold: true, size: 20, color: '7C3AED', allCaps: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: 'EMPLOYEE TERMINATION FILE', bold: true, size: 36, color: '111827', allCaps: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: orgName, size: 22, color: '6B7280' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 240 },
  }))

  // Employee details table
  children.push(sectionHeader('Employee Information'))
  children.push(spacer())
  children.push(labelValue('Full Name', termRequest.employee_name))
  children.push(labelValue('Email', termRequest.employee_email))
  if (termRequest.approved_at) {
    children.push(labelValue('Termination Date', fmtDate(termRequest.approved_at)))
  }
  children.push(labelValue('Approved By', termRequest.approved_by_name ?? '—'))
  children.push(labelValue('Request Submitted By', `${termRequest.requested_by_name} (${roleLabel(termRequest.requested_by_role)})`))
  children.push(labelValue('Request Date', fmtDateTime(termRequest.created_at)))

  // Termination reasons
  children.push(spacer())
  children.push(sectionHeader('Reason(s) for Termination'))
  children.push(spacer())
  for (const line of termRequest.reasons.split('\n')) {
    children.push(bodyText(line || ' ', '1F2937'))
  }

  // Documentation trail
  children.push(spacer())
  children.push(sectionHeader(`Accountability Documentation Trail (${docs.length} Document${docs.length !== 1 ? 's' : ''})`))

  if (docs.length === 0) {
    children.push(spacer())
    children.push(bodyText('No accountability documents on file.', '9CA3AF'))
  } else {
    docs.forEach((doc, idx) => {
      children.push(spacer())

      // Doc number + ref + level badge
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${idx + 1}.  `, bold: true, size: 24, color: '111827' }),
          new TextRun({ text: `${levelLabel(doc.level).toUpperCase()}  `, bold: true, size: 24, color: '7C3AED' }),
          new TextRun({ text: `(${doc.ref_number})`, size: 22, color: '6B7280' }),
        ],
        spacing: { before: 200, after: 60 },
      }))
      children.push(new Paragraph({
        children: [new TextRun({ text: doc.title, bold: true, size: 26, color: '111827' })],
        spacing: { before: 0, after: 80 },
      }))

      children.push(labelValue('Date of Incident', fmtDate(doc.incident_date)))
      children.push(labelValue('Authored By', `${doc.author_name} (${roleLabel(doc.author_role)})`))
      children.push(labelValue('Submitted', fmtDateTime(doc.created_at)))
      if (doc.ack_status === 'acknowledged' && doc.ack_at) {
        children.push(labelValue('Acknowledged by Employee', fmtDateTime(doc.ack_at)))
      } else if (doc.ack_status === 'refused') {
        children.push(labelValue('Acknowledgment', 'Refused by employee'))
      }

      // Prior conversations
      if (doc.prior_convos && doc.prior_convos.length > 0) {
        children.push(spacer())
        children.push(new Paragraph({
          children: [new TextRun({ text: 'Prior Conversations Referenced:', bold: true, size: 20, color: '374151' })],
          spacing: { before: 80, after: 40 },
        }))
        doc.prior_convos.forEach((c, ci) => {
          children.push(new Paragraph({
            children: [
              new TextRun({ text: `   ${ci + 1}. ${fmtDate(c.convo_date)}: `, bold: true, size: 19, color: '6B7280' }),
              new TextRun({ text: c.notes, size: 19, color: '374151' }),
            ],
            spacing: { before: 20, after: 20 },
          }))
        })
      }

      // Notes
      children.push(spacer())
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Incident Notes:', bold: true, size: 20, color: '374151' })],
        spacing: { before: 80, after: 40 },
      }))
      for (const line of doc.notes.split('\n')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `   ${line || ' '}`, size: 19, color: '1F2937' })],
          spacing: { before: 20, after: 20 },
        }))
      }

      // Expectations
      children.push(spacer())
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Expectations Set:', bold: true, size: 20, color: '374151' })],
        spacing: { before: 80, after: 40 },
      }))
      for (const line of doc.expectations.split('\n')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `   ${line || ' '}`, size: 19, color: '1F2937' })],
          spacing: { before: 20, after: 20 },
        }))
      }

      // Audit trail
      if (doc.audit_trail && doc.audit_trail.length > 0) {
        children.push(spacer())
        children.push(new Paragraph({
          children: [new TextRun({ text: 'Audit Trail:', bold: true, size: 20, color: '374151' })],
          spacing: { before: 80, after: 40 },
        }))
        doc.audit_trail.forEach(entry => {
          children.push(new Paragraph({
            children: [
              new TextRun({ text: `   • `, size: 19, color: '7C3AED' }),
              new TextRun({ text: `${actionLabel(entry.action)}`, bold: true, size: 19, color: '374151' }),
              new TextRun({ text: `  —  ${fmtDateTime(entry.created_at)}`, size: 18, color: '6B7280' }),
              ...(entry.actor_name ? [new TextRun({ text: `  by ${entry.actor_name}`, size: 18, color: '6B7280' })] : []),
              ...(entry.notes ? [new TextRun({ text: `\n      Note: ${entry.notes}`, size: 17, color: '9CA3AF' })] : []),
            ],
            spacing: { before: 30, after: 30 },
          }))
        })
      }

      children.push(hr())
    })
  }

  // Footer
  children.push(spacer())
  children.push(new Paragraph({
    children: [new TextRun({
      text: `This document was generated by Field Manager Pro on ${fmtDateTime(new Date().toISOString())} and constitutes an official employment record.`,
      size: 17, color: '9CA3AF', italics: true,
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 0 },
  }))

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 900, right: 900 },
        },
      },
      children,
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const safeFileName = termRequest.employee_name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_')

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="Termination_File_${safeFileName}.docx"`,
      'Content-Length': buffer.byteLength.toString(),
    },
  })
}
