'use client'

import { useEffect } from 'react'
import { registerForPushNotifications } from '@/lib/push-client'

/**
 * Invisible component — registers for push notifications once the app loads.
 * Only runs after confirming the user is logged in; no-op in the browser.
 */
export default function PushInit() {
  useEffect(() => {
    // Only request push permission if the user has an active session.
    // This prevents the notification dialog from firing on the login screen.
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.id) registerForPushNotifications() })
      .catch(() => {})
  }, [])
  return null
}
