import { deleteObject, getBlob, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { storage } from './firebase'
import type { DocKind, Trip, TripDoc } from './types'
import { longId } from './utils'
import { contentTypeOf, extOf } from './fileMeta'

export { ACCEPT, MAX_FILE_BYTES, contentTypeOf, formatBytes, guessKind, kindForCategory, validateFile } from './fileMeta'

export interface UploadOptions {
  kind: DocKind
  activityId?: string
  uid: string
  onProgress?: (fraction: number) => void
}

/** Upload one file under trips/{tripId}/{docId}/ and return its metadata (not yet saved on the trip). */
export async function uploadTripFile(trip: Trip, file: File, opts: UploadOptions): Promise<TripDoc> {
  const id = longId().slice(0, 16)
  const path = `trips/${trip.id}/${id}/file${extOf(file.name)}`
  const contentType = contentTypeOf(file)
  const task = uploadBytesResumable(ref(storage, path), file, {
    contentType,
    // Opening the file shows its real name instead of "file.pdf".
    contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    customMetadata: { uploadedBy: opts.uid, originalName: file.name },
  })
  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (s) => opts.onProgress?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0),
      reject,
      () => resolve(),
    )
  })
  return {
    id,
    name: file.name,
    kind: opts.kind,
    path,
    size: file.size,
    contentType,
    uploadedAt: Date.now(),
    uploadedBy: opts.uid,
    activityId: opts.activityId,
  }
}

const urlCache = new Map<string, Promise<string>>()

export const fileUrl = (doc: TripDoc): Promise<string> => {
  let p = urlCache.get(doc.path)
  if (!p) {
    p = getDownloadURL(ref(storage, doc.path))
    p.catch(() => urlCache.delete(doc.path))
    urlCache.set(doc.path, p)
  }
  return p
}

/** View in a new tab (PDF / image viewer). The tab is opened synchronously to avoid popup blockers. */
export async function openFile(doc: TripDoc): Promise<void> {
  const win = window.open('', '_blank')
  try {
    const url = await fileUrl(doc)
    if (win) win.location.href = url
    else window.location.href = url
  } catch (e) {
    win?.close()
    throw e
  }
}

/** Save to the device with the original file name. Falls back to opening it if the blob can't be fetched. */
export async function downloadFile(doc: TripDoc): Promise<void> {
  try {
    const blob = await getBlob(ref(storage, doc.path))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch {
    await openFile(doc)
  }
}

export async function deleteTripFile(doc: TripDoc): Promise<void> {
  urlCache.delete(doc.path)
  try {
    await deleteObject(ref(storage, doc.path))
  } catch (e) {
    // Already gone is fine; anything else is a real error.
    if ((e as { code?: string }).code !== 'storage/object-not-found') throw e
  }
}

export const describeStorageError = (e: unknown): string => {
  const code = (e as { code?: string }).code ?? ''
  if (code === 'storage/unauthorized') return '沒有權限（請確認已登入、是此行程成員，且 Storage 規則已部署）'
  if (code === 'storage/quota-exceeded') return '儲存空間額度已用完'
  if (code === 'storage/retry-limit-exceeded') return '網路不穩，上傳逾時'
  if (code === 'storage/object-not-found') return '檔案已不存在'
  return e instanceof Error ? e.message : String(e)
}
