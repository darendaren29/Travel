import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import App from './App'
import { consumeParam, consumeSharedTrip } from './share'
import { useStore } from './store'
import { initAuth } from './auth'
import { fetchShare } from './sync'

// Older long links carry the whole trip in the hash.
const shared = consumeSharedTrip()
if (shared) useStore.getState().importTrip(shared)

// Short share links: ?share=<id> → fetch the snapshot and add it as the visitor's own copy.
const shareId = consumeParam('share')
if (shareId) {
  useStore.getState().setNotice('正在開啟分享的行程…')
  fetchShare(shareId)
    .then((trip) => {
      if (!trip) throw new Error('找不到這個分享（可能已被刪除）')
      useStore.getState().importTrip(trip)
      useStore.getState().setNotice(`已加入「${trip.name}」的副本，可以自由編輯`)
    })
    .catch((e) => useStore.getState().setNotice(`無法開啟分享的行程：${e instanceof Error ? e.message : String(e)}`))
}

initAuth()

// Handy for debugging from the browser console during development.
if (import.meta.env?.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
