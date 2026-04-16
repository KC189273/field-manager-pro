import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const COOKIE = 'fmp-session'
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!)

export type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

export interface SessionPayload {
  id: string
  username: string
  fullName: string
  email: string
  role: Role
  org_id?: string | null
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .setIssuedAt()
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  return verifyToken(token)
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE)
}

export function isManager(role: Role): boolean {
  return role === 'manager' || role === 'ops_manager'
}

export function isDeveloper(role: Role): boolean {
  return role === 'developer'
}

export function isOwner(role: Role): boolean {
  return role === 'owner' || role === 'sales_director'
}

export function canManageTime(role: Role): boolean {
  return isManager(role) || isOwner(role) || isDeveloper(role)
}

export function canSubmitExpense(role: Role): boolean {
  return role !== 'employee'
}

export function canApproveExpense(role: Role): boolean {
  return isOwner(role) || role === 'developer'
}

export function canViewTeam(role: Role): boolean {
  return isManager(role) || isOwner(role) || isDeveloper(role)
}
