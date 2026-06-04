import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

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

  // Fetch the termination request
  const termRequest = await queryOne<{
    id: string; employee_id: string; employee_name: string; employee_email: string
    org_id: string; requested_by: string; requested_by_name: string; requested_by_role: string
    reasons: string; status: string; approved_by: string | null; approved_by_name: string | null
    approved_at: string | null; created_at: string; email_sent_at: string | null
  }>(
    `SELECT * FROM termination_requests WHERE employee_id = $1 AND status = 'approved' ORDER BY approved_at DESC LIMIT 1`,
    [employeeId]
  )

  if (!termRequest) return NextResponse.json({ error: 'Terminated employee not found' }, { status: 404 })

  // Org scoping check
  if (orgFilter.filterByOrg && orgFilter.orgId && termRequest.org_id !== orgFilter.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch all accountability docs for this employee (oldest first — timeline order)
  const docs = await query<{
    id: string; ref_number: string; level: string; title: string
    incident_date: string; notes: string; expectations: string
    author_name: string; author_role: string; status: string
    ack_status: string; ack_at: string | null; approved_at: string | null
    approver_name: string | null; created_at: string
    audit_trail: Array<{ action: string; actor_name: string | null; notes: string | null; created_at: string }> | null
    prior_convos: Array<{ convo_date: string; notes: string }> | null
  }>(`
    SELECT
      d.id, d.ref_number, d.level, d.title, d.incident_date::text,
      d.notes, d.expectations, d.author_name, d.author_role,
      d.status, d.ack_status, d.ack_at, d.approved_at, d.approver_name,
      d.created_at,
      (
        SELECT json_agg(
          json_build_object(
            'action', al.action,
            'actor_name', al.actor_name,
            'notes', al.notes,
            'created_at', al.created_at
          ) ORDER BY al.created_at
        )
        FROM accountability_audit_log al WHERE al.doc_id = d.id
      ) AS audit_trail,
      (
        SELECT json_agg(
          json_build_object('convo_date', pc.convo_date::text, 'notes', pc.notes)
          ORDER BY pc.sort_order
        )
        FROM accountability_prior_convos pc WHERE pc.doc_id = d.id
      ) AS prior_convos
    FROM accountability_docs d
    WHERE d.subject_id = $1
      AND d.status IN ('approved', 'needs_revision', 'rejected')
    ORDER BY d.created_at ASC
  `, [employeeId])

  return NextResponse.json({ termRequest, docs })
}
