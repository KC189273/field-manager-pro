/**
 * Client-side push notification registration.
 * Uses the Capacitor plugin bridge directly — no npm package import needed.
 * The @capacitor/push-notifications native plugin must be installed and synced.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPushPlugin(): any | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Capacitor = (window as any).Capacitor
  if (!Capacitor?.isNativePlatform?.()) return null
  return Capacitor.Plugins?.PushNotifications ?? null
}

let registered = false

/**
 * Request push permission and register device token with the server.
 * Safe to call multiple times — only runs once per session.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (registered) return
  const plugin = getPushPlugin()
  if (!plugin) return
  registered = true

  try {
    // Check / request permission
    let permStatus = await plugin.checkPermissions()
    if (permStatus.receive === 'prompt') {
      permStatus = await plugin.requestPermissions()
    }
    if (permStatus.receive !== 'granted') return

    // Register with APNs / FCM
    await plugin.register()

    // On successful registration, send token to server
    plugin.addListener('registration', async (token: { value: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const platform = (window as any).Capacitor?.getPlatform?.() ?? 'ios'
      try {
        await fetch('/api/push/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token.value, platform }),
        })
      } catch { /* non-fatal */ }
    })

    plugin.addListener('registrationError', (err: unknown) => {
      console.error('Push registration error:', err)
    })
  } catch (e) {
    console.error('registerForPushNotifications error:', e)
  }
}
