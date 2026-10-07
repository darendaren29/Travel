/**
 * reCAPTCHA Enterprise site key for Firebase App Check.
 * Get it from Firebase console → App Check → register the web app.
 * Leave empty to run without App Check (Firebase AI Logic requires it in production).
 */
export const RECAPTCHA_SITE_KEY = '6LeQ4eMtAAAAADmi3CEFh6sfwUKJNj-VOL1HoFF9'

/** Gemini models to try in order; the first one the project can use wins. */
export const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3-flash', 'gemini-2.5-flash']
