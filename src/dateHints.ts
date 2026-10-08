/** Dates mentioned in free text ("10/16", "10月20日"), resolved against a trip's start year. */
export interface DateSpan {
  first: string
  last: string
  /** Inclusive day count from first to last. */
  days: number
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const DAY_MS = 86_400_000

export function datesInText(text: string, startDate: string): DateSpan | null {
  const base = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(base.getTime())) return null
  const found: Date[] = []
  const add = (m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return
    let dt = new Date(base.getFullYear(), m - 1, d)
    if (dt.getMonth() !== m - 1) return // e.g. 2/30
    // A date well before the start (e.g. "1/5" for a December trip) means next year.
    if (dt.getTime() < base.getTime() - 60 * DAY_MS) dt = new Date(base.getFullYear() + 1, m - 1, d)
    found.push(dt)
  }
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) add(Number(m[1]), Number(m[2]))
  for (const m of text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日號号]?/g)) add(Number(m[1]), Number(m[2]))
  if (!found.length) return null
  found.sort((a, b) => a.getTime() - b.getTime())
  const first = found[0]
  const last = found[found.length - 1]
  return { first: iso(first), last: iso(last), days: Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1 }
}

/** A span worth suggesting: it doesn't match the current start date / length. */
export function spanMismatch(span: DateSpan | null, startDate: string, days: number): boolean {
  if (!span) return false
  return span.first !== startDate || span.days !== days
}
