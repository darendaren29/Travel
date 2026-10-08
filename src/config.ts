/**
 * reCAPTCHA Enterprise site key for Firebase App Check.
 * Get it from Firebase console → App Check → register the web app.
 * Leave empty to run without App Check (Firebase AI Logic requires it in production).
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

/**
 * Gemini models to try in order. A model that is missing, out of quota or overloaded is skipped,
 * so cheaper "lite" models with larger free quotas act as fallbacks.
 */
export const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite']

/**
 * Gemini providers behind Firebase AI Logic, tried in order:
 * - 'vertex': Vertex AI Gemini API — postpaid on the Blaze billing account (needs enabling in
 *   Firebase console → AI Logic). Google Cloud credits apply.
 * - 'developer': Gemini Developer API — AI Studio billing (free tier or prepaid credits).
 * A provider that isn't enabled or has no billing is skipped automatically.
 */
export const AI_BACKENDS: ('vertex' | 'developer')[] = ['vertex', 'developer']
/** Vertex AI location; 'global' serves the most models. */
export const VERTEX_LOCATION = 'global'

/**
 * AI itinerary providers offered in the dialog:
 * - 'gemini': Firebase AI Logic, called straight from the browser (see AI_BACKENDS above).
 * - 'claude': Claude API through the `claudeItinerary` Cloud Function (functions/). The Anthropic
 *   API key lives in Secret Manager (synced from the ANTHROPIC_API_KEY GitHub secret).
 */
export type AiProvider = 'gemini' | 'claude'
export const AI_PROVIDERS: { id: AiProvider; label: string; wait: string }[] = [
  { id: 'gemini', label: 'Gemini', wait: '約 10–30 秒' },
  { id: 'claude', label: 'Claude', wait: '約 30 秒–2 分鐘' },
]

/** Longest itinerary the AI dialog will request in one go. */
export const AI_MAX_DAYS = 21
