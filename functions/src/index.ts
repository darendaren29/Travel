import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import Anthropic, { BetaFallbackState, betaRefusalFallbackMiddleware } from '@anthropic-ai/sdk'
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk'
import { ACTIVITY_FIELDS, AI_CATEGORIES, CLAUDE_DAILY_LIMIT, PACES, SYSTEM_PROMPT, buildPrompt, type AiTrip, type ItineraryRequest } from '../../src/aiPrompt'

initializeApp()

/** Claude model on Vertex AI (enable it in Vertex AI → Model Garden first). */
const MODEL = 'claude-opus-5-5'
/** Used only if MODEL declines the request (policy refusal). */
const REFUSAL_FALLBACK_MODEL = 'claude-opus-4-8'
const VERTEX_REGION = 'global'
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'travel-planner-2734f'
/** Generations per signed-in user per day (UTC), to cap spend on a public site. */
const DAILY_LIMIT = CLAUDE_DAILY_LIMIT
const MAX_DAYS = 21

// Auth comes from the function's service account (Application Default Credentials) — no API key.
// Created on first use: the constructor starts fetching credentials, which must not happen while
// the deploy tooling merely loads this module to discover the functions.
let client: AnthropicVertex | undefined
const vertex = () =>
  (client ??= new AnthropicVertex({
    projectId: PROJECT_ID,
    region: VERTEX_REGION,
    middleware: [betaRefusalFallbackMiddleware([{ model: REFUSAL_FALLBACK_MODEL }])],
  }))

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

/** Count one generation against the user's daily allowance. */
async function takeDailySlot(uid: string) {
  const today = new Date().toISOString().slice(0, 10)
  const ref = getFirestore().doc(`aiUsage/${uid}`)
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const used = snap.get('day') === today ? Number(snap.get('count')) || 0 : 0
    if (used >= DAILY_LIMIT)
      throw new HttpsError('resource-exhausted', `daily limit of ${DAILY_LIMIT} reached`, { reason: 'daily-limit', limit: DAILY_LIMIT })
    tx.set(ref, { day: today, count: used + 1 })
  })
}

/** Map Vertex / Anthropic errors to callable errors the web app can explain. */
function toHttpsError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e
  if (e instanceof Anthropic.APIError) {
    const raw = `[${e.status ?? 'network'}] ${e.message}`
    if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.PermissionDeniedError)
      return new HttpsError('failed-precondition', raw, { reason: 'model-not-enabled', model: MODEL })
    if (e instanceof Anthropic.RateLimitError) return new HttpsError('resource-exhausted', raw, { reason: 'rate-limit' })
    if (e instanceof Anthropic.APIConnectionError || (e.status ?? 0) >= 500) return new HttpsError('unavailable', raw, { reason: 'overloaded' })
    return new HttpsError('internal', raw, { reason: 'api-error' })
  }
  return new HttpsError('internal', e instanceof Error ? e.message : String(e), { reason: 'unknown' })
}

export const claudeItinerary = onCall(
  { region: 'asia-east1', timeoutSeconds: 540, memory: '512MiB', maxInstances: 5 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'sign in first', { reason: 'unauthenticated' })
    const req = parseRequest(request.data)
    await takeDailySlot(uid)

    try {
      // Streaming keeps the long JSON output clear of HTTP timeouts.
      const stream = vertex().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: TRIP_SCHEMA } },
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildPrompt(req) }],
        },
        { fallbackState: new BetaFallbackState() },
      )
      const message = await stream.finalMessage()
      logger.info('claude itinerary', { uid, model: message.model, stop: message.stop_reason, usage: message.usage })

      if (message.stop_reason === 'refusal')
        throw new HttpsError('failed-precondition', 'the model declined this request', { reason: 'refusal' })
      if (message.stop_reason === 'max_tokens') throw new HttpsError('internal', 'output was cut off', { reason: 'truncated' })

      // After a refusal fallback, only the blocks after the last `fallback` marker are the answer.
      const lastSwitch = message.content.findLastIndex((b) => b.type === 'fallback')
      const json = message.content
        .slice(lastSwitch + 1)
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('')
      let trip: AiTrip
      try {
        trip = JSON.parse(json) as AiTrip
      } catch {
        throw new HttpsError('internal', 'model returned invalid JSON', { reason: 'truncated' })
      }
      return { trip, model: message.model }
    } catch (e) {
      const err = toHttpsError(e)
      if (!(e instanceof HttpsError)) logger.error('claude itinerary failed', { uid, error: err.message })
      throw err
    }
  },
)
