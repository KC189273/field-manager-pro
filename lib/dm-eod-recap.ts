import Anthropic from '@anthropic-ai/sdk'
import ExcelJS from 'exceljs'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { computeStops, matchStopsToStores, type GpsStop, type StoreLocation } from '@/lib/gps'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

interface ShiftData {
  clock_in_at: string
  clock_out_at: string
  clock_in_address: string | null
  clock_out_address: string | null
  break_minutes: number
}

interface VisitRow {
  store_address: string
  visit_type: string
  submitted_at: string
  intentionality: string | null
  quick_interaction_notes: string | null
  quick_takeaways: string | null
  quick_impact: string | null
  assigned_rdm: string | null
}

interface TaskRow {
  title: string
  assignee_name: string | null
  store_address: string | null
  completed: boolean
  created_or_completed: string
}

interface AccDoc {
  ref_number: string
  level: string
  subject_name: string
  title: string
  status: string
}

interface ChecklistRow {
  checklist_type: string
  store_address: string
  submitted_by_name: string
  submitted_at: string
}

interface CoachingRow {
  employee_name: string
  store_address: string
  obs_primary_issue: string | null
  rp_score: string | null
  submitted_at: string
}

/**
 * Generate and send an AI-powered end-of-day recap for a DM.
 * Fires on clock-out. Non-fatal — errors are logged, not thrown.
 * Set testMode to inject mock visits for previewing.
 */
