import { getAI, getGenerativeModel, GoogleAIBackend, Schema, VertexAIBackend } from 'firebase/ai'
import { FunctionsError, httpsCallable } from 'firebase/functions'
import { app, functions } from './firebase'
import { AI_BACKENDS, GEMINI_MODELS, VERTEX_LOCATION, type AiProvider } from './config'
import { ACTIVITY_FIELDS, AI_CATEGORIES, CLAUDE_DAILY_LIMIT, SYSTEM_PROMPT, buildPrompt, type AiTrip, type ItineraryRequest } from './aiPrompt'
import { CATEGORIES, type Activity, type Category, type Trip } from './types'
import { longId, toMinutes, toTime, uid } from './utils'

export type { ItineraryRequest, AiTrip } from './aiPrompt'

const activitySchema = Schema.object({
  properties: {
    title: Schema.string({ description: ACTIVITY_FIELDS.title }),
    category: Schema.enumString({ enum: AI_CATEGORIES }),
    start: Schema.string({ description: ACTIVITY_FIELDS.start }),
    end: Schema.string({ description: ACTIVITY_FIELDS.end }),
    location: Schema.string({ description: ACTIVITY_FIELDS.location }),
    lat: Schema.number({ description: ACTIVITY_FIELDS.lat }),
    lng: Schema.number({ description: ACTIVITY_FIELDS.lng }),
    cost: Schema.integer({ description: ACTIVITY_FIELDS.cost }),
    notes: Schema.string({ description: ACTIVITY_FIELDS.notes }),
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
  if (e instanceof FunctionsError) return describeClaudeError(e)
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
  e instanceof ItineraryError
    ? e.attempts.map((a) => `${a.model}：${a.message}`)
    : e instanceof FunctionsError
      ? [`Claude · ${e.code}：${e.message}`]
      : [msgOf(e)]

const BACKEND_LABEL = { vertex: 'Vertex AI', developer: 'Developer API' } as const

/**
 * Ask Gemini for an itinerary. Providers (AI_BACKENDS) and models (GEMINI_MODELS) are tried in
 * order: a missing / rate-limited / overloaded model moves on to the next model, a provider that
 * isn't enabled or has no billing moves on to the next provider. Anything else stops immediately.
 */
async function generateWithGemini(req: ItineraryRequest): Promise<Trip> {
  const attempts: { model: string; message: string }[] = []
  for (const backendKey of AI_BACKENDS) {
    const ai = getAI(app, { backend: backendKey === 'vertex' ? new VertexAIBackend(VERTEX_LOCATION) : new GoogleAIBackend() })
    for (const modelName of GEMINI_MODELS) {
      try {
        const model = getGenerativeModel(ai, {
          model: modelName,
          systemInstruction: SYSTEM_PROMPT,
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

const claudeCall = httpsCallable<ItineraryRequest, { trip: AiTrip; model: string }>(functions, 'claudeItinerary', {
  // Matches the function's timeoutSeconds; long trips can take a few minutes.
  timeout: 540_000,
})

/** Ask Claude (on Vertex AI, via the claudeItinerary Cloud Function) for an itinerary. */
async function generateWithClaude(req: ItineraryRequest): Promise<Trip> {
  const { data } = await claudeCall(req)
  return toTrip(data.trip, req)
}

export function generateItinerary(req: ItineraryRequest, provider: AiProvider = 'gemini'): Promise<Trip> {
  return provider === 'claude' ? generateWithClaude(req) : generateWithGemini(req)
}

/** Wording for errors from the claudeItinerary function (see functions/src/index.ts). */
function describeClaudeError(e: FunctionsError): string {
  const reason = (e.details as { reason?: string } | undefined)?.reason
  switch (reason) {
    case 'daily-limit':
      return `今天的 Claude 產生次數已用完（每人每天 ${CLAUDE_DAILY_LIMIT} 次），明天再試，或改用 Gemini。`
    case 'model-not-enabled':
      return 'Claude 尚未在 Vertex AI 啟用。請到 Google Cloud 主控台 → Vertex AI → Model Garden 搜尋 Claude，按「啟用」並同意條款。'
    case 'rate-limit':
      return 'Claude 目前達到速率或配額上限，請等 1 分鐘再試（或在 Vertex AI → 配額 提高上限）。'
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
    return 'Claude 雲端函式沒有回應（claudeItinerary 可能尚未部署）。請確認 GitHub Actions 的「Deploy Cloud Functions」步驟成功。'
  if (e.code === 'functions/deadline-exceeded') return 'Claude 花太久沒有回應，請減少天數再試。'
  return e.message
}

const TIME_RE =/^([01]?\d|2[0-3]):[0-5]\d$/
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
