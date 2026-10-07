import { GOOGLE_MAPS_API_KEY } from './config'
import type { Activity, Leg, TravelMode, Trip } from './types'
import { addDays, toMinutes } from './utils'

export interface LatLng {
  lat: number
  lng: number
}

export const hasGeo = (a: Activity): a is Activity & LatLng => a.lat != null && a.lng != null

const round = (n: number) => n.toFixed(5)

/** Cache key for a leg; coordinates rounded so tiny float differences still hit. */
export const legKey = (mode: TravelMode, from: LatLng, to: LatLng): string =>
  `${mode}|${round(from.lat)},${round(from.lng)}|${round(to.lat)},${round(to.lng)}`

export const tripMode = (trip: Trip): TravelMode => trip.travelMode ?? 'TRANSIT'

/** Consecutive located pairs of a day with their cached leg (if any). */
export interface DayLeg {
  from: Activity & LatLng
  to: Activity & LatLng
  key: string
  leg?: Leg
}

export const dayLegs = (trip: Trip, activities: Activity[]): DayLeg[] => {
  const mode = tripMode(trip)
  const out: DayLeg[] = []
  for (let i = 1; i < activities.length; i++) {
    const from = activities[i - 1]
    const to = activities[i]
    if (!hasGeo(from) || !hasGeo(to)) continue
    const key = legKey(mode, from, to)
    out.push({ from, to, key, leg: trip.legs?.[key] })
  }
  return out
}

/** Leg between two specific activities (consecutive or not), if cached. */
export const legBetween = (trip: Trip, from: Activity, to: Activity): Leg | undefined =>
  hasGeo(from) && hasGeo(to) ? trip.legs?.[legKey(tripMode(trip), from, to)] : undefined

export const travelMinutes = (leg: Leg): number => Math.ceil(leg.durationSec / 60)

export const formatDistance = (m: number): string => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`)

// ---------- Google Routes API ----------

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })

const parseDuration = (s: string | undefined): number => Number((s ?? '0s').replace(/s$/, '')) || 0

interface RoutesResponse {
  routes?: {
    duration?: string
    distanceMeters?: number
    polyline?: { encodedPolyline?: string }
    optimizedIntermediateWaypointIndex?: number[]
  }[]
  error?: { message?: string }
}

async function callRoutes(body: Record<string, unknown>, fieldMask: string): Promise<RoutesResponse> {
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify({ languageCode: 'zh-TW', units: 'METRIC', ...body }),
  })
  const data = (await res.json().catch(() => ({}))) as RoutesResponse
  if (!res.ok) throw new Error(data.error?.message ?? `Routes API ${res.status}`)
  return data
}

/**
 * Departure time for transit queries: the trip date + the time we leave the previous stop.
 * Google rejects times in the past, so fall back to "now" for trips already underway.
 */
const departureTime = (trip: Trip, dayIndex: number, leaveAt: string): string | undefined => {
  const d = addDays(trip.startDate, dayIndex)
  d.setHours(Math.floor(toMinutes(leaveAt) / 60), toMinutes(leaveAt) % 60, 0, 0)
  return d.getTime() > Date.now() + 60_000 ? d.toISOString() : undefined
}

/** Compute one leg. Transit has no routing in some places; we surface that as an error. */
export async function computeLeg(trip: Trip, dayIndex: number, from: Activity & LatLng, to: Activity & LatLng): Promise<Leg> {
  const mode = tripMode(trip)
  const body: Record<string, unknown> = {
    origin: waypoint(from),
    destination: waypoint(to),
    travelMode: mode,
    computeAlternativeRoutes: false,
  }
  if (mode === 'TRANSIT') {
    const dep = departureTime(trip, dayIndex, from.end)
    if (dep) body.departureTime = dep
  }
  const data = await callRoutes(body, 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline')
  const r = data.routes?.[0]
  if (!r) throw new Error('找不到路線')
  return {
    mode,
    durationSec: parseDuration(r.duration),
    distanceM: r.distanceMeters ?? 0,
    polyline: r.polyline?.encodedPolyline ?? '',
    fetchedAt: Date.now(),
  }
}

/**
 * Best visiting order for the stops between a fixed first and last stop.
 * Google only optimises WALK/DRIVE/BICYCLE; transit trips are optimised as walking.
 * Returns the ids in the new order (first and last unchanged).
 */
export async function optimizeOrder(trip: Trip, stops: (Activity & LatLng)[]): Promise<string[]> {
  if (stops.length < 3) return stops.map((s) => s.id)
  const mode = tripMode(trip) === 'TRANSIT' ? 'WALK' : tripMode(trip)
  const middle = stops.slice(1, -1)
  const data = await callRoutes(
    {
      origin: waypoint(stops[0]),
      destination: waypoint(stops[stops.length - 1]),
      intermediates: middle.map(waypoint),
      travelMode: mode,
      optimizeWaypointOrder: true,
    },
    'routes.optimizedIntermediateWaypointIndex',
  )
  const order = data.routes?.[0]?.optimizedIntermediateWaypointIndex
  if (!order || order.length !== middle.length) throw new Error('無法最佳化順序')
  return [stops[0].id, ...order.map((i) => middle[i].id), stops[stops.length - 1].id]
}

/** Decode a Google encoded polyline into lat/lng points. */
export function decodePolyline(encoded: string): LatLng[] {
  const pts: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const which of ['lat', 'lng'] as const) {
      let result = 0
      let shift = 0
      let b: number
      do {
        b = encoded.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 'lat') lat += delta
      else lng += delta
    }
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return pts
}
