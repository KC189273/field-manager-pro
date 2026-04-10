/**
 * GPS bridge — uses native background geolocation when running inside the
 * Capacitor app, falls back silently in the browser (NavBar handles browser tracking).
 *
 * The native plugin continues tracking even when:
 *   - The app is minimized
 *   - The screen is locked
 *   - The phone is in the user's pocket
 */

const BREADCRUMB_ENDPOINT = '/api/gps/breadcrumb'

// Detect if running inside the Capacitor native shell
export function isCapacitor(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(window as any).Capacitor?.isNativePlatform?.()
}

// Access the native BackgroundGeolocation plugin via Capacitor's plugin bridge
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPlugin(): any | null {
  if (!isCapacitor()) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Capacitor?.Plugins?.BackgroundGeolocation ?? null
}

let watcherId: string | null = null

/**
 * Start native background GPS tracking. Call when the employee clocks in.
 * No-op in the browser.
 */
export async function startNativeTracking(shiftId: string): Promise<void> {
  const plugin = getPlugin()
  if (!plugin) return

  try {
    // Remove any existing watcher first
    if (watcherId) {
      await plugin.removeWatcher({ id: watcherId }).catch(() => {})
      watcherId = null
    }

    watcherId = await plugin.addWatcher(
      {
        backgroundMessage: 'Field Manager Pro is tracking your location while you are clocked in.',
        backgroundTitle: 'Location Active',
        requestPermissions: true,
        stale: false,
        distanceFilter: 50, // metres — skip update if not moved enough
      },
      async (position: { latitude: number; longitude: number; accuracy: number } | null, error: { code: string } | null) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') {
            console.warn('Background location permission denied')
          }
          return
        }
        if (!position) return

        try {
          await fetch(BREADCRUMB_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shift_id: shiftId,
              lat: position.latitude,
              lng: position.longitude,
              accuracy: position.accuracy,
              is_gap: false,
            }),
          })
        } catch {
          // Network blip — breadcrumb lost, non-critical
        }
      }
    )
  } catch (err) {
    console.error('Failed to start native GPS tracking:', err)
  }
}

/**
 * Stop native background GPS tracking. Call when the employee clocks out.
 */
export async function stopNativeTracking(): Promise<void> {
  const plugin = getPlugin()
  if (!plugin || !watcherId) return

  try {
    await plugin.removeWatcher({ id: watcherId })
    watcherId = null
  } catch (err) {
    console.error('Failed to stop native GPS tracking:', err)
  }
}

/**
 * Resume tracking for an already-active shift (e.g. app reopened mid-shift).
 * Checks clock status on mount and restarts the watcher if still clocked in.
 */
export async function resumeNativeTrackingIfClocked(): Promise<void> {
  if (!isCapacitor()) return
  try {
    const res = await fetch('/api/clock/status')
    if (!res.ok) return
    const { activeShift } = await res.json()
    if (activeShift?.id) {
      await startNativeTracking(activeShift.id)
    }
  } catch { /* ignore */ }
}
