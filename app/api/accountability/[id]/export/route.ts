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

const VIEWER_ROLES = ['manager', 'sales_director', 'owner', 'ops_manager', 'developer']

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VIEWER_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const orgFilter = await getOrgFilter(session)

  const doc = await queryOne<{
    id: string; ref_number: string; org_id: string
    subject_name: string; subject_role: string
    author_id: string; author_name: string; author_role: string
    level: string; title: string; incident_date: string; notes: string; expectations: string
    status: string; sd_id: string | null; sd_name: string | null
    approver_name: string | null; approved_at: string | null
    ack_status: string; ack_at: string | null
    created_at: string
  }>('SELECT * FROM accountability_docs WHERE id = $1', [id])

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (orgFilter.filterByOrg && orgFilter.orgId && doc.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (session.role === 'manager' && doc.author_id !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const priorConvos = await query<{ convo_date: string; notes: string }>(
    'SELECT convo_date::text, notes FROM accountability_prior_convos WHERE doc_id = $1 ORDER BY sort_order, convo_date', [id]
  )

  // Build Word document
  const sections: (Paragraph | Table)[] = []

  // Header
  sections.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
      new TextRun({ text: 'FIELD MANAGER PRO', bold: true, size: 28, color: '7C3AED' }),
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
      new TextRun({ text: 'ACCOUNTABILITY DOCUMENT', bold: true, size: 24 }),
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [
      new TextRun({ text: levelLabel(doc.level).toUpperCase(), bold: true, size: 22, color: doc.level === 'final' ? 'DC2626' : doc.level === 'written' ? 'D97706' : '6B7280' }),
    ]}),
  )

  // Info table
  const infoRows = [
    ['Reference Number', doc.ref_number],
    ['Employee', doc.subject_name],
    ['Issued By', doc.author_name],
    ['Date of Incident', fmtDate(doc.incident_date)],
    ['Date Filed', fmtDateTime(doc.created_at)],
    ...(doc.sd_name ? [['Sales Director', doc.sd_name]] : []),
    ...(doc.approved_at ? [['Approved', fmtDateTime(doc.approved_at) + (doc.approver_name ? ` by ${doc.approver_name}` : '')]] : []),
    ...(doc.ack_at ? [['Acknowledged by Employee', fmtDateTime(doc.ack_at)]] : []),
    ['Status', doc.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
  ]

  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: infoRows.map(([label, value]) =>
        new TableRow({ children: [
          new TableCell({
            width: { size: 35, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: 'F3F4F6' },
            children: [new Paragraph({ spacing: { before: 60, after: 60 }, children: [
              new TextRun({ text: label, bold: true, size: 20 }),
            ]})],
          }),
          new TableCell({
            width: { size: 65, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ spacing: { before: 60, after: 60 }, children: [
              new TextRun({ text: value, size: 20 }),
            ]})],
          }),
        ]}),
      ),
    }),
  )

  sections.push(new Paragraph({ spacing: { before: 300 } }))

  // Document Title
  sections.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 }, children: [
      new TextRun({ text: 'Document Title', bold: true, size: 22 }),
    ]}),
    new Paragraph({ spacing: { after: 200 }, children: [
      new TextRun({ text: doc.title, size: 22 }),
    ]}),
  )

  // Prior conversations
  if (priorConvos.length > 0) {
    sections.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 }, children: [
        new TextRun({ text: 'Prior Conversations on Record', bold: true, size: 22 }),
      ]}),
    )
    for (let i = 0; i < priorConvos.length; i++) {
      sections.push(
        new Paragraph({ spacing: { before: 100, after: 50 }, children: [
          new TextRun({ text: `Conversation ${i + 1} — ${fmtDate(priorConvos[i].convo_date)}`, bold: true, size: 20, italics: true }),
        ]}),
        new Paragraph({ spacing: { after: 100 }, children: [
          new TextRun({ text: priorConvos[i].notes, size: 20 }),
        ]}),
      )
    }
  }

  // Summary of Discussion
  sections.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 }, children: [
      new TextRun({ text: 'Summary of Discussion', bold: true, size: 22 }),
    ]}),
    new Paragraph({ spacing: { after: 200 }, border: { left: { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF' } }, indent: { left: 200 }, children: [
      new TextRun({ text: doc.notes, size: 20 }),
    ]}),
  )

  // Expectations
  sections.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 }, children: [
      new TextRun({ text: 'Clear Expectations Moving Forward', bold: true, size: 22 }),
    ]}),
    new Paragraph({ spacing: { after: 200 }, border: { left: { style: BorderStyle.SINGLE, size: 6, color: '22C55E' } }, indent: { left: 200 }, children: [
      new TextRun({ text: doc.expectations, size: 20 }),
    ]}),
  )

  // Final warning callout
  if (doc.level === 'final') {
    sections.push(
      new Paragraph({ spacing: { before: 300, after: 200 }, shading: { type: ShadingType.SOLID, color: 'FEF2F2' }, children: [
        new TextRun({ text: '⚠ FINAL WRITTEN NOTICE — ', bold: true, size: 20, color: 'DC2626' }),
        new TextRun({ text: 'This is the third and final written notice. Failure to correct may result in further action up to and including termination.', size: 20, color: 'DC2626' }),
      ]}),
    )
  }

  // Signature lines
  sections.push(
    new Paragraph({ spacing: { before: 600 } }),
    new Paragraph({ spacing: { after: 50 }, children: [
      new TextRun({ text: '________________________________________', size: 20 }),
    ]}),
    new Paragraph({ spacing: { after: 300 }, children: [
      new TextRun({ text: `${doc.subject_name} — Employee Signature / Date`, size: 18, color: '6B7280' }),
    ]}),
    new Paragraph({ spacing: { after: 50 }, children: [
      new TextRun({ text: '________________________________________', size: 20 }),
    ]}),
    new Paragraph({ spacing: { after: 300 }, children: [
      new TextRun({ text: `${doc.author_name} — Manager Signature / Date`, size: 18, color: '6B7280' }),
    ]}),
  )

  const wordDoc = new Document({
    sections: [{ children: sections }],
  })

  const buffer = await Packer.toBuffer(wordDoc)
  const filename = `${doc.ref_number}_${doc.subject_name.replace(/\s+/g, '_')}_${doc.level}.docx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
