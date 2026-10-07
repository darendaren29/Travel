import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Activity, AuthUser, Leg, Trip } from './types'
import { sampleTrip } from './sample'
import { duration, longId, toMinutes, toTime, uid } from './utils'
import type { BasemapKey } from './basemaps'

export type View = 'board' | 'map' | 'budget'
export type SyncState = 'off' | 'syncing' | 'synced' | 'error'
export type RoutingState = 'idle' | 'loading' | 'error'

/** Keep the route cache bounded; oldest legs are dropped first. */
const MAX_LEGS = 300
/** Default gap inserted between stops when re-ordering a day (minutes). */
const REORDER_GAP_MIN = 30

interface State {
  trips: Trip[]
  currentTripId: string
  view: View
  basemap: BasemapKey
  selectedActivityId: string | null
  /** When set, the next map click assigns coordinates to this activity. */
  pickingLocationFor: string | null

  user: AuthUser | null
  syncState: SyncState
  syncError: string | null
  /** Trip id from an invite link, waiting for the user to sign in. */
  pendingJoin: string | null
  routing: RoutingState
  routingError: string | null

  setView: (v: View) => void
  setBasemap: (b: BasemapKey) => void
  select: (id: string | null) => void
  setPickingLocation: (id: string | null) => void
  setUser: (u: AuthUser | null) => void
  setSyncState: (s: SyncState, error?: string | null) => void
  setPendingJoin: (id: string | null) => void
  setRouting: (s: RoutingState, error?: string | null) => void

  // routes
  /** Merge computed legs into the current trip's cache. */
  addLegs: (legs: Record<string, Leg>) => void
  /** Push activities later so each starts no earlier than previous end + travel minutes (never earlier). */
  retimeDay: (dayIndex: number, travelMinutes: number[]) => void
  /** Apply a new visiting order to a day; times are re-chained from the first stop. */
  reorderDay: (dayIndex: number, orderedIds: string[]) => void

  // trips
  createTrip: (partial?: Partial<Trip>) => void
  switchTrip: (id: string) => void
  deleteTrip: (id: string) => void
  updateTrip: (patch: Partial<Omit<Trip, 'id' | 'days' | 'activities'>>) => void
  importTrip: (trip: Trip) => void
  /** Replace the current trip's content (days, activities, metadata) keeping its id/ownership. */
  replaceCurrentTrip: (content: Trip) => void
  addDay: () => void
  removeDay: (index: number) => void

  // cloud sync helpers (called by sync.ts)
  /** Give every local-only trip to `uid` (new id, owner, members). Untouched sample trip is dropped. */
  adoptLocalTrips: (uid: string) => void
  /** Merge a remote snapshot in; `removable` are ids we previously received from remote. */
  applyRemoteTrips: (remote: Trip[], removable: Set<string>) => void
  /** Forget everything local (after sign-out). */
  resetLocal: () => void

  // activities
  addActivity: (dayIndex: number, partial?: Partial<Activity>) => string
  updateActivity: (id: string, patch: Partial<Activity>) => void
  deleteActivity: (id: string) => void
  /** Move an activity to a day at a given position, re-timing it to follow its new predecessor. */
  moveActivity: (id: string, toDayIndex: number, toIndex: number) => void
  duplicateActivity: (id: string) => void
}

const ownerFields = (user: AuthUser | null): Partial<Trip> =>
  user ? { ownerId: user.uid, members: [user.uid] } : {}

const emptyTrip = (partial: Partial<Trip> = {}): Trip => ({
  id: longId(),
  name: '新的旅程',
  destination: '',
  startDate: new Date().toISOString().slice(0, 10),
  currency: 'TWD',
  budget: 0,
  days: [{ id: uid(), activityIds: [] }],
  activities: {},
  updatedAt: Date.now(),
  ...partial,
})

const sortDay = (trip: Trip, dayIndex: number) => {
  const day = trip.days[dayIndex]
  day.activityIds.sort(
    (a, b) => toMinutes(trip.activities[a].start) - toMinutes(trip.activities[b].start),
  )
}

const findDayIndex = (trip: Trip, activityId: string): number =>
  trip.days.findIndex((d) => d.activityIds.includes(activityId))

