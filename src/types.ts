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
}

export interface Day {
  id: string
  activityIds: string[]
}

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
