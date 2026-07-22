import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'

const PUBLIC_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/get-started',
  '/privacy',
  '/terms',
  '/delete-account',
  '/ack/',
  '/customer-signup',
  '/download',
  '/respond',
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/get-started',
  '/api/ack/',
  '/api/barbershop/lookup',
  '/api/barbershop/respond',
  '/api/barbershop/availability',
  '/service-analysis.pdf',
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths and API routes (except protected ones)
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Cron and agent cron routes protected by secret header, not session
  if (pathname.startsWith('/api/cron') || pathname.startsWith('/api/agents/run') || pathname.startsWith('/api/agents/digest')) {
    return NextResponse.next()
  }

  // All other /api routes and pages need a valid session
  const token = request.cookies.get('fmp-session')?.value
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const session = await verifyToken(token)
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect root based on role
  if (pathname === '/') {
    if (session.role === 'customer') return NextResponse.redirect(new URL('/book', request.url))
    if (session.role === 'barber' || session.role === 'shop_owner') return NextResponse.redirect(new URL('/barber-dashboard', request.url))
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Config and agent admin pages — developer only
  if ((pathname.startsWith('/config') || pathname.startsWith('/admin/agents')) && session.role !== 'developer') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
