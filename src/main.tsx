import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import App from './App'
import { consumeSharedTrip } from './share'
import { useStore } from './store'
import { initAuth } from './auth'

const shared = consumeSharedTrip()
if (shared) useStore.getState().importTrip(shared)

initAuth()

// Handy for debugging from the browser console during development.
if (import.meta.env?.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
