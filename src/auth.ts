import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import { useStore } from './store'
import { joinTrip, startSync } from './sync'
import { consumeParam, isInAppBrowser } from './share'

const tryJoin = async (tripId: string, uid: string) => {
  const store = useStore.getState()
  try {
    store.setNotice('正在加入共編行程…')
    await joinTrip(tripId, uid)
    // The live query will deliver the trip; switch to it once it arrives.
    const arrived = () => {
      const t = useStore.getState().trips.find((x) => x.id === tripId)
      if (!t) return false
      useStore.getState().switchTrip(tripId)
      useStore.getState().setNotice(`已加入共編行程「${t.name}」`)
      return true
    }
    if (!arrived()) {
      const unsub = useStore.subscribe(() => arrived() && unsub())
    }
    store.setPendingJoin(null)
    sessionStorage.removeItem(JOIN_KEY)
  } catch (e) {
    store.setPendingJoin(null)
    sessionStorage.removeItem(JOIN_KEY)
    store.setNotice(null)
    alert(`無法加入共編行程：${e instanceof Error ? e.message : String(e)}\n請確認邀請連結仍然有效。`)
  }
}

/** Wire Firebase Auth to the store and start/stop cloud sync on sign-in/out. */
const JOIN_KEY = 'travel-planner-pending-join'

export function initAuth() {
  const store = useStore.getState()
  // Remembered per tab so an invite survives a sign-in redirect or an accidental reload.
  const pending = consumeParam('join') ?? sessionStorage.getItem(JOIN_KEY)
  if (pending) {
    store.setPendingJoin(pending)
    try {
      sessionStorage.setItem(JOIN_KEY, pending)
    } catch {
      /* private mode */
    }
  }

  let stopSync: (() => void) | null = null

  onAuthStateChanged(auth, (u) => {
    const s = useStore.getState()
    s.setAuthReady()
    if (u) {
      s.setUser({ uid: u.uid, name: u.displayName ?? u.email ?? '使用者', email: u.email ?? '', photo: u.photoURL ?? undefined })
      stopSync?.()
      stopSync = startSync(u.uid)
      if (s.pendingJoin) void tryJoin(s.pendingJoin, u.uid)
    } else {
      const wasSignedIn = Boolean(s.user)
      stopSync?.()
      stopSync = null
      s.setUser(null)
      s.setSyncState('off')
      if (wasSignedIn) s.resetLocal()
    }
  })
}

export const signIn = async () => {
  try {
    await signInWithPopup(auth, googleProvider)
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    if (code.includes('popup-closed') || code.includes('cancelled')) return
    if (isInAppBrowser())
      alert('LINE、Facebook 等 App 的內建瀏覽器無法使用 Google 登入。\n請點右上角「⋯」選「用預設瀏覽器開啟」，或把網址複製到 Safari／Chrome。')
    else alert(`登入失敗：${e instanceof Error ? e.message : String(e)}`)
  }
}

export const signOut = () => fbSignOut(auth)
