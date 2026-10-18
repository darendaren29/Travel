// 分帳 arithmetic: who owes what, and the fewest transfers that settle it. Pure functions.

import type { Expense, Person, Trip } from './types'

/** One ink colour per traveller, by their position in the list; readable as a fill behind white text on both paper and night. */
export const PERSON_COLORS = ['#1f3d8f', '#b97300', '#2e7d4f', '#7b3fa0', '#c2185b', '#00796b', '#8d4a1e', '#4a5568']

export const personColor = (people: Person[] | undefined, id: string): string => {
  const i = (people ?? []).findIndex((p) => p.id === id)
  return PERSON_COLORS[(i < 0 ? PERSON_COLORS.length - 1 : i) % PERSON_COLORS.length]
}

/** Amounts are compared to the cent. */
const round2 = (n: number) => Math.round(n * 100) / 100
const EPS = 0.005

/**
 * What each participant owes for one expense. An equal split spreads the cents so the parts add up
 * to the total exactly; a custom split uses the given amounts (missing ones count as 0).
 */
export const shareOf = (e: Expense): Record<string, number> => {
  const out: Record<string, number> = {}
  const ids = e.participants.filter((id, i, arr) => arr.indexOf(id) === i)
  if (!ids.length || !(e.amount > 0)) return out
  if (e.shares) {
    for (const id of ids) out[id] = round2(Math.max(0, e.shares[id] ?? 0))
    return out
  }
  const cents = Math.round(e.amount * 100)
  const base = Math.floor(cents / ids.length)
  let rest = cents - base * ids.length
  for (const id of ids) {
    out[id] = (base + (rest > 0 ? 1 : 0)) / 100
    if (rest > 0) rest--
  }
  return out
}

/** Currencies offered in the picker; the trip's own and any already used are added at the top. */
export const COMMON_CURRENCIES = ['TWD', 'JPY', 'USD', 'EUR', 'KRW', 'CNY', 'HKD', 'THB', 'GBP', 'SGD', 'AUD', 'VND']

/** Trip currency per unit of the expense's currency (1 when they are the same or no rate was given). */
export const rateOf = (e: Pick<Expense, 'currency' | 'rate'>, tripCurrency: string): number =>
  e.currency && e.currency !== tripCurrency && e.rate && e.rate > 0 ? e.rate : 1

/** The expense's amount in the trip currency. */
export const amountInBase = (e: Expense, tripCurrency: string): number => round2(e.amount * rateOf(e, tripCurrency))

/** Each participant's share in the trip currency. */
export const sharesInBase = (e: Expense, tripCurrency: string): Record<string, number> => {
  const r = rateOf(e, tripCurrency)
  if (r === 1) return shareOf(e)
  // Convert the custom shares one by one; an equal split is re-spread on the converted total so it still adds up.
  if (e.shares) return Object.fromEntries(Object.entries(shareOf(e)).map(([id, v]) => [id, round2(v * r)]))
  return shareOf({ ...e, amount: amountInBase(e, tripCurrency), shares: undefined })
}

export interface Balance {
  person: Person
  /** Paid for the group (expenses only). */
  paid: number
  /** Own share of the group's expenses. */
  share: number
  /** Repayments made (transfers paid) minus repayments received. */
  transferred: number
  /** paid − share + transferred: positive is owed money, negative owes. */
  net: number
}

/** Per-person totals over every expense and transfer of the trip. */
export const balances = (trip: Trip): Balance[] => {
  const people = trip.people ?? []
  const by = new Map(people.map((p) => [p.id, { person: p, paid: 0, share: 0, transferred: 0, net: 0 } as Balance]))
  for (const e of trip.expenses ?? []) {
    if (!(e.amount > 0)) continue
    const amount = amountInBase(e, trip.currency)
    if (e.kind === 'transfer') {
      const from = by.get(e.paidBy)
      const to = by.get(e.participants[0])
      if (from) from.transferred += amount
      if (to) to.transferred -= amount
      continue
    }
    const payer = by.get(e.paidBy)
    if (payer) payer.paid += amount
    for (const [id, amt] of Object.entries(sharesInBase(e, trip.currency))) {
      const b = by.get(id)
      if (b) b.share += amt
    }
  }
  for (const b of by.values()) {
    b.paid = round2(b.paid)
    b.share = round2(b.share)
    b.transferred = round2(b.transferred)
    b.net = round2(b.paid - b.share + b.transferred)
  }
  return [...by.values()]
}

export interface Settlement {
  from: Person
  to: Person
  amount: number
}

/**
 * Transfers that bring every balance to zero, greedily pairing the biggest debtor with the biggest
 * creditor; this uses at most (people − 1) transfers.
 */
export const settlements = (bals: Balance[]): Settlement[] => {
  const debtors = bals.filter((b) => b.net < -EPS).map((b) => ({ person: b.person, left: -b.net }))
  const creditors = bals.filter((b) => b.net > EPS).map((b) => ({ person: b.person, left: b.net }))
  debtors.sort((a, b) => b.left - a.left)
  creditors.sort((a, b) => b.left - a.left)
  const out: Settlement[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]
    const c = creditors[j]
    const amount = round2(Math.min(d.left, c.left))
    if (amount > EPS) out.push({ from: d.person, to: c.person, amount })
    d.left = round2(d.left - amount)
    c.left = round2(c.left - amount)
    if (d.left <= EPS) i++
    if (c.left <= EPS) j++
  }
  return out
}

/** Total of the group's expenses (transfers are not spending). */
export const totalSpent = (trip: Trip): number =>
  round2((trip.expenses ?? []).filter((e) => e.kind === 'expense' && e.amount > 0).reduce((s, e) => s + amountInBase(e, trip.currency), 0))

/** Plain-text summary to paste into a chat. */
export const summaryText = (trip: Trip, money: (n: number) => string): string => {
  const bals = balances(trip)
  const lines = [`【${trip.name}】分帳摘要`, `總支出 ${money(totalSpent(trip))}，${bals.length} 人`, '']
  for (const b of bals) lines.push(`${b.person.name}：付了 ${money(b.paid)}，應付 ${money(b.share)}，${b.net > EPS ? `應收 ${money(b.net)}` : b.net < -EPS ? `應付 ${money(-b.net)}` : '已結清'}`)
  const s = settlements(bals)
  lines.push('', s.length ? '結清方式：' : '大家都結清了 🎉')
  for (const t of s) lines.push(`${t.from.name} → ${t.to.name} ${money(t.amount)}`)
  return lines.join('\n')
}
