import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import App from './App'
import { consumeSharedTrip } from './share'
import { useStore } from './store'

const shared = consumeSharedTrip()
if (shared) useStore.getState().importTrip(shared)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
