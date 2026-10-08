import { getAI, getGenerativeModel, GoogleAIBackend, Schema, VertexAIBackend } from 'firebase/ai'
import { app } from './firebase'
import { AI_BACKENDS, GEMINI_MODELS, VERTEX_LOCATION } from './config'
import { CATEGORIES, type Activity, type Category, type Trip } from './types'
import { longId, toMinutes, toTime, uid } from './utils'

export interface ItineraryRequest {
  destination: string
  days: number
  startDate: string
  currency: string
  budget: number
  travelers: string
  pace: '輕鬆' | '適中' | '緊湊'
  preferences: string
}

/** Shape we ask Gemini to return (enforced via responseSchema). */
export interface AiTrip {
  name: string
  destination: string
  currency: string
  days: { theme: string; activities: AiActivity[] }[]
}
interface AiActivity {
  title: string
  category: string
  start: string
  end: string
  location: string
  lat: number
  lng: number
  cost: number
  notes?: string
}

const activitySchema = Schema.object({
  properties: {
    title: Schema.string({ description: '活動名稱，簡短，繁體中文' }),
    category: Schema.enumString({ enum: [...CATEGORIES] }),
    start: Schema.string({ description: '開始時間，24 小時制 HH:MM' }),
    end: Schema.string({ description: '結束時間，24 小時制 HH:MM，晚於 start' }),
    location: Schema.string({ description: '地點名稱（店名/景點名）' }),
    lat: Schema.number({ description: 'WGS84 緯度，小數' }),
    lng: Schema.number({ description: 'WGS84 經度，小數' }),
    cost: Schema.integer({ description: '預估每人花費（指定幣別），免費填 0' }),
    notes: Schema.string({ description: '一句實用提示：訂位、交通、注意事項' }),
  },
  optionalProperties: ['notes'],
})

const tripSchema = Schema.object({
  properties: {
    name: Schema.string({ description: '旅程名稱，例如「東京美食三日遊」' }),
    destination: Schema.string(),
    currency: Schema.string({ description: 'ISO 4217 幣別代碼' }),
    days: Schema.array({
      items: Schema.object({
        properties: {
          theme: Schema.string({ description: '當日主題' }),
          activities: Schema.array({ items: activitySchema }),
        },
      }),
    }),
  },
})

const SYSTEM = `你是專業的旅遊行程規劃師。根據使用者的需求，規劃可直接執行的逐日行程。
規則：
- 全部使用繁體中文（地名可附原文）。
- 每天安排 4–7 個活動（行程超過 7 天時每天 3–5 個，以免內容過長），包含午/晚餐（category=food），景點之間要考慮合理的交通時間，不要時間重疊。
- 使用者在偏好中寫的航班、住宿、日期等固定安排必須照實排入對應日期（航班用 category=transport）。
- 第一天從抵達或約 09:00 開始，第一天最後一項安排飯店 check-in（category=lodging，cost 填當晚房價）；最後一天依離開時間結束。
- 同一區域的景點排在同一天，減少往返。
- 每個活動都要給出真實存在的地點，以及正確的 WGS84 經緯度（小數，不可為 0）。
- cost 為每人預估花費，使用指定幣別、整數；免費填 0。盡量讓總花費落在預算內。
- notes 給一句實用提示（是否需預約、交通方式、營業時間注意）。
- 只輸出符合 schema 的 JSON。`

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isNotFound = (e: unknown) => /404|not found|NOT_FOUND|is not supported/i.test(msgOf(e))
/** AI Studio prepay balance empty / billing missing — affects every model of that provider. */
const isBilling = (e: unknown) => /prepayment|credits are depleted|\b402\b|payment required|billing (is )?(not|disabled)/i.test(msgOf(e))
const isQuota = (e: unknown) => !isBilling(e) && /429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(msgOf(e))
const isOverloaded = (e: unknown) => /503|UNAVAILABLE|overloaded/i.test(msgOf(e))
/** Provider not enabled for this project — affects every model of that provider. */
const isDisabled = (e: unknown) => /\b403\b|PERMISSION_DENIED|SERVICE_DISABLED|API_DISABLED|has not been used|is disabled|not enabled/i.test(msgOf(e))
/** Errors where the next model of the same provider may still work. */
const shouldTryNextModel = (e: unknown) => isNotFound(e) || isQuota(e) || isOverloaded(e)
/** Errors where the whole provider is unusable, so jump to the next provider. */
const shouldTryNextBackend = (e: unknown) => isBilling(e) || isDisabled(e)

/** Error carrying what each model answered, so the UI can show the real cause. */
export class ItineraryError extends Error {
  constructor(
    message: string,
    readonly attempts: { model: string; message: string }[],
  ) {
    super(message)
  }
}

