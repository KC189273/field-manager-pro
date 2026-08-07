import { queryOne, query } from '@/lib/db'

export interface GeofenceSettings {
  enabled: boolean
  radius_ft: number
  exit_minutes: number
}

const DEFAULTS: GeofenceSettings = { enabled: true, radius_ft: 300, exit_minutes: 10 }

let ensured = false
async function ensureColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS geofence_enabled BOOLEAN DEFAULT TRUE`).catch(() => {})
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS geofence_radius_ft INT DEFAULT 300`).catch(() => {})
  await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS geofence_exit_minutes INT DEFAULT 10`).catch(() => {})
}

export async function getGeofenceSettings(orgId: string | null | undefined): Promise<GeofenceSettings> {
  if (!orgId) return DEFAULTS
  try {
    await ensureColumns()
    const row = await queryOne<{ geofence_enabled: boolean; geofence_radius_ft: number; geofence_exit_minutes: number }>(
      `SELECT COALESCE(geofence_enabled, TRUE) as geofence_enabled,
              COALESCE(geofence_radius_ft, 300) as geofence_radius_ft,
              COALESCE(geofence_exit_minutes, 10) as geofence_exit_minutes
       FROM organizations WHERE id = $1`,
      [orgId]
    )
    if (!row) return DEFAULTS
    return {
      enabled: row.geofence_enabled,
      radius_ft: row.geofence_radius_ft,
      exit_minutes: row.geofence_exit_minutes,
    }
  } catch {
    return DEFAULTS
  }
}

/** Haversine distance in feet between two lat/lng points */
export function haversineDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231 // Earth radius in feet
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
