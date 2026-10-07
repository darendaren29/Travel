import { useRef, useState } from 'react'
import { useStore, useCurrentTrip, type View } from '../store'
import { downloadJson, readJsonFile } from '../share'
import ShareDialog from './ShareDialog'

const VIEWS: { key: View; label: string; icon: string }[] = [
  { key: 'board', label: '行程', icon: '🗓️' },
  { key: 'map', label: '地圖', icon: '🗺️' },
  { key: 'budget', label: '預算', icon: '💰' },
]

export default function Header() {
  const trip = useCurrentTrip()
  const { trips, view, setView, switchTrip, createTrip, deleteTrip, importTrip } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      importTrip(await readJsonFile(file))
    } catch (err) {
      alert(`匯入失敗：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const onDelete = () => {
    if (confirm(`確定要刪除「${trip.name}」？此操作無法復原。`)) deleteTrip(trip.id)
  }

  return (
    <header className="header">
      <div className="brand">🧭 旅遊行程規劃</div>

      <div className="trip-meta">
        <select value={trip.id} onChange={(e) => switchTrip(e.target.value)} title="切換旅程">
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => createTrip()} title="建立新旅程">
          ＋ 新旅程
        </button>
        <button className="btn sm ghost danger" onClick={onDelete} title="刪除此旅程">
          刪除
        </button>
      </div>

      <nav className="tabs">
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>
            {v.icon} {v.label}
          </button>
        ))}
      </nav>

      <div className="actions">
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
        <button className="btn sm" onClick={() => fileRef.current?.click()} title="匯入 JSON">
          📥 <span className="lbl">匯入</span>
        </button>
        <button className="btn sm" onClick={() => downloadJson(trip)} title="匯出 JSON">
          📤 <span className="lbl">匯出</span>
        </button>
        <button className="btn sm" onClick={() => setShareOpen(true)} title="分享連結">
          🔗 <span className="lbl">分享</span>
        </button>
        <button className="btn sm" onClick={() => window.print()} title="列印">
          🖨️ <span className="lbl">列印</span>
        </button>
      </div>

      {shareOpen && <ShareDialog trip={trip} onClose={() => setShareOpen(false)} />}
    </header>
  )
}
