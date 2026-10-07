import type { Activity, Trip } from './types'

const act = (
  id: string,
  title: string,
  category: Activity['category'],
  start: string,
  end: string,
  cost: number,
  location?: string,
  lat?: number,
  lng?: number,
  notes?: string,
): Activity => ({ id, title, category, start, end, cost, location, lat, lng, notes })

const activities: Activity[] = [
  // Day 1
  act('a1', '抵達成田機場', 'transport', '09:30', '10:30', 0, '成田國際機場', 35.7720, 140.3929),
  act('a2', 'N\'EX 成田特快 → 東京車站', 'transport', '10:45', '12:00', 3070, '東京車站', 35.6812, 139.7671, 'JR Pass 可用'),
  act('a3', '築地場外市場 午餐', 'food', '12:30', '14:00', 2500, '築地場外市場', 35.6654, 139.7707, '推薦：海鮮丼、玉子燒'),
  act('a4', '淺草寺 & 仲見世通', 'sight', '14:45', '17:00', 500, '淺草寺', 35.7148, 139.7967),
  act('a5', '晴空塔 夜景', 'sight', '17:30', '19:30', 2100, '東京晴空塔', 35.7101, 139.8107),
  act('a6', '飯店 Check-in', 'lodging', '20:30', '21:00', 12000, '淺草 View Hotel', 35.7159, 139.7916),
  // Day 2
  act('b1', '明治神宮', 'sight', '09:00', '10:30', 0, '明治神宮', 35.6764, 139.6993),
  act('b2', '原宿 竹下通', 'shopping', '10:45', '12:15', 3000, '竹下通', 35.6716, 139.7030),
  act('b3', '澀谷 午餐', 'food', '12:45', '14:00', 1800, '澀谷', 35.6595, 139.7004, '一蘭拉麵'),
  act('b4', '澀谷 SKY 展望台', 'sight', '14:30', '16:00', 2500, 'Shibuya Sky', 35.6586, 139.7023),
  act('b5', '新宿 歌舞伎町 晚餐', 'food', '18:00', '20:00', 4000, '新宿歌舞伎町', 35.6949, 139.7025),
  // Day 3
  act('c1', '上野公園 & 阿美橫丁', 'sight', '09:30', '12:00', 0, '上野公園', 35.7146, 139.7738),
  act('c2', '秋葉原', 'shopping', '13:00', '15:30', 8000, '秋葉原', 35.6984, 139.7731),
  act('c3', '東京車站 → 成田機場', 'transport', '16:00', '17:30', 3070, '成田國際機場', 35.7720, 140.3929),
]

export const sampleTrip: Trip = {
  id: 'sample-tokyo',
  name: '東京三日遊',
  destination: '日本・東京',
  startDate: '2026-11-20',
  currency: 'JPY',
  budget: 60000,
  days: [
    { id: 'd1', activityIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] },
    { id: 'd2', activityIds: ['b1', 'b2', 'b3', 'b4', 'b5'] },
    { id: 'd3', activityIds: ['c1', 'c2', 'c3'] },
  ],
  activities: Object.fromEntries(activities.map((a) => [a.id, a])),
}
