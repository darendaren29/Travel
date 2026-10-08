import { FunctionsError, httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { CLAUDE_DAILY_LIMIT, CLAUDE_DAY_DAILY_LIMIT, type AiDay, type AiTrip, type DayRequest, type ItineraryRequest } from './aiPrompt'
import { CATEGORIES, type Activity, type Category, type Trip } from './types'
import { longId, toMinutes, toTime, uid } from './utils'

export type { ItineraryRequest, AiTrip } from './aiPrompt'

// All AI runs on Claude through the claudeItinerary Cloud Function (functions/src/index.ts); the
// Anthropic API key never reaches the browser.

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Friendlier wording for the errors users are likely to hit. */
export const describeAiError = (e: unknown): string => (e instanceof FunctionsError ? describeClaudeError(e) : msgOf(e))

/** Raw error line for the "技術細節" disclosure. */
export const aiErrorDetails = (e: unknown): string[] => (e instanceof FunctionsError ? [`Claude · ${e.code}：${e.message}`] : [msgOf(e)])

// One callable serves both jobs (`kind`), so no second function needs its own public-invoker setup.
const claudeCall = httpsCallable<ItineraryRequest & { kind?: 'trip' }, { trip: AiTrip; model: string }>(functions, 'claudeItinerary', {
  // Matches the function's timeoutSeconds; long trips can take a few minutes.
  timeout: 540_000,
})

/** Ask Claude for a whole itinerary. */
export async function generateItinerary(req: ItineraryRequest): Promise<Trip> {
  const { data } = await claudeCall({ ...req, kind: 'trip' })
  return toTrip(data.trip, req)
}

/** Wording for errors from the claudeItinerary function (see functions/src/index.ts). */
function describeClaudeError(e: FunctionsError): string {
  const reason = (e.details as { reason?: string } | undefined)?.reason
  switch (reason) {
    case 'daily-limit':
      return `今天的 Claude 產生次數已用完（每人每天 ${CLAUDE_DAILY_LIMIT} 次），明天再試。`
    case 'daily-limit-day':
      return `今天的 Claude 協作次數已用完（每人每天 ${CLAUDE_DAY_DAILY_LIMIT} 次），明天再試。`
    case 'bad-key':
      return 'Claude API 金鑰無效或已停用。請到 console.anthropic.com 建立新金鑰，更新 GitHub 的 ANTHROPIC_API_KEY secret 後重新部署。'
    case 'billing':
      return 'Anthropic 帳戶的額度不足。請到 console.anthropic.com → Billing 儲值後再試。'
    case 'model-not-found':
      return '找不到設定的 Claude 模型，請更新 functions/src/index.ts 的 MODEL。'
    case 'rate-limit':
      return 'Claude 目前達到速率上限，請等 1 分鐘再試。'
    case 'overloaded':
      return 'Claude 服務目前忙碌中，請稍後再試。'
    case 'refusal':
      return 'Claude 拒絕了這個請求，請調整需求描述後再試。'
    case 'truncated':
      return 'Claude 回傳的內容不完整（行程可能太長），請減少天數或分段產生。'
    case 'unauthenticated':
      return '請先登入。'
  }
  // No reason attached: the function is missing (not deployed) or crashed before answering.
  if (e.code === 'functions/not-found' || e.code === 'functions/internal')
    return 'Claude 雲端函式無法呼叫：可能尚未部署，或沒有開放呼叫權限（Cloud Run → claudeitinerary → 安全性 → 允許未經驗證的叫用）。'
  if (e.code === 'functions/deadline-exceeded') return 'Claude 花太久沒有回應，請減少天數再試。'
  return e.message
}

const TIME_RE =/^([01]?\d|2[0-3]):[0-5]\d$/
const asTime = (s: string, fallback: string) => (TIME_RE.test(s) ? toTime(toMinutes(s)) : fallback)
const asCategory = (c: string): Category => (CATEGORIES as string[]).includes(c) ? (c as Category) : 'other'

type RawActivity = AiTrip['days'][number]['activities'][number]

/** Normalise one model activity (times, category, coordinates, cost); `fallbackStart` when the time is unusable. */
function normalizeActivity(a: RawActivity, id: string, fallbackStart: number): Activity {
  const start = asTime(a.start, toTime(fallbackStart))
  let end = asTime(a.end, toTime(toMinutes(start) + 60))
  if (toMinutes(end) <= toMinutes(start)) end = toTime(toMinutes(start) + 60)
  const geoOk =
    Number.isFinite(a.lat) && Number.isFinite(a.lng) && Math.abs(a.lat) <= 90 && Math.abs(a.lng) <= 180 && (a.lat !== 0 || a.lng !== 0)
  return {
    id,
    title: a.title.trim(),
    category: asCategory(a.category),
    start,
    end,
    location: a.location?.trim() || undefined,
    lat: geoOk ? a.lat : undefined,
    lng: geoOk ? a.lng : undefined,
    cost: Math.max(0, Math.round(Number(a.cost) || 0)),
    notes: a.notes?.trim() || undefined,
  }
}

/** Validate and normalise the model output into our Trip shape. */
export function toTrip(raw: AiTrip, req: ItineraryRequest): Trip {
  const activities: Record<string, Activity> = {}
  const days = (raw.days ?? []).slice(0, Math.max(1, req.days)).map((d) => {
    const ids: string[] = []
    let cursor = 9 * 60
    for (const a of d.activities ?? []) {
      if (!a.title) continue
      const id = uid()
      activities[id] = normalizeActivity(a, id, cursor)
      ids.push(id)
      cursor = toMinutes(activities[id].end)
    }
    ids.sort((x, y) => toMinutes(activities[x].start) - toMinutes(activities[y].start))
    return { id: uid(), activityIds: ids }
  })
  while (days.length < req.days) days.push({ id: uid(), activityIds: [] })

  return {
    id: longId(),
    name: raw.name?.trim() || `${req.destination} ${req.days} 日遊`,
    destination: raw.destination?.trim() || req.destination,
    startDate: req.startDate,
    currency: (raw.currency || req.currency || 'TWD').toUpperCase().slice(0, 4),
    budget: req.budget,
    days,
    activities,
    updatedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// AI co-editing of one day
// ---------------------------------------------------------------------------

const claudeDayCall = httpsCallable<DayRequest & { kind: 'day' }, { day: AiDay; model: string }>(functions, 'claudeItinerary', { timeout: 300_000 })

/** The request describing day `dayIndex` with `current` as its activities (the live day, or a pending proposal). */
export function dayRequest(trip: Trip, dayIndex: number, current: Activity[], instruction: string, history: string[]): DayRequest {
  const date = new Date(trip.startDate + 'T00:00:00')
  date.setDate(date.getDate() + dayIndex)
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const edge = (ids: string[] | undefined, last: boolean) => {
    const a = ids?.length ? trip.activities[ids[last ? ids.length - 1 : 0]] : undefined
    return a ? `${a.start}–${a.end} ${a.title}${a.location ? `（${a.location}）` : ''}` : ''
  }
  return {
    destination: trip.destination,
    currency: trip.currency,
    date: iso,
    dayNumber: dayIndex + 1,
    totalDays: trip.days.length,
    before: edge(trip.days[dayIndex - 1]?.activityIds, true),
    after: edge(trip.days[dayIndex + 1]?.activityIds, false),
    activities: current.map((a) => ({
      id: a.id,
      title: a.title,
      category: a.category,
      start: a.start,
      end: a.end,
      location: a.location ?? '',
      ...(a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : {}),
      cost: a.cost,
      notes: a.notes ?? '',
    })),
    instruction,
    history,
  }
}

/** Ask the AI to revise a day. Returns the explanation and the proposed activities (not yet applied). */
export async function reviseDay(req: DayRequest, current: Activity[]): Promise<{ summary: string; activities: Activity[] }> {
  const raw = (await claudeDayCall({ ...req, kind: 'day' })).data.day
  return { summary: (raw.summary ?? '').trim(), activities: toDayProposal(raw, current) }
}

/**
 * Turn the model's day into activities. Ids of existing activities are reused (each at most once) so
 * photos and attached tickets stay linked; anything else becomes a new activity.
 */
export function toDayProposal(raw: AiDay, current: Activity[]): Activity[] {
  const byId = new Map(current.map((a) => [a.id, a]))
  const used = new Set<string>()
  let cursor = 9 * 60
  const out: Activity[] = []
  for (const a of raw.activities ?? []) {
    if (!a?.title) continue
    const old = a.id && byId.has(a.id) && !used.has(a.id) ? byId.get(a.id)! : undefined
    const id = old ? old.id : uid()
    if (old) used.add(id)
    const next = normalizeActivity(a, id, cursor)
    // Keep the photo only while the place is unchanged.
    if (old?.photo && (old.location ?? '') === (next.location ?? '')) next.photo = old.photo
    out.push(next)
    cursor = toMinutes(next.end)
  }
  return out.sort((x, y) => toMinutes(x.start) - toMinutes(y.start))
}

export type DayChange = { kind: 'added' } | { kind: 'changed'; what: string[] } | { kind: 'same' }

/** What changed for each proposed activity, and which current ones would be removed. */
export function diffDay(current: Activity[], proposal: Activity[]): { changes: Map<string, DayChange>; removed: Activity[] } {
  const byId = new Map(current.map((a) => [a.id, a]))
  const changes = new Map<string, DayChange>()
  for (const a of proposal) {
    const o = byId.get(a.id)
    if (!o) {
      changes.set(a.id, { kind: 'added' })
      continue
    }
    const what: string[] = []
    if (o.start !== a.start || o.end !== a.end) what.push(`時間 ${o.start}–${o.end} → ${a.start}–${a.end}`)
    if (o.title !== a.title) what.push(`名稱「${o.title}」→「${a.title}」`)
    if ((o.location ?? '') !== (a.location ?? '')) what.push('地點')
    if (o.category !== a.category) what.push('類別')
    if (o.cost !== a.cost) what.push(`花費 ${o.cost} → ${a.cost}`)
    if ((o.notes ?? '') !== (a.notes ?? '')) what.push('備註')
    changes.set(a.id, what.length ? { kind: 'changed', what } : { kind: 'same' })
  }
  const ids = new Set(proposal.map((a) => a.id))
  return { changes, removed: current.filter((a) => !ids.has(a.id)) }
}
