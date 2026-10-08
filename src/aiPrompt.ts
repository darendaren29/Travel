// Prompt and output shape for Claude itinerary generation and day co-editing. Shared by the browser
// and the Cloud Function (functions/ bundles it), so keep this file free of runtime imports other
// than ./types.

import { CATEGORIES } from './types'

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

/** Claude generations per signed-in user per day (enforced by the Cloud Function). */
export const CLAUDE_DAILY_LIMIT = 10

export const PACES: ItineraryRequest['pace'][] = ['輕鬆', '適中', '緊湊']

/** Shape the model returns (enforced by a JSON schema). */
export interface AiTrip {
  name: string
  destination: string
  currency: string
  days: { theme: string; activities: AiActivity[] }[]
}
export interface AiActivity {
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

export const ACTIVITY_FIELDS = {
  title: '活動名稱，簡短，繁體中文',
  start: '開始時間，24 小時制 HH:MM',
  end: '結束時間，24 小時制 HH:MM，晚於 start',
  location: '地點名稱（店名/景點名）',
  lat: 'WGS84 緯度，小數',
  lng: 'WGS84 經度，小數',
  cost: '預估每人花費（指定幣別），免費填 0',
  notes: '一句實用提示：訂位、交通、注意事項',
} as const

export const AI_CATEGORIES = [...CATEGORIES]

export const SYSTEM_PROMPT = `你是專業的旅遊行程規劃師。根據使用者的需求，規劃可直接執行的逐日行程。
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

export const buildPrompt = (r: ItineraryRequest) =>
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

// ---------------------------------------------------------------------------
// AI co-editing of a single day ("AI 協作")
// ---------------------------------------------------------------------------

/** Claude day revisions per signed-in user per day (cheaper than whole trips, so a separate budget). */
export const CLAUDE_DAY_DAILY_LIMIT = 40

/** An existing activity as sent to the model; `id` lets it say which ones it kept. */
export interface DayActivityIn {
  id: string
  title: string
  category: string
  start: string
  end: string
  location: string
  lat?: number
  lng?: number
  cost: number
  notes: string
}

export interface DayRequest {
  destination: string
  currency: string
  /** YYYY-MM-DD */
  date: string
  dayNumber: number
  totalDays: number
  /** Where the traveller is coming from / heading next (last item of the previous day, first of the next). */
  before: string
  after: string
  activities: DayActivityIn[]
  instruction: string
  /** Earlier instructions in this co-editing session, oldest first. */
  history: string[]
}

/** What the model returns: the whole revised day plus a short explanation. */
export interface AiDay {
  summary: string
  activities: (AiActivity & { id?: string })[]
}

/** One-tap requests shown in the dialog. */
export const DAY_QUICK_ASKS = [
  '補滿空檔，加入順路的景點',
  '加入午餐和晚餐（推薦在地餐廳）',
  '放慢步調，每個景點多留時間',
  '改成雨天備案（以室內為主）',
  '依地理位置重排，減少來回',
  '適合帶小孩，安排休息時間',
]

export const DAY_SYSTEM_PROMPT = `你是旅遊行程協作助手，正在和使用者一起調整「某一天」的行程。
規則：
- 回傳修改後這一天的「完整」活動清單（不是只有變動的部分），依時間排序。
- 沒被要求修改的活動保持原樣並沿用原本的 id；修改過的活動也沿用原 id；新增的活動 id 填空字串；被刪除的活動不要出現在清單中。
- 航班、飯店入住／退房、已預約的票券等固定安排，除非使用者明確要求，不要更動時間或刪除。
- 時間用 24 小時制 HH:MM，活動不可重疊，景點之間預留合理交通時間，並考慮營業時間。
- 每個活動都要是真實存在的地點，附正確的 WGS84 經緯度（小數，不可為 0）。
- cost 為每人預估花費（指定幣別、整數，免費填 0）；notes 給一句實用提示。
- 全部使用繁體中文（地名可附原文）。
- summary 用 1–3 句繁體中文說明你做了哪些調整與原因；若需求無法完全達成也請說明。
- 只輸出符合 schema 的 JSON。`

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

export const buildDayPrompt = (r: DayRequest) => {
  const wd = WEEKDAY[new Date(r.date + 'T00:00:00').getDay()] ?? ''
  const lines = r.activities.map((a) => JSON.stringify(a))
  return [
    `目的地：${r.destination || '（未填）'}`,
    `日期：${r.date}（${wd}），第 ${r.dayNumber} 天／共 ${r.totalDays} 天`,
    `幣別：${r.currency}`,
    r.before ? `前一天最後的安排：${r.before}` : '',
    r.after ? `隔天第一個安排：${r.after}` : '',
    '目前這一天的行程（每行一個活動，JSON）：',
    lines.length ? lines.join('\n') : '（尚無活動）',
    r.history.length ? `先前已提出的要求：\n${r.history.map((h) => `- ${h}`).join('\n')}` : '',
    `這次的要求：${r.instruction}`,
  ]
    .filter(Boolean)
    .join('\n')
}
