import type { Category, DocKind } from './types'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
/** Must match storage.rules. */
export const ACCEPT = 'application/pdf,image/*,.pkpass,application/vnd.apple.pkpass'

const ALLOWED = /^(image\/.+|application\/pdf|application\/vnd\.apple\.pkpass)$/

/** Browsers often report .pkpass as empty or octet-stream; fix it up from the extension. */
export const contentTypeOf = (file: Pick<File, 'name' | 'type'>): string => {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'pkpass') return 'application/vnd.apple.pkpass'
  if (ext === 'pdf') return 'application/pdf'
  if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`
  return file.type || 'application/octet-stream'
}

/** Returns a user-facing reason the file can't be uploaded, or null when it's fine. */
export const validateFile = (file: Pick<File, 'name' | 'type' | 'size'>): string | null => {
  if (file.size > MAX_FILE_BYTES) return `「${file.name}」超過 20 MB`
  if (!ALLOWED.test(contentTypeOf(file))) return `「${file.name}」格式不支援（可上傳 PDF、圖片、Apple Wallet .pkpass）`
  return null
}

export const kindForCategory = (c?: Category): DocKind =>
  c === 'transport' ? 'flight' : c === 'lodging' ? 'lodging' : c === 'sight' ? 'ticket' : 'other'

/** Guess the kind from a file name like "Boarding pass.pdf" or "Booking confirmation.pdf". */
export const guessKind = (name: string): DocKind | null => {
  const n = name.toLowerCase()
  if (/boarding|flight|e-?ticket|itinerary|airline|機票|登機|航班|搭乗|eva|china ?airlines|starlux|jal|ana|peach/.test(n)) return 'flight'
  if (/hotel|booking|agoda|airbnb|reservation|check-?in|住宿|飯店|旅館|民宿|ホテル/.test(n)) return 'lodging'
  if (/ticket|pass|admission|門票|入場|票券|チケット|klook|kkday/.test(n)) return 'ticket'
  return null
}

export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

export const extOf = (name: string): string => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name)
  return m ? `.${m[1].toLowerCase()}` : ''
}
