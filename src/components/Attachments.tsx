import { useRef, useState } from 'react'
import { useCurrentTrip, useStore } from '../store'
import { DOC_KINDS, type Activity, type TripDoc } from '../types'
import { ACCEPT, describeStorageError, downloadFile, kindForCategory, openFile } from '../files'
import { useUploader } from '../useUploader'
import { UploadQueue } from './DocsView'

/** Files linked to one activity, with quick upload (shown in the activity editor). */
export default function Attachments({ activity }: { activity: Activity }) {
  const trip = useCurrentTrip()
  const { updateTripDoc, setView } = useStore()
  const { items, upload, canUpload } = useUploader()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const all = Object.values(trip.docs ?? {})
  const linked = all.filter((d) => d.activityId === activity.id)
  const unlinked = all.filter((d) => !d.activityId)

  const run = async (doc: TripDoc, fn: (d: TripDoc) => Promise<void>) => {
    setBusy(doc.id)
    try {
      await fn(doc)
    } catch (e) {
      alert(describeStorageError(e))
    } finally {
      setBusy(null)
    }
  }

  if (!canUpload) {
    return (
      <div className="field">
        <label>票券 / 附件</label>
        <div className="coords">登入並同步到雲端後，即可在這裡附上機票、訂房確認或門票。</div>
      </div>
    )
  }

  return (
    <div className="field">
      <label>票券 / 附件</label>
      {linked.length > 0 && (
        <ul className="attach-list">
          {linked.map((d) => (
            <li key={d.id}>
              <span className="ic">{DOC_KINDS[d.kind].icon}</span>
              <button className="nm" onClick={() => void run(d, openFile)} disabled={busy === d.id} title="開啟">
                {d.name}
              </button>
              <button className="btn sm ghost" onClick={() => void run(d, downloadFile)} disabled={busy === d.id} title="下載">
                ⬇
              </button>
              <button className="btn sm ghost" onClick={() => updateTripDoc(d.id, { activityId: undefined })} title="取消連結">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <UploadQueue items={items} />
      <div className="row" style={{ alignItems: 'center' }}>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files, { kind: kindForCategory(activity.category), activityId: activity.id })
            e.target.value = ''
          }}
        />
        <button className="btn sm" style={{ flex: '0 0 auto' }} onClick={() => inputRef.current?.click()}>
          📎 上傳附件
        </button>
        {unlinked.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && updateTripDoc(e.target.value, { activityId: activity.id })}
            aria-label="從票券夾連結"
            style={{ fontSize: 12, padding: '4px 6px' }}
          >
            <option value="">從票券夾連結…</option>
            {unlinked.map((d) => (
              <option key={d.id} value={d.id}>
                {DOC_KINDS[d.kind].icon} {d.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn sm ghost" style={{ flex: '0 0 auto' }} onClick={() => setView('docs')} title="開啟票券夾">
          🎫
        </button>
      </div>
    </div>
  )
}
