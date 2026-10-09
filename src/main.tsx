import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import App from './App'
import { clearParam, consumeSharedTrip, readParam } from './share'
import { useStore } from './store'
import { initAuth } from './auth'
import { fetchShare, ShareOfflineError } from './sync'

// Older long links carry the whole trip in the hash.
const shared = consumeSharedTrip()
if (shared) useStore.getState().importTrip(shared)

// Short share links: ?share=<id> → fetch the snapshot and add it as the visitor's own copy.
// The parameter stays in the address until it worked, so reloading retries after a network hiccup.
const shareId = readParam('share')
if (shareId) {
  const { setNotice, importTrip } = useStore.getState()
  setNotice('正在開啟分享的行程…')
  fetchShare(shareId)
    .then((trip) => {
      clearParam('share')
      if (!trip) return setNotice('找不到這個分享的行程（連結可能不完整，或已被刪除）')
      importTrip(trip)
      setNotice(`已加入「${trip.name}」的副本，可以自由編輯`)
    })
    .catch((e) =>
      setNotice(e instanceof ShareOfflineError ? '網路連線不穩，無法開啟分享的行程。請確認網路後重新整理頁面再試一次。' : `無法開啟分享的行程：${String(e)}`),
    )
}

initAuth()

// Handy for debugging from the browser console during development.
if (import.meta.env?.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