export async function sendDmEodRecap(params: {
  dmId: string
  dmName: string
  dmEmail: string
  orgId: string
  shiftId: string
  mockVisits?: VisitRow[]
  mockCoaching?: CoachingRow[]
  mockTasks?: TaskRow[]
}) {
  const { dmId, dmName, dmEmail, orgId, shiftId } = params

  try {
    // ── Gather all data for today (CST midnight to now) ───────────────────
    const todayStart = getTodayMidnightCST()

    // 1. Shift info
    const shift = await queryOne<ShiftData>(`
      SELECT clock_in_at, clock_out_at, clock_in_address, clock_out_address,
             COALESCE(EXTRACT(EPOCH FROM (
               SELECT SUM(break_end - break_start) FROM shift_breaks
               WHERE shift_id = s.id AND break_end IS NOT NULL
             )) / 60, 0)::int AS break_minutes
      FROM shifts s WHERE id = $1
    `, [shiftId])

    if (!shift) return

    const clockIn = new Date(shift.clock_in_at)
    const clockOut = new Date(shift.clock_out_at)
    const grossMinutes = (clockOut.getTime() - clockIn.getTime()) / 60000
    const netMinutes = Math.max(0, grossMinutes - shift.break_minutes)
    const hoursWorked = (netMinutes / 60).toFixed(1)

    // 2. Store visits today
    const dbVisits = await query<VisitRow>(`
      SELECT store_address, COALESCE(visit_type, 'normal') AS visit_type,
             submitted_at::text, intentionality, quick_interaction_notes, quick_takeaways, quick_impact, assigned_rdm
      FROM dm_store_visits
      WHERE submitted_by_id = $1 AND submitted_at >= $2
      ORDER BY submitted_at
    `, [dmId, todayStart])
    const visits = params.mockVisits && params.mockVisits.length > 0 ? params.mockVisits : dbVisits

    // 3. Tasks created or completed by DM today
    const tasksCreated = await query<TaskRow>(`
      SELECT t.title, u.full_name AS assignee_name, t.store_address, false AS completed, t.created_at::text AS created_or_completed
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.created_by = $1 AND t.created_at >= $2
      ORDER BY t.created_at
    `, [dmId, todayStart])

    const tasksCompleted = await query<TaskRow>(`
      SELECT t.title, u.full_name AS assignee_name, t.store_address, true AS completed, tc.completed_at::text AS created_or_completed
      FROM task_completions tc
      JOIN tasks t ON t.id = tc.task_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE tc.completed_by = $1 AND tc.completed_at >= $2
      ORDER BY tc.completed_at
    `, [dmId, todayStart])

    const dbAllTasks = [...tasksCreated, ...tasksCompleted]
    const allTasks = params.mockTasks && params.mockTasks.length > 0 ? params.mockTasks : dbAllTasks

    // 4. Accountability docs authored today
    const accDocs = await query<AccDoc>(`
      SELECT ref_number, level, subject_name, title, status
      FROM accountability_docs
      WHERE author_id = $1 AND created_at >= $2
      ORDER BY created_at
    `, [dmId, todayStart])

    // 5. Checklist submissions from DM's employees today
    const checklists = await query<ChecklistRow>(`
      SELECT checklist_type, store_address, submitted_by_name, submitted_at::text
      FROM checklist_submissions
      WHERE dm_id = $1 AND submitted_at >= $2
      ORDER BY submitted_at
    `, [dmId, todayStart])

    // 6. Coaching sessions today
    const dbCoaching = await query<CoachingRow>(`
      SELECT employee_name, store_address, obs_primary_issue, rp_score, submitted_at::text
      FROM dm_coaching_checklists
      WHERE submitted_by_id = $1 AND submitted_at >= $2
      ORDER BY submitted_at
    `, [dmId, todayStart])
    const coaching = params.mockCoaching && params.mockCoaching.length > 0 ? params.mockCoaching : dbCoaching

    // 7. GPS store visits — compute from breadcrumbs
    let storeVisits: Array<{ store_name: string; arrived: string; departed: string | null; minutes: number }> = []
    try {
      const breadcrumbs = await query<{ shift_id: string; lat: number; lng: number; recorded_at: string }>(
        `SELECT shift_id, lat, lng, recorded_at::text
         FROM gps_breadcrumbs
         WHERE shift_id = $1 AND lat IS NOT NULL AND is_gap = false
         ORDER BY recorded_at ASC`,
        [shiftId]
      )

      if (breadcrumbs.length > 1) {
        const dmStores = await query<StoreLocation>(
          `SELECT DISTINCT dsl.id, dsl.address, dsl.lat::float, dsl.lng::float
           FROM dm_store_locations dsl
           JOIN dm_manager_stores dms ON dms.store_location_id = dsl.id
           WHERE dms.manager_id = $1 AND dsl.lat IS NOT NULL AND dsl.lng IS NOT NULL`,
          [dmId]
        )

        const rawStops = computeStops(breadcrumbs)
        const matched = matchStopsToStores(rawStops, dmStores)

        storeVisits = matched
          .filter(s => s.store_name)
          .map(s => {
            const arrivedTime = new Date(s.arrived_at)
            const departedTime = s.departed_at ? new Date(s.departed_at) : clockOut
            const minutes = Math.round((departedTime.getTime() - arrivedTime.getTime()) / 60000)
            return {
              store_name: s.store_name!,
              arrived: arrivedTime.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }),
              departed: s.departed_at
                ? departedTime.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
                : null,
              minutes,
            }
          })
      }
    } catch (err) {
      console.error('EOD recap GPS error:', err)
    }

    // ── Build context for Claude ──────────────────────────────────────────
    const clockInTime = clockIn.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
    const clockOutTime = clockOut.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
    const todayDate = clockOut.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const dataContext = `
DM: ${dmName}
Date: ${todayDate}
Clock In: ${clockInTime}${shift.clock_in_address ? ` at ${shift.clock_in_address}` : ''}
Clock Out: ${clockOutTime}${shift.clock_out_address ? ` at ${shift.clock_out_address}` : ''}
Hours Worked: ${hoursWorked} hours (${shift.break_minutes > 0 ? `${shift.break_minutes} min break taken` : 'no breaks taken'})

STORE VISITS (${visits.length} total):
${visits.length === 0 ? 'No store visits submitted today.' : visits.map((v, i) => {
  const time = new Date(v.submitted_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
  const type = v.visit_type === 'quick_coaching' ? 'Quick Visit w/ Coaching' : v.visit_type === 'quick' ? 'Quick Visit' : 'Full Visit'
  return `${i + 1}. ${v.store_address} — ${type} at ${time}${v.assigned_rdm ? ` (RDM: ${v.assigned_rdm})` : ''}
   ${v.intentionality ? `Intentionality: ${v.intentionality}` : ''}
   ${v.quick_takeaways ? `Takeaways: ${v.quick_takeaways}` : ''}
   ${v.quick_impact ? `Impact: ${v.quick_impact}` : ''}`
}).join('\n')}

TASKS (${allTasks.length} total — ${allTasks.filter(t => !t.completed).length} assigned, ${allTasks.filter(t => t.completed).length} completed):
${allTasks.length === 0 ? 'No tasks created or completed today.' : allTasks.map(t => {
  return `- ${t.completed ? 'COMPLETED' : 'ASSIGNED'}: "${t.title}"${t.assignee_name ? ` → ${t.assignee_name}` : ''}${t.store_address ? ` (${t.store_address})` : ''}`
}).join('\n')}

ACCOUNTABILITY DOCUMENTS (${accDocs.length} total):
${accDocs.length === 0 ? 'No accountability documents submitted today.' : accDocs.map(d => {
  return `- ${d.level.toUpperCase()} — "${d.title}" for ${d.subject_name} (${d.status})`
}).join('\n')}

EMPLOYEE CHECKLISTS (${checklists.length} submitted by team):
${checklists.length === 0 ? 'No checklists submitted by employees today.' : (() => {
  const opening = checklists.filter(c => c.checklist_type === 'opening')
  const closing = checklists.filter(c => c.checklist_type === 'closing')
  return `Opening: ${opening.length} | Closing: ${closing.length}\n${checklists.map(c => {
    const time = new Date(c.submitted_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
    return `- ${c.checklist_type.charAt(0).toUpperCase() + c.checklist_type.slice(1)}: ${c.submitted_by_name} at ${c.store_address} (${time})`
  }).join('\n')}`
})()}

COACHING SESSIONS (${coaching.length} total):
${coaching.length === 0 ? 'No coaching sessions recorded today.' : coaching.map(c => {
  return `- ${c.employee_name} at ${c.store_address}${c.rp_score ? ` — Role Play: ${c.rp_score}` : ''}${c.obs_primary_issue ? ` — Issue: ${c.obs_primary_issue}` : ''}`
}).join('\n')}

GPS STORE VISITS (${storeVisits.length} detected via GPS):
${storeVisits.length === 0 ? 'No store visits detected via GPS tracking.' : storeVisits.map((sv, i) => {
  const h = Math.floor(sv.minutes / 60)
  const m = sv.minutes % 60
  const duration = h > 0 ? `${h}h ${m}m` : `${m}m`
  return `${i + 1}. ${sv.store_name} — Arrived: ${sv.arrived}, Left: ${sv.departed ?? 'Still there'}, Time at store: ${duration}`
}).join('\n')}
`.trim()

    // ── Call Claude to generate the recap ──────────────────────────────────
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are writing a professional end-of-day recap email for a wireless retail District Manager. Write a concise, well-structured summary of their day based on the data below. The email should flow chronologically through their day.

Rules:
- Start with a one-line summary: hours worked, total visits, and key highlights
- Walk through the day chronologically: clock-in → store visits → coaching → tasks → accountability → clock-out
- Skip sections where nothing happened (don't say "no visits were made" — just omit it)
- Highlight standout items: coaching sessions, accountability docs, any patterns
- Keep it factual and professional — no motivational fluff
- Use plain text formatting, no markdown. Use line breaks for readability
- Keep it under 300 words
- End with a brief "Tomorrow's Focus" suggestion based on what you see in the data (e.g., if no coaching was done, suggest it)

DATA:
${dataContext}`
      }]
    })

    const recapText = response.content[0].type === 'text' ? response.content[0].text : ''
    if (!recapText) {
      console.error(`EOD recap: Claude returned empty text for ${dmName} (shift ${shiftId})`)
      return
    }

    // ── Extract Tomorrow's Focus and send directly to the DM ────────────
    const focusMatch = recapText.match(/Tomorrow['']?s\s+Focus[:\s]*\n?([\s\S]*?)$/i)
    if (focusMatch) {
      const focusText = focusMatch[1].trim()
      if (focusText) {
        const focusHtml = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:500px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#0891b2,#0e7490);padding:24px;border-radius:12px 12px 0 0">
            <h1 style="color:white;margin:0;font-size:20px;font-weight:700">Tomorrow's Focus</h1>
            <p style="color:#cffafe;margin:6px 0 0;font-size:13px">${dmName} — ${todayDate}</p>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;background:white;padding:24px 20px">
            <p style="margin:0 0 16px;font-size:14px;color:#374151;font-weight:600">Hey ${dmName.split(' ')[0]}, here's what to focus on tomorrow:</p>
            ${focusText.split('\n').filter(l => l.trim()).map(line =>
              `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#374151">${line.trim()}</p>`
            ).join('')}
            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f3f4f6">
              <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center">
                Generated by Field Manager Pro &middot; <a href="https://fieldmanagerpro.app" style="color:#0891b2">fieldmanagerpro.app</a>
              </p>
            </div>
          </div>
        </div>`
        // Send to the DM
        sendEmail(dmEmail, `Tomorrow's Focus — ${dmName}`, focusHtml).catch(err => {
          console.error('DM focus email failed:', err)
        })

        // CC leadership who opted in to DM focus emails
        const focusCc = await query<{ email: string }>(
          `SELECT u.email FROM users u
           JOIN notification_preferences np ON np.user_id = u.id
           WHERE u.org_id = $1 AND u.is_active = TRUE
             AND u.role IN ('ops_manager', 'owner', 'sales_director', 'developer')
             AND np.dm_focus_emails = TRUE
             AND COALESCE(np.email_enabled, TRUE) = TRUE`,
          [orgId]
        )
        if (focusCc.length > 0) {
          sendEmail(
            focusCc.map(r => r.email),
            `[DM Focus] Tomorrow's Focus — ${dmName}`,
            focusHtml
          ).catch(err => {
            console.error('DM focus CC email failed:', err)
          })
        }
      }
    }

    // ── Build and send the recap to leadership ──────────────────────────
    const recapHtml = buildRecapEmailHtml({
      dmName,
      todayDate,
      hoursWorked,
      clockInTime,
      clockOutTime,
      visitCount: visits.length,
      tasksAssigned: allTasks.filter(t => !t.completed).length,
      tasksCompleted: allTasks.filter(t => t.completed).length,
      accDocsCount: accDocs.length,
      coachingCount: coaching.length,
      checklistCount: checklists.length,
      recapText,
      storeVisits,
    })

    // Get recipients: SD (manager), owner, developer — respecting email preferences
    const recipients = await query<{ email: string; full_name: string }>(
      `SELECT u.email, u.full_name FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.org_id = $1 AND u.is_active = TRUE
         AND (
           u.id = (SELECT manager_id FROM users WHERE id = $2)
           OR u.role IN ('owner', 'developer')
         )
         AND COALESCE(np.email_enabled, true) = true
         AND COALESCE(np.eod_recap, true) = true`,
      [orgId, dmId]
    )

    const toEmails = recipients.map(r => r.email)
    if (toEmails.length === 0) {
      console.error(`EOD recap: No recipients for ${dmName} in org ${orgId}`)
      return
    }
    console.log(`EOD recap: Sending for ${dmName} to ${toEmails.join(', ')}`)

    // Build Excel attachment with visit details
    const attachments: { filename: string; content: string }[] = []
    if (visits.length > 0) {
      const xlBuffer = await buildVisitsExcel(visits, dmName, todayDate)
      attachments.push({
        filename: `${dmName.replace(/\s+/g, '_')}_Visits_${todayDate.replace(/,?\s+/g, '_')}.xlsx`,
        content: xlBuffer.toString('base64'),
      })
    }

    await sendEmail(
      toEmails,
      `EOD Recap — ${dmName} — ${todayDate}`,
      recapHtml,
      attachments.length > 0 ? attachments : undefined
    )
  } catch (err) {
    console.error('DM EOD Recap error:', err)
  }
}

