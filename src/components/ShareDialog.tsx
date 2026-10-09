import { useMemo, useState } from 'react'
import type { Trip } from '../types'
import { buildShareUrl, inviteUrl as makeInviteUrl, shortShareUrl } from '../share'
import { publishShare } from '../sync'
import { useStore } from '../store'

export default function ShareDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { user, updateTrip } = useStore()
  const cloud = Boolean(trip.ownerId && user)
  const inviteUrl = makeInviteUrl(trip.id)
  const [copied, setCopied] = useState<'copy' | 'invite' | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Signed out: only the old self-contained link (whole trip in the URL) is possible.
  const longUrl = useMemo(() => (user ? '' : buildShareUrl(trip)), [trip, user])
  const shareUrl = trip.shareId ? shortShareUrl(trip.shareId) : ''

  const copy = async (text: string, which: 'copy' | 'invite') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      prompt('請手動複製：', text)
    }
  }

  /** Create or refresh the snapshot behind the short link, then copy the link. */
  const publish = async () => {
    if (!user) return
    setPublishing(true)
    setError(null)
    try {
      const id = await publishShare(trip, user.uid)
      if (id !== trip.shareId) updateTrip({ shareId: id })
      setPublished(true)
      await copy(shortShareUrl(id), 'copy')
    } catch (e) {
      setError(`無法建立分享連結：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPublishing(false)
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
                <p className="share-tip">在 LINE 裡點開會自動改用手機瀏覽器（App 內建瀏覽器無法 Google 登入）。</p>
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
          {user ? (
            <>
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
                產生一個短網址，收到的人打開就得到一份<b>獨立副本</b>（不需登入，他的修改不會影響你）。內容是按下按鈕當下的版本，之後修改行程可再按「更新內容」。
              </p>
              {shareUrl && <div className="url">{shareUrl}</div>}
              {error && <div className="ai-error">⚠ {error}</div>}
              <div className="actions">
                <button className="btn" onClick={onClose}>
                  關閉
                </button>
                <button className={`btn ${cloud && trip.allowJoin ? '' : 'primary'}`} onClick={() => void publish()} disabled={publishing}>
                  {publishing ? '建立中…' : copied === 'copy' && published ? '✓ 已複製連結' : shareUrl ? '更新內容並複製' : '建立分享連結'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
                整份行程壓縮在網址中（約 {Math.round(longUrl.length / 1024)} KB），收到的人打開會得到一份<b>獨立副本</b>。
              </p>
              {longUrl.length > 4000 && (
                <p className="share-tip warn">⚠ 連結很長，LINE 等通訊軟體可能會截斷而打不開。登入後可以改用短網址分享。</p>
              )}
              <div className="url">{longUrl}</div>
              <div className="actions">
                <button className="btn" onClick={onClose}>
                  關閉
                </button>
                <button className="btn primary" onClick={() => copy(longUrl, 'copy')}>
                  {copied === 'copy' ? '✓ 已複製' : '複製連結'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
