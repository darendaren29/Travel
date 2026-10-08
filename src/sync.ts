import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import { useStore } from './store'
import type { Trip } from './types'
import { deleteTripFile } from './files'

const trips = collection(db, 'trips')
const WRITE_DEBOUNCE_MS = 600

/**
 * Two-way sync between the local store and Firestore for the signed-in user.
 * - Remote → local: a live query of trips the user is a member of.
 * - Local → remote: debounced whole-document writes, last-write-wins on `updatedAt`.
 * Returns a function that stops syncing.
 */
export function startSync(uid: string): () => void {
  const store = useStore
  const { adoptLocalTrips, setSyncState } = store.getState()

  /** updatedAt we last wrote or received per trip — used to skip echo writes. */
  const known = new Map<string, number>()
  /** Trip ids that have come from the server at least once (safe to remove if they vanish). */
  const seenRemote = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  setSyncState('syncing')
  adoptLocalTrips(uid)

  const flush = (id: string) => {
    timers.delete(id)
    const trip = store.getState().trips.find((t) => t.id === id)
    if (!trip || !trip.ownerId) return
    known.set(id, trip.updatedAt ?? 0)
    setDoc(doc(trips, id), trip).catch((e: Error) => setSyncState('error', e.message))
  }

  const scheduleWrite = (id: string) => {
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    timers.set(id, setTimeout(() => flush(id), WRITE_DEBOUNCE_MS))
  }

  const unsubRemote = onSnapshot(
    query(trips, where('members', 'array-contains', uid)),
    (snap) => {
      const remote = snap.docs.map((d) => d.data() as Trip)
      remote.forEach((t) => {
        known.set(t.id, t.updatedAt ?? 0)
        seenRemote.add(t.id)
      })
      store.getState().applyRemoteTrips(remote, seenRemote)
      // Anything we no longer see from the server can be forgotten.
      const ids = new Set(remote.map((t) => t.id))
      seenRemote.forEach((id) => !ids.has(id) && seenRemote.delete(id))
      setSyncState('synced')
    },
    (err) => setSyncState('error', err.message),
  )

  let prevTrips = store.getState().trips
  const unsubLocal = store.subscribe((s) => {
    if (s.trips === prevTrips) return
    const prev = prevTrips
    prevTrips = s.trips
    const nextIds = new Set(s.trips.map((t) => t.id))

    // Deleted locally: owners delete the document, members just leave it.
    for (const t of prev) {
      if (nextIds.has(t.id) || !t.ownerId) continue
      const existing = timers.get(t.id)
      if (existing) clearTimeout(existing)
      timers.delete(t.id)
      known.delete(t.id)
      const ref = doc(trips, t.id)
      if (t.ownerId === uid) {
        // Remove the trip's files first: Storage rules check membership on the trip document.
        Promise.allSettled(Object.values(t.docs ?? {}).map(deleteTripFile))
          .then(() => deleteDoc(ref))
          .catch((e: Error) => setSyncState('error', e.message))
      } else {
        updateDoc(ref, { members: arrayRemove(uid), updatedAt: Date.now() }).catch((e: Error) => setSyncState('error', e.message))
      }
    }

    // Changed locally (or newly adopted/created): write.
    for (const t of s.trips) {
      if (!t.ownerId) continue
      if (known.get(t.id) === (t.updatedAt ?? 0)) continue
      scheduleWrite(t.id)
    }
  })

  // Kick off writes for trips adopted at sign-in.
  store.getState().trips.forEach((t) => t.ownerId && !known.has(t.id) && scheduleWrite(t.id))

  return () => {
    unsubRemote()
    unsubLocal()
    timers.forEach((timer, id) => {
      clearTimeout(timer)
      flush(id)
    })
  }
}

/** Accept an invite link: add the current user to the trip's members. */
export async function joinTrip(tripId: string, uid: string): Promise<void> {
  await updateDoc(doc(trips, tripId), { members: arrayUnion(uid), updatedAt: Date.now() })
}
