/**
 * reCAPTCHA Enterprise site key for Firebase App Check.
 * Get it from Firebase console → App Check → register the web app.
 * Leave empty to run without App Check.
 */
export const RECAPTCHA_SITE_KEY = '6LeQ4eMtAAAAADmi3CEFh6sfwUKJNj-VOL1HoFF9'

/**
 * Google Maps Platform browser key (restrict it to this site's domains and to
 * "Maps JavaScript API" + "Places API (New)"). Empty = fall back to OpenStreetMap.
 * Trips to Korea always use OSM, since Google cannot route or search well there.
 */
export const GOOGLE_MAPS_API_KEY = 'AIzaSyBrcqek1wsaNOaxxIVZdZqqwTIEcFr_HZ4'
/** Map ID from Cloud Console → Google Maps Platform → Map Management (needed for AdvancedMarker). */
export const GOOGLE_MAP_ID = 'a777c9bd17ed46cbbc2f8b8c'

/**
 * Optional free CARTO basemaps key (https://carto.com/basemaps — no account needed,
 * 5M tiles/month non-commercial). Leave empty to hide the CARTO basemap options.
 */
export const CARTO_API_KEY = ''

/** Longest itinerary the AI dialog will request in one go. */
export const AI_MAX_DAYS = 21
