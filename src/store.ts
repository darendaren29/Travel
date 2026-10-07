import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Activity, Trip } from './types'
import { sampleTrip } from './sample'
import { duration, toMinutes, toTime, uid } from './utils'

export type View = 'board' | 'map' | 'budget'

interface State {
  trips: Trip[]
  currentTripId: string
  view: View
  selectedActivityId: string | null
  /** When set, the next map click assigns coordinates to this activity. */
  pickingLocationFor: string | null

  setView: (v: View) => void
  select: (id: string | null) => void
  setPickingLocation: (id: string | null) => void

  // trips
  createTrip: (partial?: Partial<Trip>) => void
  switchTrip: (id: string) => void
  deleteTrip: (id: string) => void
  updateTrip: (patch: Partial<Omit<Trip, 'id' | 'days' | 'activities'>>) => void
  importTrip: (trip: Trip) => void
  addDay: () => void
  removeDay: (index: number) => void

  // activities
  addActivity: (dayIndex: number, partial?: Partial<Activity>) => string
  updateActivity: (id: string, patch: Partial<Activity>) => void
  deleteActivity: (id: string) => void
  /** Move an activity to a day at a given position, re-timing it to follow its new predecessor. */
  moveActivity: (id: string, toDayIndex: number, toIndex: number) => void
  duplicateActivity: (id: string) => void
}

const emptyTrip = (partial: Partial<Trip> = {}): Trip => ({
  id: uid(),
  name: '新的旅程',
  destination: '',
  startDate: new Date().toISOString().slice(0, 10),
  currency: 'TWD',
  budget: 0,
  days: [{ id: uid(), activityIds: [] }],
  activities: {},
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
            return next
          })
          return { trips }
        })

      return {
        trips: [sampleTrip],
        currentTripId: sampleTrip.id,
        view: 'board',
        selectedActivityId: null,
        pickingLocationFor: null,

        setView: (view) => set({ view }),
        select: (selectedActivityId) => set({ selectedActivityId }),
        setPickingLocation: (pickingLocationFor) => set({ pickingLocationFor }),

        createTrip: (partial) => {
          const trip = emptyTrip(partial)
          set((s) => ({ trips: [...s.trips, trip], currentTripId: trip.id, selectedActivityId: null }))
        },
        switchTrip: (id) => set({ currentTripId: id, selectedActivityId: null, pickingLocationFor: null }),
        deleteTrip: (id) =>
          set((s) => {
            const trips = s.trips.filter((t) => t.id !== id)
            if (trips.length === 0) trips.push(emptyTrip())
            const currentTripId = s.currentTripId === id ? trips[0].id : s.currentTripId
            return { trips, currentTripId, selectedActivityId: null }
          }),
        updateTrip: (patch) => mutate((t) => Object.assign(t, patch)),
        importTrip: (trip) => {
          const incoming = { ...clone(trip), id: uid() }
          set((s) => ({ trips: [...s.trips, incoming], currentTripId: incoming.id, selectedActivityId: null }))
        },
        addDay: () => mutate((t) => t.days.push({ id: uid(), activityIds: [] })),
        removeDay: (index) =>
          mutate((t) => {
            if (t.days.length <= 1) return
            const [removed] = t.days.splice(index, 1)
            removed.activityIds.forEach((id) => delete t.activities[id])
          }),

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
      partialize: (s) => ({ trips: s.trips, currentTripId: s.currentTripId, view: s.view }),
    },
  ),
)

export const useCurrentTrip = (): Trip =>
  useStore((s) => s.trips.find((t) => t.id === s.currentTripId) ?? s.trips[0])