/** Deep-ish clone sufficient for our plain-object trip. */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const mutate = (fn: (trip: Trip) => void) =>
        set((s) => {
          const trips = s.trips.map((t) => {
            if (t.id !== s.currentTripId) return t
            const next = clone(t)
            fn(next)
            next.updatedAt = Date.now()
            return next
          })
          return { trips }
        })

      return {
        trips: [sampleTrip],
        currentTripId: sampleTrip.id,
        view: 'board',
        basemap: 'auto',
        selectedActivityId: null,
        pickingLocationFor: null,
        user: null,
        syncState: 'off',
        syncError: null,
        pendingJoin: null,
        routing: 'idle',
        routingError: null,

        setView: (view) => set({ view }),
        setBasemap: (basemap) => set({ basemap }),
        select: (selectedActivityId) => set({ selectedActivityId }),
        setPickingLocation: (pickingLocationFor) => set({ pickingLocationFor }),
        setUser: (user) => set({ user }),
        setSyncState: (syncState, syncError = null) => set({ syncState, syncError }),
        setPendingJoin: (pendingJoin) => set({ pendingJoin }),
        setRouting: (routing, routingError = null) => set({ routing, routingError }),

        addLegs: (legs) =>
          mutate((t) => {
            const merged = { ...(t.legs ?? {}), ...legs }
            const keys = Object.keys(merged)
            if (keys.length > MAX_LEGS) {
              keys
                .sort((a, b) => merged[a].fetchedAt - merged[b].fetchedAt)
                .slice(0, keys.length - MAX_LEGS)
                .forEach((k) => delete merged[k])
            }
            t.legs = merged
          }),
        retimeDay: (dayIndex, travelMinutes) =>
          mutate((t) => {
            const day = t.days[dayIndex]
            if (!day) return
            for (let i = 1; i < day.activityIds.length; i++) {
              const prev = t.activities[day.activityIds[i - 1]]
              const cur = t.activities[day.activityIds[i]]
              if (!prev || !cur) continue
              const minStart = toMinutes(prev.end) + (travelMinutes[i] ?? 0)
              const shift = minStart - toMinutes(cur.start)
              if (shift <= 0) continue
              const dur = duration(cur)
              cur.start = toTime(minStart)
              cur.end = toTime(minStart + dur)
            }
          }),
        reorderDay: (dayIndex, orderedIds) =>
          mutate((t) => {
            const day = t.days[dayIndex]
            if (!day) return
            const same = orderedIds.length === day.activityIds.length && orderedIds.every((id) => day.activityIds.includes(id))
            if (!same) return
            day.activityIds = [...orderedIds]
            for (let i = 1; i < day.activityIds.length; i++) {
              const prev = t.activities[day.activityIds[i - 1]]
              const cur = t.activities[day.activityIds[i]]
              const dur = duration(cur)
              const start = toMinutes(prev.end) + REORDER_GAP_MIN
              cur.start = toTime(start)
              cur.end = toTime(start + dur)
            }
          }),

        createTrip: (partial) => {
          const trip = emptyTrip({ ...ownerFields(get().user), ...partial })
          set((s) => ({ trips: [...s.trips, trip], currentTripId: trip.id, selectedActivityId: null }))
        },
        switchTrip: (id) => set({ currentTripId: id, selectedActivityId: null, pickingLocationFor: null }),
        deleteTrip: (id) =>
          set((s) => {
            const trips = s.trips.filter((t) => t.id !== id)
            if (trips.length === 0) trips.push(emptyTrip(ownerFields(s.user)))
            const currentTripId = s.currentTripId === id ? trips[0].id : s.currentTripId
            return { trips, currentTripId, selectedActivityId: null }
          }),
        updateTrip: (patch) => mutate((t) => Object.assign(t, patch)),
        importTrip: (trip) => {
          const { ownerId: _o, members: _m, allowJoin: _j, ...rest } = clone(trip)
          void _o
          void _m
          void _j
          const incoming: Trip = { ...rest, id: longId(), updatedAt: Date.now(), ...ownerFields(get().user) }
          set((s) => ({ trips: [...s.trips, incoming], currentTripId: incoming.id, selectedActivityId: null }))
        },
        replaceCurrentTrip: (content) => {
          mutate((t) => {
            const { id: _id, ownerId: _o, members: _m, allowJoin: _j, updatedAt: _u, ...rest } = clone(content)
            void _id
            void _o
            void _m
            void _j
            void _u
            Object.assign(t, rest)
          })
          set({ selectedActivityId: null })
        },
        addDay: () => mutate((t) => t.days.push({ id: uid(), activityIds: [] })),
        removeDay: (index) =>
          mutate((t) => {
            if (t.days.length <= 1) return
            const [removed] = t.days.splice(index, 1)
            removed.activityIds.forEach((id) => delete t.activities[id])
          }),

        adoptLocalTrips: (userId) =>
          set((s) => {
            let currentTripId = s.currentTripId
            const trips = s.trips.map((t) => {
              // The untouched sample stays local for now: applyRemoteTrips decides whether
              // this user already has cloud trips (drop it) or is brand new (adopt it).
              if (t.ownerId || (t.id === sampleTrip.id && !t.updatedAt)) return t
              const adopted: Trip = { ...t, id: longId(), ownerId: userId, members: [userId], updatedAt: Date.now() }
              if (t.id === currentTripId) currentTripId = adopted.id
              return adopted
            })
            return { trips, currentTripId }
          }),

        applyRemoteTrips: (remote, removable) =>
          set((s) => {
            const remoteById = new Map(remote.map((t) => [t.id, t]))
            const kept: Trip[] = []
            for (const local of s.trips) {
              const r = remoteById.get(local.id)
              if (r) {
                // Remote newer → take it; otherwise keep local edits but adopt the member list
                // so a collaborator who just joined is not overwritten by our next write.
                if ((r.updatedAt ?? 0) > (local.updatedAt ?? 0)) kept.push(r)
                else if (r.members && r.members.join() !== (local.members ?? []).join()) kept.push({ ...local, members: r.members })
                else kept.push(local)
                remoteById.delete(local.id)
              } else if (local.ownerId && removable.has(local.id)) {
                continue // deleted remotely, or we were removed from it
              } else if (!local.ownerId && local.id === sampleTrip.id && !local.updatedAt) {
                // Untouched sample: a returning user already has trips → drop it;
                // a brand-new user gets it as their first cloud trip.
                if (remote.length > 0 || !s.user) continue
                kept.push({ ...local, id: longId(), ...ownerFields(s.user), updatedAt: Date.now() })
              } else {
                kept.push(local)
              }
            }
            remoteById.forEach((t) => kept.push(t))
            if (kept.length === 0) kept.push(emptyTrip(ownerFields(s.user)))
            const currentTripId = kept.some((t) => t.id === s.currentTripId) ? s.currentTripId : kept[0].id
            return { trips: kept, currentTripId }
          }),

        resetLocal: () => {
          const trip = emptyTrip()
          set({ trips: [trip], currentTripId: trip.id, selectedActivityId: null, pickingLocationFor: null })
        },

        addActivity: (dayIndex, partial = {}) => {
          const id = uid()
          mutate((t) => {
            const day = t.days[dayIndex]
            if (!day) return
            const last = day.activityIds.at(-1)
            const start = partial.start ?? (last ? t.activities[last].end : '09:00')
            const end = partial.end ?? toTime(toMinutes(start) + 90)
            t.activities[id] = {
              id,
              title: '新活動',
              category: 'sight',
              cost: 0,
              ...partial,
              start,
              end,
            }
            day.activityIds.push(id)
            sortDay(t, dayIndex)
          })
          set({ selectedActivityId: id })
          return id
        },
        updateActivity: (id, patch) =>
          mutate((t) => {
            const a = t.activities[id]
            if (!a) return
            Object.assign(a, patch)
            // keep end >= start
            if (toMinutes(a.end) < toMinutes(a.start)) a.end = a.start
            const di = findDayIndex(t, id)
            if (di >= 0) sortDay(t, di)
          }),
        deleteActivity: (id) => {
          mutate((t) => {
            delete t.activities[id]
            t.days.forEach((d) => (d.activityIds = d.activityIds.filter((x) => x !== id)))
          })
          if (get().selectedActivityId === id) set({ selectedActivityId: null })
        },
        moveActivity: (id, toDayIndex, toIndex) =>
          mutate((t) => {
            const a = t.activities[id]
            const target = t.days[toDayIndex]
            if (!a || !target) return
            t.days.forEach((d) => (d.activityIds = d.activityIds.filter((x) => x !== id)))
            const idx = Math.max(0, Math.min(toIndex, target.activityIds.length))
            target.activityIds.splice(idx, 0, id)

            // Re-time: follow the predecessor (or start the day at 09:00), keep duration.
            const dur = duration(a)
            const prevId = target.activityIds[idx - 1]
            const nextId = target.activityIds[idx + 1]
            let start = prevId ? toMinutes(t.activities[prevId].end) : toMinutes('09:00')
            if (!prevId && nextId) {
              // Dropped first: place it before the next item if it fits.
              start = Math.min(start, Math.max(0, toMinutes(t.activities[nextId].start) - dur))
            }
            a.start = toTime(start)
            a.end = toTime(start + dur)
            sortDay(t, toDayIndex)
          }),
        duplicateActivity: (id) => {
          const trip = get().trips.find((t) => t.id === get().currentTripId)
          if (!trip) return
          const di = findDayIndex(trip, id)
          const src = trip.activities[id]
          if (di < 0 || !src) return
          const { id: _omit, ...rest } = src
          void _omit
          get().addActivity(di, { ...rest, start: src.end, end: toTime(toMinutes(src.end) + duration(src)) })
        },
      }
    },
    {
      name: 'travel-planner-v1',
      partialize: (s) => ({ trips: s.trips, currentTripId: s.currentTripId, view: s.view, basemap: s.basemap }),
    },
  ),
)

export const useCurrentTrip = (): Trip =>
  useStore((s) => s.trips.find((t) => t.id === s.currentTripId) ?? s.trips[0])
