import { useMemo, useState } from 'react'
import type { Trip } from '../types'
import { buildShareUrl } from '../share'
import { useStore } from '../store'

export default function ShareDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { user, updateTrip } = useStore()
  const cloud = Boolean(trip.ownerId && user)
  const copyUrl = useMemo(() => buildShareUrl(trip), [trip])
  const inviteUrl = `${location.origin}${location.pathname}?join=${trip.id}`
  const [copied, setCopied] = useState<'copy' | 'invite' | null>(null)

  const copy = async (text: string, which: 'copy' | 'invite') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      prompt('請手動複製：', text)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        {cloud && (
          <section className="share-section">
            <h3>👥 邀請共編</h3>
            <p style={{ color: 'var(--muted)', marginTop: 0 }}>
              對方用 Google 登入後打開連結，就會加入這個行程，雙方的修改會即時同步。
              {trip.members && trip.members.length > 1 && ` 目前 ${trip.members.length} 人共編。`}
            </p>
            <label className="toggle">
              <input type="checkbox" checked={Boolean(trip.allowJoin)} onChange={(e) => updateTrip({ allowJoin: e.target.checked })} />
              開放邀請連結
            </label>
            {trip.allowJoin && (
              <>
                <div className="url">{inviteUrl}</div>
                <div className="actions">
                  <button className="btn primary" onClick={() => copy(inviteUrl, 'invite')}>
                    {copied === 'invite' ? '✓ 已複製' : '複製邀請連結'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        <section className="share-section">
          <h3>🔗 分享副本</h3>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>
            整份行程壓縮編碼在網址中，收到的人打開連結會得到一份<b>獨立副本</b>，不需登入（約 {Math.round(copyUrl.length / 1024)} KB）。
          </p>
          <div className="url">{copyUrl}</div>
          <div className="actions">
            <button className="btn" onClick={onClose}>
              關閉
            </button>
            <button className={`btn ${cloud ? '' : 'primary'}`} onClick={() => copy(copyUrl, 'copy')}>
              {copied === 'copy' ? '✓ 已複製' : '複製連結'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
