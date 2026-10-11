// Per-day brief shown under the "第 X 天" title: a one-line summary of what the day is about and the
// major places it moves between. Everything is derived from the activities, so it stays in sync.

import { CATEGORY_META, type Activity, type Category } from './types'
import { distanceKm } from './utils'

/** One major place of the day; consecutive stops within SAME_AREA_KM (or with the same name) merge. */
export interface RouteStop {
  label: string
  /** Number of activities folded into this place. */
  count: number
  lat?: number
  lng?: number
  /** Straight-line distance from the previous stop, when both have coordinates. */
  hopKm?: number
}

export interface DayBrief {
  /** e.g. "機場 Check Out、台北飛往阿姆斯特丹" — empty when the day has no activities. */
  summary: string
  /** Category tally in display order, e.g. [['transport', 2], ['sight', 1]]. */
  tally: [Category, number][]
  /** Major places in time order. */
  route: RouteStop[]
}

/** Stops closer than this are the same area (a city and its suburbs, not a flight). */
export const SAME_AREA_KM = 15
/** A hop at least this long is shown with its distance. */
export const FAR_HOP_KM = 60

const MAX_HIGHLIGHTS = 3
/** Label cap in "cells": a CJK character is two, anything else one. */
const MAX_LABEL = 26
const SPLIT_RE = /\s*(?:→|->|➜|⇒|⟶)\s*/

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** "Terminal 2 of X" and "X" are the same place: one contains the other, or they share a long prefix. */
const samePlace = (a: string, b: string): boolean => {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y || x.includes(y) || y.includes(x)) return true
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  const shorter = Math.min(x.length, y.length)
  return i >= 4 && i >= shorter * 0.6
}

/** Shorten a place name for the header: drop address tails and cap the length. */
export const shortPlace = (s: string): string => {
  let t = s.trim().split(/[,，;；(（\n]/)[0].trim()
  // "Hallgrímskirkja - Reykjavík" → first part
  t = t.split(/\s[-–—|]\s/)[0].trim()
  let cells = 0
  for (let i = 0; i < t.length; i++) {
    cells += /[⺀-鿿가-힯豈-﫿＀-￯]/.test(t[i]) ? 2 : 1
    if (cells > MAX_LABEL) return t.slice(0, i).trimEnd() + '…'
  }
  return t
}

interface RawStop {
  name: string
  lat?: number
  lng?: number
}

type Geo = { lat: number; lng: number }
const geoOf = (s: { lat?: number; lng?: number }): Geo | null => (s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null)

/** Places an activity passes through: "A → B" transport yields both ends; otherwise its location. */
const stopsOf = (a: Activity): RawStop[] => {
  const loc = (a.location ?? '').trim()
  const geo = a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : {}
  if (!loc) return a.category === 'transport' && a.title.trim() ? [{ name: a.title }] : []
  const parts = loc.split(SPLIT_RE).filter(Boolean)
  if (parts.length >= 2) {
    // The coordinates of a "from → to" activity usually mark where it starts; the far end gets none.
    return [{ name: parts[0], ...geo }, { name: parts[parts.length - 1] }]
  }
  return [{ name: loc, ...geo }]
}

const sameArea = (stop: RouteStop, raw: RawStop): boolean => {
  const a = geoOf(stop)
  const b = geoOf(raw)
  if (a && b && distanceKm(a, b) <= SAME_AREA_KM) return true
  return samePlace(stop.label, raw.name)
}

/** Major places of the day in order. */
export const dayRoute = (activities: Activity[]): RouteStop[] => {
  const route: RouteStop[] = []
  for (const a of activities) {
    for (const raw of stopsOf(a)) {
      const last = route[route.length - 1]
      if (last && sameArea(last, raw)) {
        // Keep the shorter name: "桃園國際機場" over "桃園國際機場第二航廈".
        if (norm(raw.name).length < norm(last.label).length) last.label = raw.name
        if (last.lat == null && raw.lat != null) {
          last.lat = raw.lat
          last.lng = raw.lng
        }
        continue
      }
      const stop: RouteStop = { label: raw.name, count: 0, lat: raw.lat, lng: raw.lng }
      const from = last && geoOf(last)
      const to = geoOf(raw)
      if (from && to) stop.hopKm = distanceKm(from, to)
      route.push(stop)
    }
    // Count the activity against the place it ends at.
    const last = route[route.length - 1]
    if (last) last.count++
  }
  return route.map((s) => ({ ...s, label: shortPlace(s.label) }))
}

const HIGHLIGHT_ORDER: Category[] = ['sight', 'food', 'shopping', 'other', 'lodging', 'transport']

/** What the day is about: up to three titles, sights before meals before logistics, in time order. */
export const daySummary = (activities: Activity[]): string => {
  if (!activities.length) return ''
  const picked = new Set<Activity>()
  for (const cat of HIGHLIGHT_ORDER) {
    for (const a of activities) {
      if (picked.size >= MAX_HIGHLIGHTS) break
      if (a.category === cat && a.title.trim()) picked.add(a)
    }
    if (picked.size >= MAX_HIGHLIGHTS) break
  }
  const titles = activities.filter((a) => picked.has(a)).map((a) => shortPlace(a.title))
  const rest = activities.length - titles.length
  if (!titles.length) return `${activities.length} 項活動`
  return rest > 0 ? `${titles.join('、')} 等 ${activities.length} 項` : titles.join('、')
}

export const dayTally = (activities: Activity[]): [Category, number][] => {
  const counts = new Map<Category, number>()
  for (const a of activities) counts.set(a.category, (counts.get(a.category) ?? 0) + 1)
  return (Object.keys(CATEGORY_META) as Category[]).filter((c) => counts.has(c)).map((c) => [c, counts.get(c)!])
}

export const dayBrief = (activities: Activity[]): DayBrief => ({
  summary: daySummary(activities),
  tally: dayTally(activities),
  route: dayRoute(activities),
})

/** "1,234 km" / "85 km" for far hops. */
export const formatKm = (km: number): string => `${Math.round(km).toLocaleString()} km`
