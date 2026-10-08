import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, useCurrentTrip, type View } from '../store'
import { downloadJson, readJsonFile } from '../share'
import { signIn, signOut } from '../auth'
import ShareDialog from './ShareDialog'
import AiDialog from './AiDialog'

const VIEWS: { key: View; label: string; icon: string }[] = [
  { key: 'board', label: '行程', icon: '🗓️' },
  { key: 'map', label: '地圖', icon: '🗺️' },
  { key: 'budget', label: '預算', icon: '💰' },
  { key: 'docs', label: '票券', icon: '🎫' },
]

const SYNC_LABEL = {
  off: '',
  syncing: '同步中…',
  synced: '已同步',
  error: '同步失敗',
} as const

export default function Header() {
  const trip = useCurrentTrip()
  const { trips, view, setView, switchTrip, createTrip, deleteTrip, importTrip, user, syncState, syncError, pendingJoin } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const isOwner = !trip.ownerId || trip.ownerId === user?.uid

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
    const msg = isOwner ? `確定要刪除「${trip.name}」？此操作無法復原。` : `退出共編行程「${trip.name}」？`
    if (confirm(msg)) deleteTrip(trip.id)
  }

  const onSignOut = () => {
    if (confirm('登出後，這台裝置上的行程會清除（雲端資料保留）。確定登出？')) void signOut()
  }

  return (
    <header className="header">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9.2" />
            <circle cx="12" cy="12" r="6.6" strokeDasharray="1.2 1.8" />
            <path d="M15.2 8.8 13.1 13.1 8.8 15.2 10.9 10.9z" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="name">
          旅程手帳<small>Trip Planner · Par Avion</small>
        </span>
      </div>

      <div className="trip-meta">
        <select value={trip.id} onChange={(e) => switchTrip(e.target.value)} title="切換旅程">
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.ownerId && t.ownerId !== user?.uid ? '（共編）' : ''}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => createTrip()} title="建立新旅程">
          ＋ <span className="lbl">新旅程</span>
        </button>
        <button className="btn sm ghost danger" onClick={onDelete} title={isOwner ? '刪除此旅程' : '退出共編'}>
          {isOwner ? '刪除' : '退出'}
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
        <button className="btn sm ai" onClick={() => setAiOpen(true)} title="用 Gemini 產生行程">
          ✨ <span className="lbl">AI 產生</span>
        </button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
        <button className="btn sm" onClick={() => fileRef.current?.click()} title="匯入 JSON">
          📥 <span className="lbl">匯入</span>
        </button>
        <button className="btn sm" onClick={() => downloadJson(trip)} title="匯出 JSON">
          📤 <span className="lbl">匯出</span>
        </button>
        <button className="btn sm" onClick={() => setShareOpen(true)} title="分享 / 邀請共編">
          🔗 <span className="lbl">分享</span>
        </button>
        <button className="btn sm" onClick={() => window.print()} title="列印">
          🖨️ <span className="lbl">列印</span>
        </button>
      </div>

      <div className="account">
        {user ? (
          <>
            <span className={`sync ${syncState}`} title={syncError ?? SYNC_LABEL[syncState]}>
              ● <span className="lbl">{SYNC_LABEL[syncState]}</span>
            </span>
            {user.photo ? (
              <img className="avatar" src={user.photo} alt="" referrerPolicy="no-referrer" title={`${user.name}\n${user.email}`} />
            ) : (
              <span className="avatar initial" title={user.email}>
                {user.name.slice(0, 1)}
              </span>
            )}
            <button className="btn sm ghost" onClick={onSignOut}>
              登出
            </button>
          </>
        ) : (
          <button className="btn sm primary" onClick={() => void signIn()} title={pendingJoin ? '登入後即可加入共編行程' : '登入後行程會同步到雲端'}>
            {pendingJoin ? '登入以加入共編' : 'Google 登入'}
          </button>
        )}
      </div>

      {/* Portaled: the header's backdrop-filter would otherwise trap position:fixed dialogs inside it. */}
      {shareOpen && createPortal(<ShareDialog trip={trip} onClose={() => setShareOpen(false)} />, document.body)}
      {aiOpen && createPortal(<AiDialog onClose={() => setAiOpen(false)} />, document.body)}
    </header>
  )
}
