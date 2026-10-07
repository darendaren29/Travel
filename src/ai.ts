import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from 'firebase/ai'
import { app } from './firebase'
import { GEMINI_MODELS } from './config'
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
- 每天安排 4–7 個活動，包含早/午/晚餐（category=food），景點之間要考慮合理的交通時間，不要時間重疊。
- 第一天從抵達或約 09:00 開始，第一天最後一項安排飯店 check-in（category=lodging，cost 填當晚房價）；最後一天依離開時間結束。
- 同一區域的景點排在同一天，減少往返。
- 每個活動都要給出真實存在的地點，以及正確的 WGS84 經緯度（小數，不可為 0）。
- cost 為每人預估花費，使用指定幣別、整數；免費填 0。盡量讓總花費落在預算內。
- notes 給一句實用提示（是否需預約、交通方式、營業時間注意）。
- 只輸出符合 schema 的 JSON。`

const isNotFound = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  return /404|not found|NOT_FOUND|is not supported/i.test(msg)
}

/** Friendlier wording for the errors users are likely to hit. */
export const describeAiError = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e)
  if (/app check|appcheck|deactivated/i.test(msg)) return 'Firebase App Check 尚未設定或驗證失敗（請確認 reCAPTCHA 金鑰與 App Check 設定）。'
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'Gemini 額度暫時用完了，請稍後再試。'
  if (/403|PERMISSION_DENIED|API has not been used|not enabled/i.test(msg)) return 'Firebase AI Logic 尚未在專案中啟用（Firebase 主控台 → AI Logic → 開始使用）。'
  if (isNotFound(msg)) return '找不到可用的 Gemini 模型，請更新 src/config.ts 的 GEMINI_MODELS。'
  return msg
}

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

/** Ask Gemini for an itinerary; tries each configured model until one responds. */
export async function generateItinerary(req: ItineraryRequest): Promise<Trip> {
  const ai = getAI(app, { backend: new GoogleAIBackend() })
  let lastError: unknown = null
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = getGenerativeModel(ai, {
        model: modelName,
        systemInstruction: SYSTEM,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: tripSchema,
          temperature: 0.7,
        },
      })
      const result = await model.generateContent(buildPrompt(req))
      const raw = JSON.parse(result.response.text()) as AiTrip
      return toTrip(raw, req)
    } catch (e) {
      lastError = e
      if (!isNotFound(e)) throw e
    }
  }
  throw lastError ?? new Error('No Gemini model available')
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
