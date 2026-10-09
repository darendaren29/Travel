import LZString from 'lz-string'
import type { Trip } from './types'

const HASH_KEY = 'trip='

export const downloadJson = (trip: Trip) => {
  const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${trip.name || 'trip'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export const readJsonFile = (file: File): Promise<Trip> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (!isTrip(data)) throw new Error('格式不正確')
        resolve(data)
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })

export const isTrip = (x: unknown): x is Trip => {
  if (!x || typeof x !== 'object') return false
  const t = x as Partial<Trip>
  return (
    typeof t.name === 'string' &&
    Array.isArray(t.days) &&
    typeof t.activities === 'object' &&
    t.activities !== null
  )
}

export const buildShareUrl = (trip: Trip): string => {
  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(trip))
  const base = `${location.origin}${location.pathname}`
  return `${base}#${HASH_KEY}${encoded}`
}

/** Reads a shared trip from the URL hash (if any) and clears the hash. */
export const consumeSharedTrip = (): Trip | null => {
  const hash = location.hash.replace(/^#/, '')
  if (!hash.startsWith(HASH_KEY)) return null
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash.slice(HASH_KEY.length))
    const data = JSON.parse(json)
    history.replaceState(null, '', location.pathname)
    return isTrip(data) ? data : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Short links (share snapshots and collaboration invites)
// ---------------------------------------------------------------------------

/** LINE opens links carrying this parameter in the phone's real browser (where Google sign-in works). */
const EXTERNAL = 'openExternalBrowser=1'
const base = () => `${location.origin}${location.pathname}`

export const inviteUrl = (tripId: string) => `${base()}?join=${tripId}&${EXTERNAL}`
export const shortShareUrl = (shareId: string) => `${base()}?share=${shareId}&${EXTERNAL}`

/** Reads and removes a URL query parameter (and LINE's helper parameter). */
export const consumeParam = (name: string): string | null => {
  const params = new URLSearchParams(location.search)
  const value = params.get(name)
  if (!value) return null
  params.delete(name)
  params.delete('openExternalBrowser')
  const qs = params.toString()
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`)
  return value
}

/** In-app browsers (LINE, Facebook, Instagram, WeChat…) where Google blocks sign-in. */
export const isInAppBrowser = (ua = navigator.userAgent) => /\bLine\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|KAKAOTALK|Threads/i.test(ua)
