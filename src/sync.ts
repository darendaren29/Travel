import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db, firebaseConfig } from './firebase'
import { useStore } from './store'
import type { Trip } from './types'
import { deleteTripFile } from './files'
import { isTrip } from './share'

const trips = collection(db, 'trips')
const shares = collection(db, 'shares')
const WRITE_DEBOUNCE_MS = 600
/** Firestore documents max out at 1 MiB; above this the route cache is left out of the write. */
const MAX_DOC_BYTES = 900_000

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The document write for a trip. `members` goes through arrayUnion so a stale local copy can never
 * drop a collaborator who joined meanwhile; `legs` is a cache and is dropped when the document would
 * be too big.
 */
const tripWrite = (trip: Trip): Record<string, unknown> => {
  const { members, legs, ...rest } = trip
  const big = JSON.stringify(trip).length > MAX_DOC_BYTES
  return {
    ...rest,
    ...(members?.length ? { members: arrayUnion(...members) } : {}),
    legs: big || !legs ? deleteField() : legs,
  }
}

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
  /** Ids removed by the server (deleted, or we were removed): no delete/leave write for those. */
  const removedRemotely = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  setSyncState('syncing')
  adoptLocalTrips(uid)

  const flush = (id: string) => {
    timers.delete(id)
    const trip = store.getState().trips.find((t) => t.id === id)
    if (!trip || !trip.ownerId) return
    known.set(id, trip.updatedAt ?? 0)
    const ref = doc(trips, id)
    const write = seenRemote.has(id)
      ? updateDoc(ref, tripWrite(trip)).catch((e: { code?: string }) => {
          // Created on another device and not seen here yet, or not created at all.
          if (e.code === 'not-found') return setDoc(ref, { ...trip, legs: trip.legs ?? {} })
          throw e
        })
      : setDoc(ref, trip)
    write.catch((e) => setSyncState('error', errMsg(e)))
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
      const ids = new Set(remote.map((t) => t.id))
      // Gone from the server: applyRemoteTrips will drop them locally; that drop must not be
      // mistaken for a local delete (which would try to write to a document we can't touch).
      seenRemote.forEach((id) => !ids.has(id) && removedRemotely.add(id))
      remote.forEach((t) => {
        known.set(t.id, t.updatedAt ?? 0)
        seenRemote.add(t.id)
      })
      store.getState().applyRemoteTrips(remote, seenRemote)
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
      if (removedRemotely.delete(t.id)) continue
      const existing = timers.get(t.id)
      if (existing) clearTimeout(existing)
      timers.delete(t.id)
      known.delete(t.id)
      const ref = doc(trips, t.id)
      if (t.ownerId === uid) {
        // Remove the trip's files first: Storage rules check membership on the trip document.
        Promise.allSettled(Object.values(t.docs ?? {}).map(deleteTripFile))
          .then(() => deleteDoc(ref))
          .catch((e) => setSyncState('error', errMsg(e)))
      } else {
        updateDoc(ref, { members: arrayRemove(uid), updatedAt: Date.now() }).catch((e) => setSyncState('error', errMsg(e)))
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

// ---------------------------------------------------------------------------
// Share links: a snapshot anyone with the short link can open as their own copy
// ---------------------------------------------------------------------------

/** What a share snapshot contains: the itinerary without ownership, collaborators, ticket files or the route cache. */
export function shareCopy(trip: Trip): Trip {
  const { ownerId: _o, members: _m, allowJoin: _j, docs: _d, shareId: _s, legs: _l, ...rest } = trip
  void _o, void _m, void _j, void _d, void _s, void _l
  return rest
}

const randomId = (len: number) => {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => abc[b % abc.length]).join('')
}

/** Publish (or refresh) the share snapshot of `trip`; returns its id. Rules: anyone may read, only the creator may write. */
export async function publishShare(trip: Trip, uid: string): Promise<string> {
  const id = trip.shareId ?? randomId(12)
  await setDoc(doc(shares, id), { trip: shareCopy(trip), createdBy: uid, updatedAt: Date.now() })
  return id
}

type FsValue = Record<string, unknown>

/** Decode a Firestore REST value into plain JSON. */
const decodeFs = (v: FsValue): unknown => {
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('timestampValue' in v) return v.timestampValue
  if ('mapValue' in v) {
    const fields = ((v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {}) as Record<string, FsValue>
    return Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, decodeFs(x)]))
  }
  if ('arrayValue' in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(decodeFs)
  return null
}

/** Network trouble while opening a share (as opposed to "no such share"). */
export class ShareOfflineError extends Error {}
export class ShareForbiddenError extends Error {}

/**
 * Read a share snapshot (no sign-in needed). Uses the plain Firestore REST API rather than the SDK's
 * streaming connection, which some phones / in-app browsers can't open ("client is offline").
 * Retries a few times; resolves null when the share doesn't exist.
 */
export async function fetchShare(id: string): Promise<Trip | null> {
  const { projectId, apiKey } = firebaseConfig
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/shares/${encodeURIComponent(id)}?key=${apiKey}`
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 404) return null
      if (res.status === 403) throw new ShareForbiddenError('沒有讀取權限（分享規則尚未部署）')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { fields?: Record<string, FsValue> }
      const data = decodeFs({ mapValue: { fields: body.fields ?? {} } }) as { trip?: unknown }
      return isTrip(data.trip) ? data.trip : null
    } catch (e) {
      if (e instanceof ShareForbiddenError) throw e
      last = e
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  throw new ShareOfflineError(errMsg(last))
}
