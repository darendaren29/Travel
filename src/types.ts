export type Category = 'sight' | 'food' | 'transport' | 'lodging' | 'shopping' | 'other'

export interface Activity {
  id: string
  title: string
  category: Category
  /** "HH:MM" 24h */
  start: string
  /** "HH:MM" 24h */
  end: string
  location?: string
  lat?: number
  lng?: number
  cost: number
  notes?: string
  /** Google Places photo resource name (places/…/photos/…), rendered via photoUrl(). */
  photo?: string
}

export type TravelMode = 'TRANSIT' | 'WALK' | 'DRIVE' | 'BICYCLE'

export const TRAVEL_MODES: Record<TravelMode, { label: string; icon: string }> = {
  TRANSIT: { label: '大眾運輸', icon: '🚇' },
  WALK: { label: '步行', icon: '🚶' },
  DRIVE: { label: '開車', icon: '🚗' },
  BICYCLE: { label: '單車', icon: '🚲' },
}

/** A computed route between two consecutive stops (Google Routes API), cached on the trip. */
export interface Leg {
  mode: TravelMode
  durationSec: number
  distanceM: number
  /** Encoded polyline of the actual path. */
  polyline: string
  fetchedAt: number
}

export interface Day {
  id: string
  activityIds: string[]
}

/** One 備用景點 block. */
export interface SpareGroup {
  id: string
  name: string
  activityIds: string[]
}

/** Id of the block a trip's legacy `spare` list becomes, and of the block shown while a trip has none. */
export const DEFAULT_SPARE_GROUP = 'spare-default'
export const DEFAULT_SPARE_NAME = '備用景點'

export interface Trip {
  id: string
  name: string
  destination: string
  /** YYYY-MM-DD */
  startDate: string
  currency: string
  budget: number
  days: Day[]
  activities: Record<string, Activity>
  /**
   * 備用景點 (legacy, single list): ids of activities kept aside without a time slot. Newer trips
   * use `spareGroups`; a trip with only `spare` is read as one group named 備用景點.
   */
  spare?: string[]
  /**
   * 備用景點 blocks: named groups (a region, a country, a date range…) of activities kept aside
   * without a time slot (their start/end are ''). They sit in `activities` like any other but in
   * no day, and can be dragged into one when the plan changes.
   */
  spareGroups?: SpareGroup[]
  /** Cloud fields — present once the trip is stored in Firestore. */
  ownerId?: string
  members?: string[]
  allowJoin?: boolean
  /** Id of this trip's public share snapshot (shares/{shareId}), once one was published. */
  shareId?: string
  /** Epoch ms of the last local edit; used for last-write-wins sync. */
  updatedAt?: number
  /** How we travel between stops (default TRANSIT). */
  travelMode?: TravelMode
  /** Route cache keyed by legKey(mode, from, to). */
  legs?: Record<string, Leg>
  /** Uploaded tickets / bookings (files live in Firebase Storage). */
  docs?: Record<string, TripDoc>
  /** 分帳: the travellers money is split between (not tied to accounts). */
  people?: Person[]
  /** 分帳: who paid what, shared by whom; plus settlement transfers. */
  expenses?: Expense[]
  /** 分帳: last used exchange rate per foreign currency (1 unit = `rate` trip currency), prefilled for the next expense. */
  rates?: Record<string, number>
}

/** A traveller in the 分帳 (bill splitting); a plain name, so people without an account count too. */
export interface Person {
  id: string
  name: string
}

/**
 * One shared cost (`kind: 'expense'`) or one repayment (`kind: 'transfer'`, paid by the debtor to
 * the single participant). Amounts are in `currency` when set, else the trip currency; `rate`
 * converts them for the balances, which are always in the trip currency.
 */
export interface Expense {
  id: string
  kind: 'expense' | 'transfer'
  title: string
  amount: number
  /** Currency of `amount` and `shares`; absent = trip currency. */
  currency?: string
  /** 1 unit of `currency` in trip currency; required when `currency` differs from the trip's. */
  rate?: number
  /** Person who paid. */
  paidBy: string
  /** Who shares the cost (an expense) or who received the money (a transfer: exactly one). */
  participants: string[]
  /** Custom amounts per participant; absent = split equally. */
  shares?: Record<string, number>
  /** YYYY-MM-DD */
  date: string
  category: Category
  note?: string
  /** Activity this came from, when added from the itinerary. */
  activityId?: string
  createdAt: number
}

export type DocKind = 'flight' | 'lodging' | 'ticket' | 'other'

export const DOC_KINDS: Record<DocKind, { label: string; icon: string }> = {
  flight: { label: '機票 / 交通', icon: '✈️' },
  lodging: { label: '住宿', icon: '🏨' },
  ticket: { label: '門票', icon: '🎟️' },
  other: { label: '其他', icon: '📎' },
}

export interface TripDoc {
  id: string
  /** Original file name shown to users. */
  name: string
  kind: DocKind
  /** Firebase Storage object path. */
  path: string
  size: number
  contentType: string
  uploadedAt: number
  uploadedBy?: string
  /** Optional link to an activity in this trip. */
  activityId?: string
}

export interface AuthUser {
  uid: string
  name: string
  email: string
  photo?: string
}

export const CATEGORY_META: Record<Category, { label: string; color: string; icon: string }> = {
  // Palette validated for CVD separation and contrast in light & dark mode (order matters).
  sight: { label: '景點', color: '#2563eb', icon: '🏛️' },
  food: { label: '餐飲', color: '#d97706', icon: '🍜' },
  transport: { label: '交通', color: '#9333ea', icon: '🚆' },
  lodging: { label: '住宿', color: '#0891b2', icon: '🏨' },
  shopping: { label: '購物', color: '#e11d48', icon: '🛍️' },
  other: { label: '其他', color: '#4d7c0f', icon: '📌' },
}

export const CATEGORIES = Object.keys(CATEGORY_META) as Category[]

export const DAY_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]