function getTodayMidnightCST(): string {
  const now = new Date()
  // Get today's date in Central Time (handles CST/CDT automatically)
  const cstDate = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) // YYYY-MM-DD
  // Find the UTC offset for midnight Central Time today
  const midnightCentral = new Date(`${cstDate}T00:00:00`)
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' })
  const parts = formatter.formatToParts(midnightCentral)
  const offset = parts.find(p => p.type === 'timeZoneName')?.value ?? '-06:00'
  // Convert "GMT-5" format to "-05:00"
  const match = offset.match(/GMT([+-]\d+)/)
  const tzOffset = match ? `${match[1].padStart(3, '0')}:00` : '-06:00'
  return `${cstDate}T00:00:00${tzOffset}`
}

function buildRecapEmailHtml(params: {
  dmName: string
  todayDate: string
  hoursWorked: string
  clockInTime: string
  clockOutTime: string
  visitCount: number
  tasksAssigned: number
  tasksCompleted: number
  accDocsCount: number
  coachingCount: number
  checklistCount: number
  recapText: string
  storeVisits: Array<{ store_name: string; arrived: string; departed: string | null; minutes: number }>
}): string {
  const { dmName, todayDate, hoursWorked, clockInTime, clockOutTime,
    visitCount, tasksAssigned, tasksCompleted, accDocsCount, coachingCount, checklistCount, recapText, storeVisits } = params

  const stat = (label: string, value: string | number, color: string) =>
    `<div style="text-align:center;flex:1;min-width:80px">
      <div style="font-size:22px;font-weight:700;color:${color}">${value}</div>
      <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">${label}</div>
    </div>`

  const recapLines = recapText.split('\n').map(line =>
    line.trim() ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#374151">${line}</p>` : '<br/>'
  ).join('')

  return `
<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px;border-radius:12px 12px 0 0">
    <h1 style="color:white;margin:0;font-size:20px;font-weight:700">End of Day Recap</h1>
    <p style="color:#ddd6fe;margin:6px 0 0;font-size:14px">${dmName} — ${todayDate}</p>
    <p style="color:#c4b5fd;margin:4px 0 0;font-size:13px">${clockInTime} → ${clockOutTime}</p>
  </div>

  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;overflow:hidden;background:white">
    <!-- Stats Row -->
    <div style="display:flex;padding:20px 16px;border-bottom:1px solid #f3f4f6;gap:8px;flex-wrap:wrap">
      ${stat('Hours', hoursWorked, '#7c3aed')}
      ${stat('Visits', visitCount > 0 ? visitCount : storeVisits.length, '#0891b2')}
      ${stat('Tasks', `${tasksAssigned}/${tasksCompleted}`, '#059669')}
      ${stat('Coaching', coachingCount, '#d97706')}
      ${stat('Acc. Docs', accDocsCount, '#dc2626')}
    </div>
    <div style="display:flex;padding:4px 16px 12px;border-bottom:1px solid #f3f4f6;justify-content:center">
      <span style="font-size:10px;color:#9ca3af">${checklistCount} employee checklist${checklistCount !== 1 ? 's' : ''} submitted today</span>
    </div>

    <!-- GPS Store Visits -->
    ${storeVisits.length > 0 ? `
    <div style="padding:16px 20px;border-bottom:1px solid #f3f4f6">
      <p style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;margin:0 0 12px">Store Visits (GPS Tracked)</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <th style="text-align:left;padding:4px 8px;font-size:10px;color:#9ca3af;border-bottom:1px solid #e5e7eb">Store</th>
          <th style="text-align:left;padding:4px 8px;font-size:10px;color:#9ca3af;border-bottom:1px solid #e5e7eb">Arrived</th>
          <th style="text-align:left;padding:4px 8px;font-size:10px;color:#9ca3af;border-bottom:1px solid #e5e7eb">Left</th>
          <th style="text-align:right;padding:4px 8px;font-size:10px;color:#9ca3af;border-bottom:1px solid #e5e7eb">Time</th>
        </tr>
        ${storeVisits.map(sv => {
          const h = Math.floor(sv.minutes / 60)
          const m = sv.minutes % 60
          const duration = h > 0 ? `${h}h ${m}m` : `${m}m`
          return `<tr>
            <td style="padding:6px 8px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6">${sv.store_name}</td>
            <td style="padding:6px 8px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6">${sv.arrived}</td>
            <td style="padding:6px 8px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6">${sv.departed ?? 'At clock-out'}</td>
            <td style="padding:6px 8px;font-size:13px;font-weight:600;color:#7c3aed;text-align:right;border-bottom:1px solid #f3f4f6">${duration}</td>
          </tr>`
        }).join('')}
        <tr>
          <td colspan="3" style="padding:6px 8px;font-size:12px;font-weight:600;color:#6b7280">Total Time in Stores</td>
          <td style="padding:6px 8px;font-size:13px;font-weight:700;color:#7c3aed;text-align:right">${(() => {
            const total = storeVisits.reduce((s, v) => s + v.minutes, 0)
            const h = Math.floor(total / 60)
            const m = total % 60
            return h > 0 ? `${h}h ${m}m` : `${m}m`
          })()}</td>
        </tr>
      </table>
    </div>` : ''}

    <!-- AI Recap -->
    <div style="padding:24px 20px">
      ${recapLines}
    </div>

    <div style="padding:12px 20px;background:#f9fafb;border-top:1px solid #f3f4f6">
      <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center">
        Generated by Field Manager Pro &middot; <a href="https://fieldmanagerpro.app" style="color:#7c3aed">fieldmanagerpro.app</a>
      </p>
    </div>
  </div>
</div>`
}

