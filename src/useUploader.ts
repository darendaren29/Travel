import { useState } from 'react'
import { useCurrentTrip, useStore } from './store'
import { describeStorageError, guessKind, uploadTripFile, validateFile } from './files'
import type { DocKind } from './types'

export interface UploadItem {
  key: string
  name: string
  progress: number
  error?: string
}

/** Uploads files for the current trip and records their metadata on it. */
export function useUploader() {
  const trip = useCurrentTrip()
  const user = useStore((s) => s.user)
  const addTripDoc = useStore((s) => s.addTripDoc)
  const [items, setItems] = useState<UploadItem[]>([])

  // Files are stored per trip and guarded by trip membership, so the trip must be in the cloud.
  const canUpload = Boolean(user && trip.ownerId)

  const patchItem = (key: string, patch: Partial<UploadItem>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const dropItem = (key: string) => setItems((list) => list.filter((it) => it.key !== key))

  const upload = async (files: FileList | File[], opts: { kind?: DocKind; activityId?: string } = {}) => {
    if (!user || !trip.ownerId) return
    const list = Array.from(files)
    await Promise.all(
      list.map(async (file) => {
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`
        const invalid = validateFile(file)
        setItems((cur) => [...cur, { key, name: file.name, progress: 0, error: invalid ?? undefined }])
        if (invalid) {
          setTimeout(() => dropItem(key), 6000)
          return
        }
        try {
          const doc = await uploadTripFile(trip, file, {
            kind: opts.kind ?? guessKind(file.name) ?? 'other',
            activityId: opts.activityId,
            uid: user.uid,
            onProgress: (p) => patchItem(key, { progress: p }),
          })
          addTripDoc(doc)
          patchItem(key, { progress: 1 })
          setTimeout(() => dropItem(key), 1200)
        } catch (e) {
          patchItem(key, { error: describeStorageError(e) })
          setTimeout(() => dropItem(key), 8000)
        }
      }),
    )
  }

  return { items, upload, canUpload }
}
