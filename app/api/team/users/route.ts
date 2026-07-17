import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession, isManager, isOwner, createSession, setSessionCookie } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, welcomeEmailHtml } from '@/lib/notifications'
import { sendPushToUsers } from '@/lib/apns'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { getReceiptViewUrl } from '@/lib/s3'

let ensured = false
async function ensureApprovalColumn() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT NULL`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_name TEXT DEFAULT NULL`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key TEXT DEFAULT NULL`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password TEXT DEFAULT NULL`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_type TEXT NOT NULL DEFAULT 'hourly'`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_floater BOOLEAN NOT NULL DEFAULT FALSE`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_ops_collab BOOLEAN NOT NULL DEFAULT FALSE`)
  // Auto-set all managers to salary
  await query(`UPDATE users SET pay_type = 'salary' WHERE role = 'manager' AND pay_type = 'hourly'`)
}

async function addAvatarUrls(users: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  return Promise.all(
    users.map(async u => {
      if (!u.avatar_key) return { ...u, avatar_url: null }
      const avatar_url = await getReceiptViewUrl(u.avatar_key as string)
      return { ...u, avatar_url }
    })
  )
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer' && !isOwner(session.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureApprovalColumn() } catch {}
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {})

  const orgFilter = await getOrgFilter(session)
  const withPeers = new URL(req.url).searchParams.get('withPeers') === 'true'
  const hiddenFilter = session.role === 'developer' ? '' : ' AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)'
  const hiddenFilterNoAlias = session.role === 'developer' ? '' : ' AND (is_hidden = FALSE OR is_hidden IS NULL)'

  const userCols = 'u.id, u.username, u.email, u.full_name, u.role, u.is_active, u.is_terminated, u.manager_id, u.org_id, u.created_at, u.approval_status, u.created_by, u.avatar_key, u.temp_password, u.must_change_password, u.pay_type, u.is_floater, u.is_ops_collab, u.is_hidden'
  const userColsNoAlias = 'id, username, email, full_name, role, is_active, is_terminated, manager_id, org_id, created_at, approval_status, created_by, avatar_key, temp_password, must_change_password, pay_type, is_floater, is_ops_collab, is_hidden'

  if (session.role === 'developer') {
    const params: unknown[] = []
    const orgClause = appendOrgFilter(orgFilter, params, 'u')
    const users = await query(
      `SELECT ${userCols}
       FROM users u WHERE 1=1${orgClause}${hiddenFilter} ORDER BY u.role, u.full_name LIMIT 500`,
      params
    )
    return NextResponse.json({ users: await addAvatarUrls(users as Record<string, unknown>[]) })
  }

  if (isOwner(session.role) || session.role === 'ops_manager') {
    const params: unknown[] = []
    const orgClause = appendOrgFilter(orgFilter, params, 'u')
    const users = await query(
      `SELECT ${userCols}
       FROM users u WHERE 1=1${orgClause}${hiddenFilter} ORDER BY u.role, u.full_name LIMIT 500`,
      params
    )
    return NextResponse.json({ users: await addAvatarUrls(users as Record<string, unknown>[]) })
  }

  // Manager: their employees + peer DMs if withPeers=true + org-wide floaters for scheduling
  const employees = await query(
    `SELECT ${userColsNoAlias}
     FROM users WHERE manager_id = $1 AND role = 'employee'${hiddenFilterNoAlias} ORDER BY full_name`,
    [session.id]
  )

  let peers: Record<string, unknown>[] = []
  if (withPeers && session.org_id) {
    peers = await query(
      `SELECT ${userColsNoAlias}
       FROM users WHERE role = 'manager' AND org_id = $1 AND id != $2 AND is_active = TRUE${hiddenFilterNoAlias} ORDER BY full_name`,
      [session.org_id, session.id]
    )
  }

  // Org floaters from other DMs — available for scheduling and task assignment
  let orgFloaters: Record<string, unknown>[] = []
  if (session.org_id) {
    orgFloaters = await query(
      `SELECT ${userColsNoAlias}
       FROM users WHERE is_floater = TRUE AND role = 'employee' AND is_active = TRUE${hiddenFilterNoAlias}
         AND org_id = $1 AND (manager_id IS NULL OR manager_id != $2)
       ORDER BY full_name`,
      [session.org_id, session.id]
    )
  }

  const combined = [...(peers as Record<string, unknown>[]), ...(employees as Record<string, unknown>[]), ...(orgFloaters as Record<string, unknown>[])]
  return NextResponse.json({ users: await addAvatarUrls(combined) })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { username, email, fullName, password, role, managerId } = await req.json()
  if (!username || !email || !fullName || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Managers can only create employees; developer can create any non-developer; owner/sales_director can create managers
  const allowedRoles = session.role === 'developer'
    ? ['employee', 'manager', 'ops_manager', 'owner', 'sales_director']
    : isOwner(session.role)
    ? ['employee', 'manager', 'ops_manager', 'sales_director']
    : session.role === 'ops_manager'
    ? ['employee', 'manager']
    : ['employee']
  if (role && !allowedRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const finalRole = role ?? 'employee'

  // Determine manager_id
  let finalManagerId: string | null = null
  if (finalRole !== 'developer' && finalRole !== 'owner' && finalRole !== 'sales_director') {
    if ((session.role === 'developer' || isOwner(session.role) || session.role === 'ops_manager') && managerId) {
      finalManagerId = managerId
    } else if (session.role === 'manager' && finalRole === 'employee') {
      finalManagerId = session.id
    }
  }

  const existing = await queryOne(`SELECT id FROM users WHERE username = $1`, [username.trim().toLowerCase()])
  if (existing) return NextResponse.json({ error: 'Username already taken' }, { status: 409 })

  // Inherit org from manager if one is assigned, otherwise from creator
  let finalOrgId: string | null = session.org_id ?? null
  if (finalManagerId) {
    const mgr = await queryOne<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [finalManagerId])
    if (mgr?.org_id) finalOrgId = mgr.org_id
  }

  const hash = await bcrypt.hash(password, 12)

  // DMs create pending users — higher roles create immediately active users
  const isDMCreating = session.role === 'manager'
  if (isDMCreating) {
    try { await ensureApprovalColumn() } catch {}
  }

  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (username, email, password_hash, role, full_name, manager_id, org_id, created_by, is_active, approval_status, temp_password, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      username.trim().toLowerCase(), email.trim(), hash, finalRole, fullName.trim(),
      finalManagerId, finalOrgId, session.id,
      isDMCreating ? false : true,
      isDMCreating ? 'pending' : null,
      password,
      true,
    ]
  )

  if (isDMCreating) {
    // Notify approvers in the org via push
    const approvers = await query<{ id: string }>(
      `SELECT id FROM users
       WHERE role IN ('owner', 'sales_director', 'ops_manager', 'developer')
         AND is_active = TRUE
         AND (org_id = $1 OR ($1 IS NULL AND org_id IS NULL))`,
      [finalOrgId]
    )
    if (approvers.length > 0) {
      await sendPushToUsers(
        approvers.map(a => a.id),
        'New Employee Pending Approval',
        `${session.fullName} added ${fullName.trim()} — tap to review in Team.`,
        'pending_approval'
      ).catch(() => {})
    }
    return NextResponse.json({ ok: true, id: user!.id, pending: true })
  }

  await sendEmail(
    email.trim(),
    'Welcome to Field Manager Pro',
    welcomeEmailHtml(fullName.trim(), username.trim().toLowerCase(), password, finalRole)
  )

  return NextResponse.json({ ok: true, id: user!.id })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && !isOwner(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, isActive, password, mustChangePassword, fullName, email, managerId, role, orgId, avatarKey, payType, isFloater, isOpsCollab, isHidden } = await req.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  // Managers can only edit their own employees
  if (session.role === 'manager') {
    const target = await queryOne<{ manager_id: string }>(
      `SELECT manager_id FROM users WHERE id = $1`, [userId]
    )
    if (!target || target.manager_id !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Role change validation
  if (role !== undefined) {
    const allowedRoles = ['employee', 'manager', 'ops_manager', 'owner', 'sales_director']
    if (!allowedRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    await query(`UPDATE users SET role = $1 WHERE id = $2`, [role, userId])
  }

  if (isActive !== undefined) {
    await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [isActive, userId])
  }
  if (password) {
    const hash = await bcrypt.hash(password, 12)
    // mustChangePassword defaults to true unless caller explicitly passes false
    const forceChange = mustChangePassword !== false
    await query(
      `UPDATE users SET password_hash = $1, temp_password = $2, must_change_password = $3 WHERE id = $4`,
      [hash, password, forceChange, userId]
    )
  } else if (mustChangePassword === false) {
    // Clear the flag without changing the password (e.g. for stable test accounts)
    await query(`UPDATE users SET must_change_password = FALSE WHERE id = $1`, [userId])
  }
  if (fullName) await query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName.trim(), userId])
  if (email) await query(`UPDATE users SET email = $1 WHERE id = $2`, [email.trim(), userId])
  if (managerId !== undefined && (session.role === 'developer' || isOwner(session.role) || isManager(session.role))) {
    await query(`UPDATE users SET manager_id = $1 WHERE id = $2`, [managerId || null, userId])
  }
  if (orgId !== undefined && session.role === 'developer') {
    await query(`UPDATE users SET org_id = $1 WHERE id = $2`, [orgId || null, userId])
  }
  if (avatarKey !== undefined) {
    await query(`UPDATE users SET avatar_key = $1 WHERE id = $2`, [avatarKey || null, userId])
  }
  if (payType !== undefined && (payType === 'salary' || payType === 'hourly')) {
    await query(`UPDATE users SET pay_type = $1 WHERE id = $2`, [payType, userId])
  }
  if (isHidden !== undefined && session.role === 'developer') {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {})
    await query(`UPDATE users SET is_hidden = $1 WHERE id = $2`, [!!isHidden, userId])
  }
  if (isFloater !== undefined) {
    await query(`UPDATE users SET is_floater = $1 WHERE id = $2`, [!!isFloater, userId])
  }
  if (isOpsCollab !== undefined && (session.role === 'developer' || isOwner(session.role) || session.role === 'ops_manager')) {
    await query(`UPDATE users SET is_ops_collab = $1 WHERE id = $2`, [!!isOpsCollab, userId])
  }

  // If the updated user is the currently logged-in user, refresh the session
  // so email/name changes take effect immediately without requiring a logout
  if (userId === session.id && (email || fullName || role)) {
    const fresh = await queryOne<{ role: string; org_id: string | null; email: string; full_name: string }>(
      `SELECT role, org_id, email, full_name FROM users WHERE id = $1`, [session.id]
    )
    if (fresh) {
      const token = await createSession({
        ...session,
        role: fresh.role as typeof session.role,
        org_id: fresh.org_id,
        email: fresh.email,
        fullName: fresh.full_name,
      })
      await setSessionCookie(token)
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && !isOwner(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  // Prevent self-deletion
  if (userId === session.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  // Managers can only delete their own employees
  if (isManager(session.role)) {
    const target = await queryOne<{ manager_id: string; role: string }>(
      `SELECT manager_id, role FROM users WHERE id = $1`, [userId]
    )
    if (!target || target.manager_id !== session.id || target.role !== 'employee') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Null out self-referencing columns before delete
  await query(`UPDATE users SET created_by = NULL WHERE created_by = $1`, [userId])
  await query(`UPDATE shifts SET manual_by = NULL WHERE manual_by = $1`, [userId])
  await query(`UPDATE flags SET resolved_by = NULL WHERE resolved_by = $1`, [userId])

  await query(`DELETE FROM users WHERE id = $1`, [userId])
  return NextResponse.json({ ok: true })
}
