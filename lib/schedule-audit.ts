import { query } from './db'

export async function logScheduleChange(params: {
  action: 'create' | 'update' | 'delete' | 'publish' | 'unpublish'
  performedBy: string
  performedByName: string
  employeeId?: string | null
  employeeName?: string | null
  storeLocationId?: string | null
  storeAddress?: string | null
  shiftDate?: string | null
  oldStartTime?: string | null
  oldEndTime?: string | null
  newStartTime?: string | null
  newEndTime?: string | null
  oldBreakMinutes?: number | null
  newBreakMinutes?: number | null
  metadata?: Record<string, unknown> | null
}) {
  await query(`
    INSERT INTO schedule_audit_log (
      action, performed_by, performed_by_name,
      employee_id, employee_name, store_location_id, store_address,
      shift_date, old_start_time, old_end_time, new_start_time, new_end_time,
      old_break_minutes, new_break_minutes, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    params.action, params.performedBy, params.performedByName,
    params.employeeId ?? null, params.employeeName ?? null,
    params.storeLocationId ?? null, params.storeAddress ?? null,
    params.shiftDate ?? null,
    params.oldStartTime ?? null, params.oldEndTime ?? null,
    params.newStartTime ?? null, params.newEndTime ?? null,
    params.oldBreakMinutes ?? null, params.newBreakMinutes ?? null,
    params.metadata ? JSON.stringify(params.metadata) : null,
  ]).catch(err => console.error('Schedule audit log error:', err))
}