async function buildVisitsExcel(visits: VisitRow[], dmName: string, todayDate: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Store Visits')

  // Header styling
  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } }
  const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }

  // Title row
  ws.mergeCells('A1:G1')
  const titleCell = ws.getCell('A1')
  titleCell.value = `${dmName} — Store Visits — ${todayDate}`
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } }
  titleCell.alignment = { horizontal: 'left' }

  // Column headers
  ws.getRow(3).values = ['Time', 'Store Address', 'Visit Type', 'Assigned RDM', 'Intentionality', 'Takeaways & Commitments', 'Impact']
  ws.getRow(3).eachCell(cell => {
    cell.fill = headerFill
    cell.font = headerFont
    cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } }
  })

  // Column widths
  ws.getColumn(1).width = 12  // Time
  ws.getColumn(2).width = 35  // Store
  ws.getColumn(3).width = 20  // Type
  ws.getColumn(4).width = 20  // RDM
  ws.getColumn(5).width = 40  // Intentionality
  ws.getColumn(6).width = 50  // Takeaways
  ws.getColumn(7).width = 50  // Impact

  // Data rows
  for (const v of visits) {
    const time = new Date(v.submitted_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
    const type = v.visit_type === 'quick_coaching' ? 'Quick Visit w/ Coaching' : v.visit_type === 'quick' ? 'Quick Visit' : 'Full Visit'
    const row = ws.addRow([
      time,
      v.store_address,
      type,
      v.assigned_rdm || '',
      v.intentionality || '',
      v.quick_takeaways || '',
      v.quick_impact || '',
    ])
    row.eachCell(cell => {
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } }
    })
    row.height = 40
  }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
