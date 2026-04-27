'use client'

import { useEffect } from 'react'
import { registerForPushNotifications } from '@/lib/push-client'

/**
 * Invisible component — registers for push notifications once the app loads.
 * Drop this anywhere in the layout; it's a no-op in the browser.
 */
export default function PushInit() {
  useEffect(() => {
    registerForPushNotifications()
  }, [])
  return null
}
