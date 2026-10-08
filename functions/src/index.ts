import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import { defineSecret } from 'firebase-functions/params'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import Anthropic from '@anthropic-ai/sdk'
import {
  ACTIVITY_FIELDS,
  AI_CATEGORIES,
  CLAUDE_DAILY_LIMIT,
  CLAUDE_DAY_DAILY_LIMIT,
  DAY_SYSTEM_PROMPT,
  PACES,
  SYSTEM_PROMPT,
  buildDayPrompt,
  buildPrompt,
  type AiDay,
  type AiTrip,
  type DayActivityIn,
  type DayRequest,
  type ItineraryRequest,
} from '../../src/aiPrompt'

initializeApp()

/** Claude model (Claude API, billed to the Anthropic Console account that owns the key). */
const MODEL = 'claude-opus-5-5'
/** Requests per signed-in user per day (UTC), to cap spend on a public site. */
const LIMITS = {
  trip: { field: 'count', limit: CLAUDE_DAILY_LIMIT, reason: 'daily-limit' },
  day: { field: 'dayCount', limit: CLAUDE_DAY_DAILY_LIMIT, reason: 'daily-limit-day' },
} as const
type Kind = keyof typeof LIMITS
const MAX_DAYS = 21

// Anthropic API key, stored in Google Secret Manager (synced from the GitHub secret by the deploy
// workflow). Only this function's runtime can read it; it never reaches the browser.
const anthropicKey = defineSecret('ANTHROPIC_API_KEY')

// Created on first call, once the secret value is available at runtime.
let client: Anthropic | undefined
const claude = () => (client ??= new Anthropic({ apiKey: anthropicKey.value() }))

const str = (description: string) => ({ type: 'string', description })
const TRIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'destination', 'currency', 'days'],
  properties: {
    name: str('旅程名稱，例如「東京美食三日遊」'),
    destination: { type: 'string' },
    currency: str('ISO 4217 幣別代碼'),
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['theme', 'activities'],
        properties: {
          theme: str('當日主題'),
          activities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'category', 'start', 'end', 'location', 'lat', 'lng', 'cost', 'notes'],
              properties: {
                title: str(ACTIVITY_FIELDS.title),
                category: { type: 'string', enum: AI_CATEGORIES },
                start: str(ACTIVITY_FIELDS.start),
                end: str(ACTIVITY_FIELDS.end),
                location: str(ACTIVITY_FIELDS.location),
                lat: { type: 'number', description: ACTIVITY_FIELDS.lat },
                lng: { type: 'number', description: ACTIVITY_FIELDS.lng },
                cost: { type: 'integer', description: ACTIVITY_FIELDS.cost },
                notes: str(ACTIVITY_FIELDS.notes),
              },
            },
          },
        },
      },
    },
  },
}

const ACTIVITY_PROPS = {
  title: str(ACTIVITY_FIELDS.title),
  category: { type: 'string', enum: AI_CATEGORIES },
  start: str(ACTIVITY_FIELDS.start),
  end: str(ACTIVITY_FIELDS.end),
  location: str(ACTIVITY_FIELDS.location),
  lat: { type: 'number', description: ACTIVITY_FIELDS.lat },
  lng: { type: 'number', description: ACTIVITY_FIELDS.lng },
  cost: { type: 'integer', description: ACTIVITY_FIELDS.cost },
  notes: str(ACTIVITY_FIELDS.notes),
}
const DAY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'activities'],
  properties: {
    summary: str('1–3 句繁體中文，說明做了哪些調整'),
    activities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'category', 'start', 'end', 'location', 'lat', 'lng', 'cost', 'notes'],
        properties: { id: str('沿用原活動的 id；新增的活動填空字串'), ...ACTIVITY_PROPS },
      },
    },
  },
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Only structured fields reach the prompt, so the function can't be used as a general Claude proxy. */
function parseRequest(data: unknown): ItineraryRequest {
  const d = (data ?? {}) as Record<string, unknown>
  const req: ItineraryRequest = {
    destination: text(d.destination, 100),
    days: Math.min(MAX_DAYS, Math.max(1, Math.round(Number(d.days) || 1))),
    startDate: text(d.startDate, 10),
    currency: text(d.currency, 4).toUpperCase() || 'TWD',
    budget: Math.max(0, Number(d.budget) || 0),
    travelers: text(d.travelers, 100),
    pace: PACES.includes(d.pace as ItineraryRequest['pace']) ? (d.pace as ItineraryRequest['pace']) : '適中',
    preferences: text(d.preferences, 2000),
  }
  if (!req.destination) throw new HttpsError('invalid-argument', 'destination is required', { reason: 'bad-request' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.startDate)) throw new HttpsError('invalid-argument', 'startDate must be YYYY-MM-DD', { reason: 'bad-request' })
  return req
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Day co-editing request: bounded, structured fields only. */
function parseDayRequest(data: unknown): DayRequest {
  const d = (data ?? {}) as Record<string, unknown>
  const acts = Array.isArray(d.activities) ? d.activities.slice(0, 40) : []
  const req: DayRequest = {
    destination: text(d.destination, 100),
    currency: text(d.currency, 4).toUpperCase() || 'TWD',
    date: text(d.date, 10),
    dayNumber: Math.min(60, Math.max(1, Math.round(Number(d.dayNumber) || 1))),
    totalDays: Math.min(60, Math.max(1, Math.round(Number(d.totalDays) || 1))),
    before: text(d.before, 200),
    after: text(d.after, 200),
    instruction: text(d.instruction, 1000),
    history: (Array.isArray(d.history) ? d.history : []).slice(-10).map((h) => text(h, 300)).filter(Boolean),
    activities: acts.map((raw): DayActivityIn => {
      const a = (raw ?? {}) as Record<string, unknown>
      const lat = num(a.lat)
      const lng = num(a.lng)
      return {
        id: text(a.id, 40),
        title: text(a.title, 120),
        category: AI_CATEGORIES.includes(a.category as never) ? String(a.category) : 'other',
        start: text(a.start, 5),
        end: text(a.end, 5),
        location: text(a.location, 150),
        ...(lat != null && lng != null ? { lat, lng } : {}),
        cost: Math.min(1e8, Math.max(0, num(a.cost) ?? 0)),
        notes: text(a.notes, 300),
      }
    }),
  }
  if (!req.instruction) throw new HttpsError('invalid-argument', 'instruction is required', { reason: 'bad-request' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date)) throw new HttpsError('invalid-argument', 'date must be YYYY-MM-DD', { reason: 'bad-request' })
  return req
}

/** Count one request against the user's daily allowance for that kind. */
async function takeDailySlot(uid: string, kind: Kind) {
  const { field, limit, reason } = LIMITS[kind]
  const today = new Date().toISOString().slice(0, 10)
  const ref = getFirestore().doc(`aiUsage/${uid}`)
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const sameDay = snap.get('day') === today
    const used = sameDay ? Number(snap.get(field)) || 0 : 0
    if (used >= limit) throw new HttpsError('resource-exhausted', `daily limit of ${limit} reached`, { reason, limit })
    tx.set(ref, sameDay ? { [field]: used + 1 } : { day: today, [field]: 1 }, { merge: sameDay })
  })
}

