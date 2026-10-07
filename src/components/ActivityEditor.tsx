import { useEffect, useState } from 'react'
import { useStore, useCurrentTrip } from '../store'
import { CATEGORIES, CATEGORY_META, type Activity } from '../types'
import { duration, formatDuration } from '../utils'
import { canNavigate, navLinks } from '../nav'

interface GeoResult {
  display_name: string
  lat: string
  lon: string
}

export default function ActivityEditor() {
  const trip = useCurrentTrip()
  const { selectedActivityId, select, updateActivity, deleteActivity, duplicateActivity, moveActivity, setView, pickingLocationFor, setPickingLocation } =
    useStore()
  const activity = selectedActivityId ? trip.activities[selectedActivityId] : undefined

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    setQuery(activity?.location ?? '')
    setResults([])
  }, [activity?.id, activity?.location])

  if (!activity) return null
  const a = activity
  const dayIndex = trip.days.findIndex((d) => d.activityIds.includes(a.id))
  const patch = (p: Partial<Activity>) => updateActivity(a.id, p)

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=zh-TW&q=${encodeURIComponent(query)}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      setResults((await res.json()) as GeoResult[])
    } catch {
      alert('搜尋失敗，請檢查網路連線。')
    } finally {
      setSearching(false)
    }
  }

  const pick = (r: GeoResult) => {
    const short = r.display_name.split(',')[0].trim()
    patch({ location: short, lat: Number(r.lat), lng: Number(r.lon) })
    setQuery(short)
    setResults([])
  }

  const startPicking = () => {
    setPickingLocation(a.id)
    setView('map')
  }

  const onDelete = () => {
    if (confirm(`刪除「${a.title}」？`)) deleteActivity(a.id)
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <span>編輯活動</span>
        <button className="btn sm ghost" onClick={() => select(null)} title="關閉">
          ✕
        </button>
      </div>

      <div className="panel-body">
        {pickingLocationFor === a.id && (
          <div className="picking-banner">
            <span>請在地圖上點選位置…</span>
            <button className="btn sm" onClick={() => setPickingLocation(null)}>
              取消
            </button>
          </div>
        )}

        <div className="field">
          <label>名稱</label>
          <input value={a.title} onChange={(e) => patch({ title: e.target.value })} autoFocus />
        </div>

        <div className="field">
          <label>類別</label>
          <div className="cat-grid">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={a.category === c ? 'active' : ''}
                style={{ '--cat': CATEGORY_META[c].color } as React.CSSProperties}
                onClick={() => patch({ category: c })}
              >
                {CATEGORY_META[c].icon} {CATEGORY_META[c].label}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>開始</label>
            <input type="time" value={a.start} onChange={(e) => patch({ start: e.target.value })} />
          </div>
          <div className="field">
            <label>結束</label>
            <input type="time" value={a.end} onChange={(e) => patch({ end: e.target.value })} />
          </div>
        </div>
        <div className="coords">時長：{formatDuration(duration(a))}</div>

        <div className="row">
          <div className="field">
            <label>所屬天數</label>
            <select
              value={dayIndex}
              onChange={(e) => moveActivity(a.id, Number(e.target.value), trip.days[Number(e.target.value)].activityIds.length)}
            >
              {trip.days.map((_, i) => (
                <option key={i} value={i}>
                  第 {i + 1} 天
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>花費（{trip.currency}）</label>
            <input type="number" min={0} value={a.cost || ''} placeholder="0" onChange={(e) => patch({ cost: Number(e.target.value) || 0 })} />
          </div>
        </div>

        <div className="field">
          <label>地點</label>
          <div className="row">
            <input
              value={query}
              placeholder="輸入地名後搜尋"
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => query !== a.location && patch({ location: query })}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            <button className="btn" style={{ flex: '0 0 auto' }} onClick={search} disabled={searching}>
              {searching ? '…' : '🔍 搜尋'}
            </button>
          </div>
          {results.length > 0 && (
            <div className="geo-results">
              {results.map((r, i) => (
                <button key={i} onClick={() => pick(r)}>
                  {r.display_name}
                </button>
              ))}
            </div>
          )}
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="coords">
              {a.lat != null && a.lng != null ? `📍 ${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` : '尚未設定座標'}
            </span>
            <button className="btn sm" style={{ flex: '0 0 auto' }} onClick={startPicking}>
              🗺️ 地圖點選
            </button>
            {a.lat != null && (
              <button className="btn sm ghost" style={{ flex: '0 0 auto' }} onClick={() => patch({ lat: undefined, lng: undefined })}>
                清除
              </button>
            )}
          </div>
        </div>

        {canNavigate(a) && (
          <div className="field">
            <label>導航</label>
            <div className="nav-row">
              {navLinks(trip, a).map((l) => (
                <a key={l.key} className="btn sm" href={l.url} target="_blank" rel="noopener noreferrer">
                  🧭 {l.name}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label>備註</label>
          <textarea value={a.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="訂位代號、注意事項…" />
        </div>
      </div>

      <div className="panel-foot">
        <button className="btn" onClick={() => duplicateActivity(a.id)}>
          ⧉ 複製
        </button>
        <button className="btn danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>
          🗑 刪除
        </button>
      </div>
    </aside>
  )
}
