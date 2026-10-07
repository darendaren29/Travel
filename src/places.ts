import { GOOGLE_MAPS_API_KEY } from './config'
import { isKorea } from './nav'

export interface PlaceHit {
  name: string
  address: string
  lat: number
  lng: number
  /** Photo resource name, when Google has one. */
  photo?: string
}

/** Image URL for a Places photo resource name (served via redirect to googleusercontent). */
export const photoUrl = (photo: string, width = 200): string =>
  `https://places.googleapis.com/v1/${photo}/media?maxWidthPx=${width}&key=${GOOGLE_MAPS_API_KEY}`

export interface SearchOptions {
  /** Bias results towards this point (e.g. another stop of the same trip). */
  near?: { lat: number; lng: number }
}

/** Google Places is used for every destination except Korea (and only when a key is configured). */
export const useGooglePlaces = (destination: string): boolean => Boolean(GOOGLE_MAPS_API_KEY) && !isKorea(destination)

export async function searchPlaces(query: string, destination: string, opts: SearchOptions = {}): Promise<PlaceHit[]> {
  const q = query.trim()
  if (!q) return []
  return useGooglePlaces(destination) ? searchGoogle(q, opts) : searchNominatim(q)
}

/** Places API (New) text search — browser keys with HTTP-referrer restrictions are accepted. */
async function searchGoogle(q: string, { near }: SearchOptions): Promise<PlaceHit[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.photos',
    },
    body: JSON.stringify({
      textQuery: q,
      languageCode: 'zh-TW',
      maxResultCount: 6,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } } : {}),
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? `Google Places ${res.status}`)
  }
  const data = (await res.json()) as {
    places?: {
      displayName?: { text?: string }
      formattedAddress?: string
      location?: { latitude: number; longitude: number }
      photos?: { name: string }[]
    }[]
  }
  return (data.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      name: p.displayName?.text ?? '',
      address: p.formattedAddress ?? '',
      lat: p.location!.latitude,
      lng: p.location!.longitude,
      photo: p.photos?.[0]?.name,
    }))
}

async function searchNominatim(q: string): Promise<PlaceHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=zh-TW&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const data = (await res.json()) as { display_name: string; lat: string; lon: string }[]
  return data.map((r) => ({
    name: r.display_name.split(',')[0].trim(),
    address: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }))
}