/** One structured-output Claude call; returns the parsed JSON answer. */
async function askClaude<T>(system: string, prompt: string, schema: object, maxTokens: number, uid: string, kind: Kind): Promise<T> {
  // Streaming keeps long JSON output clear of HTTP timeouts.
  const stream = claude().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema as Record<string, unknown> } },
    system,
    messages: [{ role: 'user', content: prompt }],
    // If the model declines on policy grounds, the API retries on a suitable fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  })
  const message = await stream.finalMessage()
  logger.info('claude', { uid, kind, model: message.model, stop: message.stop_reason, usage: message.usage })

  if (message.stop_reason === 'refusal') throw new HttpsError('failed-precondition', 'the model declined this request', { reason: 'refusal' })
  if (message.stop_reason === 'max_tokens') throw new HttpsError('internal', 'output was cut off', { reason: 'truncated' })

  // After a refusal fallback, only the blocks after the last `fallback` marker are the answer.
  const lastSwitch = message.content.findLastIndex((b) => b.type === 'fallback')
  const json = message.content
    .slice(lastSwitch + 1)
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
  try {
    return JSON.parse(json) as T
  } catch {
    throw new HttpsError('internal', 'model returned invalid JSON', { reason: 'truncated' })
  }
}

/** Map Claude API errors to callable errors the web app can explain. */
function toHttpsError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e
  if (e instanceof Anthropic.APIError) {
    const raw = `[${e.status ?? 'network'}] ${e.message}`
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      return new HttpsError('failed-precondition', raw, { reason: 'bad-key' })
    // Out of prepaid credits shows up as a 400 mentioning the credit balance.
    if (e instanceof Anthropic.BadRequestError && /credit balance|billing/i.test(e.message))
      return new HttpsError('failed-precondition', raw, { reason: 'billing' })
    if (e instanceof Anthropic.NotFoundError) return new HttpsError('failed-precondition', raw, { reason: 'model-not-found', model: MODEL })
    if (e instanceof Anthropic.RateLimitError) return new HttpsError('resource-exhausted', raw, { reason: 'rate-limit' })
    if (e instanceof Anthropic.APIConnectionError || (e.status ?? 0) >= 500) return new HttpsError('unavailable', raw, { reason: 'overloaded' })
    return new HttpsError('internal', raw, { reason: 'api-error' })
  }
  return new HttpsError('internal', e instanceof Error ? e.message : String(e), { reason: 'unknown' })
}

/** All Claude work for the web app: `kind: 'trip'` (default) builds an itinerary, `kind: 'day'` revises one day. */
export const claudeItinerary = onCall(
  { region: 'asia-east1', timeoutSeconds: 540, memory: '512MiB', maxInstances: 5, secrets: [anthropicKey] },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'sign in first', { reason: 'unauthenticated' })
    const kind: Kind = (request.data as { kind?: unknown } | null)?.kind === 'day' ? 'day' : 'trip'

    try {
      if (kind === 'day') {
        const req = parseDayRequest(request.data)
        await takeDailySlot(uid, kind)
        const day = await askClaude<AiDay>(DAY_SYSTEM_PROMPT, buildDayPrompt(req), DAY_SCHEMA, 16000, uid, kind)
        return { day, model: MODEL }
      }
      const req = parseRequest(request.data)
      await takeDailySlot(uid, kind)
      const trip = await askClaude<AiTrip>(SYSTEM_PROMPT, buildPrompt(req), TRIP_SCHEMA, 64000, uid, kind)
      return { trip, model: MODEL }
    } catch (e) {
      const err = toHttpsError(e)
      if (!(e instanceof HttpsError)) logger.error('claude failed', { uid, kind, error: err.message })
      throw err
    }
  },
)
