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
 * Pass force=true to re-run even if already called this session.
 */
export async function registerForPushNotifications(force = false): Promise<string> {
  if (registered && !force) return 'already-registered-this-session'

  if (typeof window === 'undefined') return 'server-side'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Capacitor = (window as any).Capacitor
  if (!Capacitor) return 'capacitor-not-loaded'
  if (!Capacitor.isNativePlatform?.()) return 'not-native-platform'

  const plugin = getPushPlugin()
  if (!plugin) return 'push-plugin-not-available (app may need update)'
  registered = true

  try {
    // Check / request permission
    let permStatus = await plugin.checkPermissions()
    if (permStatus.receive === 'prompt') {
      permStatus = await plugin.requestPermissions()
    }
    if (permStatus.receive !== 'granted') return `permission-${permStatus.receive}`

    // Add listeners BEFORE calling register() to avoid missing the event
    return await new Promise<string>((resolve) => {
      plugin.addListener('registration', async (token: { value: string }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const platform = (window as any).Capacitor?.getPlatform?.() ?? 'ios'
        try {
          await fetch('/api/push/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token.value, platform }),
          })
          resolve('registered:' + token.value.slice(0, 8) + '…')
        } catch (e) {
          resolve('fetch-failed:' + String(e))
        }
      })

      plugin.addListener('registrationError', (err: unknown) => {
        resolve('apns-error:' + String(err))
      })

      // Handle notification taps — navigate to the relevant section
      plugin.addListener('pushNotificationActionPerformed', (action: { notification: { data?: Record<string, string> } }) => {
        const path = action.notification?.data?.path
        if (path && typeof window !== 'undefined') {
          window.location.href = path
        }
      })

      // Timeout after 10s
      setTimeout(() => resolve('timeout'), 10000)

      // Register with APNs after listeners are in place
      plugin.register().catch((e: unknown) => resolve('register-failed:' + String(e)))
    })
  } catch (e) {
    console.error('registerForPushNotifications error:', e)
    return 'exception:' + String(e)
  }
}
