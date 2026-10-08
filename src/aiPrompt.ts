// Prompt and output shape for AI itinerary generation. Shared by the browser (Gemini via
// Firebase AI Logic) and the Cloud Function (Claude), so keep this file free of runtime imports
// other than ./types.

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

/** Shape the model returns (enforced by a JSON schema on both providers). */
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
