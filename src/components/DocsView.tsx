import { useEffect, useMemo, useRef, useState } from 'react'
import { useCurrentTrip, useStore } from '../store'
import { DOC_KINDS, type DocKind, type Trip, type TripDoc } from '../types'
import { ACCEPT, deleteTripFile, describeStorageError, downloadFile, fileUrl, formatBytes, openFile } from '../files'
import { useUploader, type UploadItem } from '../useUploader'
import { signIn } from '../auth'
import { dayActivities } from '../utils'

const KINDS = Object.keys(DOC_KINDS) as DocKind[]

export default function DocsView() {
  const trip = useCurrentTrip()
  const user = useStore((s) => s.user)
  const { items, upload, canUpload } = useUploader()
  const [filter, setFilter] = useState<DocKind | 'all'>('all')
  const [uploadKind, setUploadKind] = useState<DocKind | 'auto'>('auto')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const docs = useMemo(() => Object.values(trip.docs ?? {}).sort((a, b) => b.uploadedAt - a.uploadedAt), [trip.docs])
  const counts = useMemo(() => {
    const c: Record<DocKind, number> = { flight: 0, lodging: 0, ticket: 0, other: 0 }
    docs.forEach((d) => c[d.kind]++)
    return c
  }, [docs])
  const shownKinds = filter === 'all' ? KINDS : [filter]

  const send = (files: FileList | null) => {
    if (!files?.length) return
    void upload(files, { kind: uploadKind === 'auto' ? undefined : uploadKind })
  }

  if (!canUpload) {
    return (
      <div className="docs">
        <div className="docs-locked">
          <div className="stamp">🎫</div>
          <h3>票券夾</h3>
          <p>機票、住宿確認信、門票等檔案會存在雲端，並與共編成員共享。{user ? '這個旅程還沒同步到雲端，請稍候再試。' : '請先登入。'}</p>
          {!user && (
            <button className="btn primary" onClick={() => void signIn()}>
              Google 登入
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="docs">
      <label
        className={`dropzone ${dragging ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          send(e.dataTransfer.files)
        }}
      >
        <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (send(e.target.files), (e.target.value = ''))} />
        <span className="dz-icon">✈</span>
        <span className="dz-title">拖曳檔案到這裡，或點擊選擇</span>
        <span className="dz-sub">PDF、圖片（可直接拍照）、Apple Wallet .pkpass · 單檔 20 MB 以內</span>
        <span className="dz-kind" onClick={(e) => e.preventDefault()}>
          分類
          <select value={uploadKind} onChange={(e) => setUploadKind(e.target.value as DocKind | 'auto')}>
            <option value="auto">自動判斷</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {DOC_KINDS[k].icon} {DOC_KINDS[k].label}
              </option>
            ))}
          </select>
        </span>
      </label>

      <UploadQueue items={items} />

      <div className="doc-filters">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          全部 <b>{docs.length}</b>
        </button>
        {KINDS.map((k) => (
          <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)} data-kind={k}>
            {DOC_KINDS[k].icon} {DOC_KINDS[k].label} <b>{counts[k]}</b>
          </button>
        ))}
      </div>

      {docs.length === 0 && <div className="docs-empty">還沒有任何檔案。把登機證、訂房確認信或門票 QR Code 截圖丟進來吧。</div>}

      {shownKinds.map((k) => {
        const list = docs.filter((d) => d.kind === k)
        if (!list.length) return null
        return (
          <section key={k} className="doc-group">
            <h3>
              <span>{DOC_KINDS[k].icon}</span> {DOC_KINDS[k].label}
              <small>{list.length}</small>
            </h3>
            <div className="doc-grid">
              {list.map((d, i) => (
                <DocTile key={d.id} trip={trip} doc={d} index={i} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function UploadQueue({ items }: { items: UploadItem[] }) {
  if (!items.length) return null
  return (
    <ul className="upload-queue">
      {items.map((it) => (
        <li key={it.key} className={it.error ? 'error' : it.progress >= 1 ? 'done' : ''}>
          <span className="name">{it.name}</span>
          {it.error ? (
            <span className="msg">⚠ {it.error}</span>
          ) : (
            <span className="bar">
              <i style={{ width: `${Math.round(it.progress * 100)}%` }} />
            </span>
          )}
          <span className="pct">{it.error ? '' : it.progress >= 1 ? '✓' : `${Math.round(it.progress * 100)}%`}</span>
        </li>
      ))}
    </ul>
  )
}

/** Activity choices for linking a file, labelled "D1 09:30 築地…". */
const activityOptions = (trip: Trip) =>
  trip.days.flatMap((_, di) => dayActivities(trip, di).map((a) => ({ id: a.id, label: `D${di + 1} ${a.start} ${a.title}` })))

function DocTile({ trip, doc, index }: { trip: Trip; doc: TripDoc; index: number }) {
  const { updateTripDoc, removeTripDoc, select, setView } = useStore()
  const [busy, setBusy] = useState(false)
  const isImage = doc.contentType.startsWith('image/')
  const isPdf = doc.contentType === 'application/pdf'
  const linked = doc.activityId ? trip.activities[doc.activityId] : undefined

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      alert(describeStorageError(e))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = () =>
    confirm(`刪除「${doc.name}」？共編成員也會看不到這個檔案。`) &&
    run(async () => {
      await deleteTripFile(doc)
      removeTripDoc(doc.id)
    })

  const onRename = () => {
    const name = prompt('檔案名稱', doc.name)?.trim()
    if (name && name !== doc.name) updateTripDoc(doc.id, { name })
  }

  return (
    <article className={`doc-tile kind-${doc.kind}`} style={{ '--i': index } as React.CSSProperties}>
      <button className="doc-preview" onClick={() => void run(() => openFile(doc))} title="開啟檢視" disabled={busy}>
        {isImage ? <Thumb doc={doc} /> : <span className="doc-type">{isPdf ? 'PDF' : 'PASS'}</span>}
      </button>
      <div className="doc-body">
        <button className="doc-name" onClick={onRename} title="點擊重新命名">
          {doc.name}
        </button>
        <div className="doc-meta">
          {formatBytes(doc.size)} · {new Date(doc.uploadedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}
        </div>
        <div className="doc-fields">
          <select value={doc.kind} onChange={(e) => updateTripDoc(doc.id, { kind: e.target.value as DocKind })} aria-label="分類">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {DOC_KINDS[k].icon} {DOC_KINDS[k].label}
              </option>
            ))}
          </select>
          <select value={doc.activityId ?? ''} onChange={(e) => updateTripDoc(doc.id, { activityId: e.target.value || undefined })} aria-label="連結活動">
            <option value="">— 未連結活動 —</option>
            {activityOptions(trip).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {linked && (
          <button
            className="doc-link"
            onClick={() => {
              setView('board')
              select(linked.id)
            }}
          >
            ↗ {linked.title}
          </button>
        )}
      </div>
      <div className="doc-actions">
        <button className="btn sm" onClick={() => void run(() => openFile(doc))} disabled={busy}>
          開啟
        </button>
        <button className="btn sm" onClick={() => void run(() => downloadFile(doc))} disabled={busy}>
          下載
        </button>
        <button className="btn sm ghost danger" onClick={onDelete} disabled={busy}>
          刪除
        </button>
      </div>
    </article>
  )
}

function Thumb({ doc }: { doc: TripDoc }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fileUrl(doc)
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null))
    return () => {
      alive = false
    }
  }, [doc])
  return src ? <img src={src} alt="" loading="lazy" /> : <span className="doc-type">IMG</span>
}
