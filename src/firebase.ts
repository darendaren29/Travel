import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { RECAPTCHA_SITE_KEY } from './config'

// Public web app identifiers (not secrets) — access is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyBkVB7HAo73_wUl1bVy9fpbuz2Xt1ywbHk',
  authDomain: 'travel-planner-2734f.firebaseapp.com',
  projectId: 'travel-planner-2734f',
  storageBucket: 'travel-planner-2734f.firebasestorage.app',
  messagingSenderId: '78732966306',
  appId: '1:78732966306:web:ff0814b41790b5c86a9afb',
}

export const app = initializeApp(firebaseConfig)

// App Check proves requests come from this web app.
if (RECAPTCHA_SITE_KEY) {
  if (import.meta.env?.DEV) {
    // On localhost the SDK prints a debug token to the console; register it under
    // Firebase console → App Check → Apps → ⋮ → Manage debug tokens.
    ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
// Activities carry optional fields (lat/lng/notes) that may be undefined.
// Long polling instead of the streaming WebChannel: some phones and in-app browsers can't keep the
// stream open, which made the client report "offline" and never sync.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true, experimentalForceLongPolling: true })
export const storage = getStorage(app)
/** Cloud Functions (functions/) — same region as Firestore. */
export const functions = getFunctions(app, 'asia-east1')
