import type { Activity, Trip } from './types'
import { DAY_COLORS } from './types'

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)

/** Long random id for documents that live in a shared Firestore collection. */
export const longId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('')

/** "HH:MM" -> minutes since midnight */
export const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** minutes since midnight -> "HH:MM" (clamped to 23:59) */
export const toTime = (mins: number): string => {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(mins)))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const duration = (a: Pick<Activity, 'start' | 'end'>): number =>
  Math.max(0, toMinutes(a.end) - toMinutes(a.start))

export const formatDuration = (mins: number): string => {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}小時${m}分`
  if (h) return `${h}小時`
  return `${m}分`
}

export const addDays = (isoDate: string, n: number): Date => {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export const formatDate = (d: Date): string =>
  `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`

export const formatMoney = (n: number, currency: string): string =>
  `${currency} ${Math.round(n).toLocaleString()}`

export const dayColor = (index: number): string => DAY_COLORS[index % DAY_COLORS.length]

/** Activities of a day, sorted by start time. */
export const dayActivities = (trip: Trip, dayIndex: number): Activity[] => {
  const day = trip.days[dayIndex]
  if (!day) return []
  return day.activityIds
    .map((id) => trip.activities[id])
    .filter((a): a is Activity => Boolean(a))
}

/** Returns the set of activity ids that overlap in time with a neighbour in the same day. */
export const findConflicts = (activities: Activity[]): Set<string> => {
  const conflicts = new Set<string>()
  const sorted = [...activities].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (toMinutes(cur.start) < toMinutes(prev.end)) {
      conflicts.add(prev.id)
      conflicts.add(cur.id)
    }
  }
  return conflicts
}

export const tripTotalCost = (trip: Trip): number =>
  Object.values(trip.activities).reduce((sum, a) => sum + (a.cost || 0), 0)

export const dayCost = (trip: Trip, dayIndex: number): number =>
  dayActivities(trip, dayIndex).reduce((sum, a) => sum + (a.cost || 0), 0)

/** Haversine distance in km. */
export const distanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const R = 6371
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
