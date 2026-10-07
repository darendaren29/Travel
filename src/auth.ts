import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import { useStore } from './store'
import { joinTrip, startSync } from './sync'

const JOIN_PARAM = 'join'

/** Reads `?join=<tripId>` from the URL once and clears it. */
const consumeJoinParam = (): string | null => {
  const params = new URLSearchParams(location.search)
  const id = params.get(JOIN_PARAM)
  if (!id) return null
  params.delete(JOIN_PARAM)
  const qs = params.toString()
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`)
  return id
}

const tryJoin = async (tripId: string, uid: string) => {
  const store = useStore.getState()
  try {
    await joinTrip(tripId, uid)
    // The live query will deliver the trip; switch to it once it arrives.
    const unsub = useStore.subscribe((s) => {
      if (s.trips.some((t) => t.id === tripId)) {
        s.switchTrip(tripId)
        unsub()
      }
    })
    store.setPendingJoin(null)
  } catch (e) {
    store.setPendingJoin(null)
    alert(`無法加入共編行程：${e instanceof Error ? e.message : String(e)}\n請確認邀請連結仍然有效。`)
  }
}

/** Wire Firebase Auth to the store and start/stop cloud sync on sign-in/out. */
export function initAuth() {
  const store = useStore.getState()
  const pending = consumeJoinParam()
  if (pending) store.setPendingJoin(pending)

  let stopSync: (() => void) | null = null

  onAuthStateChanged(auth, (u) => {
    const s = useStore.getState()
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
    alert(`登入失敗：${e instanceof Error ? e.message : String(e)}`)
  }
}

export const signOut = () => fbSignOut(auth)
