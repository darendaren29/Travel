import { useMemo, useState } from 'react'
import type { Trip } from '../types'
import { buildShareUrl } from '../share'

export default function ShareDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const url = useMemo(() => buildShareUrl(trip), [trip])
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      prompt('請手動複製：', url)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>🔗 分享行程</h3>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          整份行程已壓縮編碼在網址中，收到的人打開連結即可匯入一份副本（約 {Math.round(url.length / 1024)} KB）。
        </p>
        <div className="url">{url}</div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            關閉
          </button>
          <button className="btn primary" onClick={copy}>
            {copied ? '✓ 已複製' : '複製連結'}
          </button>
        </div>
      </div>
    </div>
  )
}