/** Friendlier wording for the errors users are likely to hit. */
export const describeAiError = (e: unknown): string => {
  const msg = msgOf(e)
  if (/app check|appcheck|deactivated/i.test(msg)) return 'Firebase App Check 尚未設定或驗證失敗（請確認 reCAPTCHA 金鑰與 App Check 設定）。'
  if (isBilling(msg))
    return 'Gemini Developer API 的預付額度已用完（AI Studio 預付制）。請在 Firebase 主控台 → AI Logic 啟用 Vertex AI（用 Blaze 帳單後付），或到 AI Studio 儲值。'
  if (isQuota(msg)) {
    if (/limit:?\s*0\b/i.test(msg)) return '這個專案目前沒有可用的 Gemini 免費額度（上限為 0）。請確認 Firebase 已升級 Blaze 並連結帳單帳戶，或改用 Vertex AI。'
    if (/per.?day|daily|PerDay/i.test(msg)) return '今天的 Gemini 免費額度已用完（每日上限），明天會重置；或升級付費層級提高上限。'
    return '所有模型都暫時達到速率上限，請等 1 分鐘再試。'
  }
  if (isOverloaded(msg)) return 'Gemini 服務目前忙碌中，請稍後再試。'
  if (/403|PERMISSION_DENIED|API has not been used|not enabled/i.test(msg)) return 'Firebase AI Logic 尚未在專案中啟用（Firebase 主控台 → AI Logic → 開始使用）。'
  if (isNotFound(msg)) return '找不到可用的 Gemini 模型，請更新 src/config.ts 的 GEMINI_MODELS。'
  // Our own JSON.parse of the model output failing (not an HTTP error that mentions JSON).
  if (!/fetch-error/.test(msg) && /Unexpected end of JSON|Unterminated string in JSON|JSON at position/i.test(msg))
    return 'Gemini 回傳的內容不完整（行程可能太長），請減少天數或分段產生。'
  return msg
}

/** Detail lines ("model: message") for an error from generateItinerary. */
export const aiErrorDetails = (e: unknown): string[] =>
  e instanceof ItineraryError ? e.attempts.map((a) => `${a.model}：${a.message}`) : [msgOf(e)]

const buildPrompt = (r: ItineraryRequest) =>
  [
    `目的地：${r.destination}`,
    `天數：${r.days} 天，出發日 ${r.startDate}`,
    `旅客：${r.travelers || '2 位成人'}`,
    `步調：${r.pace}`,
    `幣別：${r.currency}${r.budget > 0 ? `，總預算約 ${r.budget} ${r.currency}（每人）` : '，預算不限'}`,
    r.preferences.trim() ? `偏好與需求：${r.preferences.trim()}` : '',
    `請輸出剛好 ${r.days} 天的行程。`,
  ]
    .filter(Boolean)
    .join('\n')

const BACKEND_LABEL = { vertex: 'Vertex AI', developer: 'Developer API' } as const

/**
 * Ask Gemini for an itinerary. Providers (AI_BACKENDS) and models (GEMINI_MODELS) are tried in
 * order: a missing / rate-limited / overloaded model moves on to the next model, a provider that
 * isn't enabled or has no billing moves on to the next provider. Anything else stops immediately.
 */
export async function generateItinerary(req: ItineraryRequest): Promise<Trip> {
  const attempts: { model: string; message: string }[] = []
  for (const backendKey of AI_BACKENDS) {
    const ai = getAI(app, { backend: backendKey === 'vertex' ? new VertexAIBackend(VERTEX_LOCATION) : new GoogleAIBackend() })
    for (const modelName of GEMINI_MODELS) {
      try {
        const model = getGenerativeModel(ai, {
          model: modelName,
          systemInstruction: SYSTEM,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: tripSchema,
            temperature: 0.7,
            // Long trips produce long JSON; leave room so it isn't cut off mid-object.
            maxOutputTokens: 32768,
          },
        })
        const result = await model.generateContent(buildPrompt(req))
        const raw = JSON.parse(result.response.text()) as AiTrip
        return toTrip(raw, req)
      } catch (e) {
        attempts.push({ model: `${BACKEND_LABEL[backendKey]} · ${modelName}`, message: msgOf(e) })
        if (shouldTryNextBackend(e)) break
        if (!shouldTryNextModel(e)) throw new ItineraryError(msgOf(e), attempts)
      }
    }
  }
  // Explain the most actionable cause: billing, then quota, then overload, then "not enabled".
  const pick = (f: (m: string) => boolean) => attempts.find((a) => f(a.message))
  const main = pick(isBilling) ?? pick(isQuota) ?? pick(isOverloaded) ?? pick(isDisabled) ?? attempts[attempts.length - 1]
  throw new ItineraryError(main?.message ?? 'No Gemini model available', attempts)
}

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/
const asTime = (s: string, fallback: string) => (TIME_RE.test(s) ? toTime(toMinutes(s)) : fallback)
const asCategory = (c: string): Category => (CATEGORIES as string[]).includes(c) ? (c as Category) : 'other'

/** Validate and normalise the model output into our Trip shape. */
export function toTrip(raw: AiTrip, req: ItineraryRequest): Trip {
  const activities: Record<string, Activity> = {}
  const days = (raw.days ?? []).slice(0, Math.max(1, req.days)).map((d) => {
    const ids: string[] = []
    let cursor = 9 * 60
    for (const a of d.activities ?? []) {
      if (!a.title) continue
      const start = asTime(a.start, toTime(cursor))
      let end = asTime(a.end, toTime(toMinutes(start) + 60))
      if (toMinutes(end) <= toMinutes(start)) end = toTime(toMinutes(start) + 60)
      const geoOk =
        Number.isFinite(a.lat) && Number.isFinite(a.lng) && Math.abs(a.lat) <= 90 && Math.abs(a.lng) <= 180 && (a.lat !== 0 || a.lng !== 0)
      const id = uid()
      activities[id] = {
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
      ids.push(id)
      cursor = toMinutes(end)
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
