import type { Activity, Trip } from './types'

/** Korea blocks map-data export, so Google Maps cannot route there; prefer Kakao/Naver. */
export const isKorea = (destination: string): boolean =>
  /韓|首爾|釜山|濟州|大邱|仁川|大田|光州|慶州|korea|seoul|busan|jeju|incheon|한국|서울|부산/i.test(destination)

const hasGeo = (a: Activity): a is Activity & { lat: number; lng: number } => a.lat != null && a.lng != null
const label = (a: Activity) => a.location || a.title
const point = (a: Activity) => (hasGeo(a) ? `${a.lat},${a.lng}` : label(a))

export interface NavLink {
  key: 'google' | 'apple' | 'kakao' | 'naver'
  name: string
  url: string
}

export const googleUrl = (a: Activity): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point(a))}${hasGeo(a) ? '' : ''}`

export const appleUrl = (a: Activity): string =>
  hasGeo(a)
    ? `https://maps.apple.com/?daddr=${a.lat},${a.lng}&q=${encodeURIComponent(label(a))}`
    : `https://maps.apple.com/?daddr=${encodeURIComponent(label(a))}`

/** Kakao Map URL scheme: /link/to/{name},{lat},{lng} opens directions to that point. */
export const kakaoUrl = (a: Activity): string =>
  hasGeo(a)
    ? `https://map.kakao.com/link/to/${encodeURIComponent(label(a))},${a.lat},${a.lng}`
    : `https://map.kakao.com/link/search/${encodeURIComponent(label(a))}`

export const naverUrl = (a: Activity): string => `https://map.naver.com/p/search/${encodeURIComponent(label(a))}`

const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)

/** Every navigation option that makes sense for this trip, recommended one first. */
export const navLinks = (trip: Trip, a: Activity): NavLink[] => {
  const links: NavLink[] = []
  if (isKorea(trip.destination)) {
    links.push({ key: 'kakao', name: 'Kakao Map', url: kakaoUrl(a) })
    links.push({ key: 'naver', name: 'Naver Map', url: naverUrl(a) })
  }
  links.push({ key: 'google', name: 'Google 地圖', url: googleUrl(a) })
  if (isApple()) links.push({ key: 'apple', name: 'Apple 地圖', url: appleUrl(a) })
  return links
}

export const canNavigate = (a: Activity): boolean => hasGeo(a) || Boolean(a.location)

/**
 * One Google Maps link through all located stops of a day, in order.
 * Returns null when fewer than two stops have coordinates or in Korea (no routing there).
 */
export const dayRouteUrl = (trip: Trip, activities: Activity[]): string | null => {
  if (isKorea(trip.destination)) return null
  const pts = activities.filter(hasGeo).map((a) => `${a.lat},${a.lng}`)
  if (pts.length < 2) return null
  const origin = pts[0]
  const destination = pts[pts.length - 1]
  const waypoints = pts.slice(1, -1).slice(0, 9) // Google accepts at most 9 intermediate stops
  const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'transit' })
  if (waypoints.length) params.set('waypoints', waypoints.join('|'))
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export const openUrl = (url: string) => window.open(url, '_blank', 'noopener')
