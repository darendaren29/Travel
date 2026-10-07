import { useEffect } from 'react'
import { useCurrentTrip, useStore } from './store'
import { useGooglePlaces } from './places'
import { computeLeg, dayLegs } from './routes'
import { dayActivities } from './utils'
import type { Leg } from './types'

const inflight = new Set<string>()
/** Legs that failed recently; retried after this long so a transit gap doesn't spam the API. */
const failed = new Map<string, number>()
const RETRY_MS = 10 * 60 * 1000
const CONCURRENCY = 3
const DEBOUNCE_MS = 800

/**
 * Keeps the current trip's leg cache filled: whenever two consecutive stops of a day both have
 * coordinates and no cached leg for the trip's travel mode, fetch it from the Routes API.
 */
export function useRouteSync() {
  const trip = useCurrentTrip()
  const addLegs = useStore((s) => s.addLegs)
  const setRouting = useStore((s) => s.setRouting)
  const enabled = useGooglePlaces(trip.destination)

  useEffect(() => {
    if (!enabled) return
    const timer = setTimeout(async () => {
      const now = Date.now()
      const queue = trip.days.flatMap((_, dayIndex) =>
        dayLegs(trip, dayActivities(trip, dayIndex))
          .filter((l) => !l.leg && !inflight.has(l.key) && (failed.get(l.key) ?? 0) < now - RETRY_MS)
          .map((l) => ({ ...l, dayIndex })),
      )
      if (queue.length === 0) return

      setRouting('loading')
      const results: Record<string, Leg> = {}
      let error: string | null = null
      queue.forEach((q) => inflight.add(q.key))
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
          for (let item = queue.shift(); item; item = queue.shift()) {
            try {
              results[item.key] = await computeLeg(trip, item.dayIndex, item.from, item.to)
              failed.delete(item.key)
            } catch (e) {
              error = e instanceof Error ? e.message : String(e)
              failed.set(item.key, Date.now())
            } finally {
              inflight.delete(item.key)
            }
          }
        }),
      )
      // Only write if the user is still on the same trip.
      if (Object.keys(results).length && useStore.getState().currentTripId === trip.id) addLegs(results)
      setRouting(error ? 'error' : 'idle', error)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [trip, enabled, addLegs, setRouting])
}
