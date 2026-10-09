import { useStore } from './store'
import Header from './components/Header'
import TripBar from './components/TripBar'
import Board from './components/Board'
import MapView from './components/MapView'
import BudgetView from './components/BudgetView'
import DocsView from './components/DocsView'
import ActivityEditor from './components/ActivityEditor'
import PrintView from './components/PrintView'
import { useRouteSync } from './useRouteSync'
import { InviteGate, JoinBanner, NoticeBar } from './components/Banners'
import { useState } from 'react'

export default function App() {
  const view = useStore((s) => s.view)
  const selected = useStore((s) => s.selectedActivityId)
  const compact = useStore((s) => s.compact)
  const toggleCompact = useStore((s) => s.toggleCompact)
  const pendingJoin = useStore((s) => s.pendingJoin)
  const user = useStore((s) => s.user)
  const [gateSkipped, setGateSkipped] = useState(false)
  useRouteSync()

  // Opened an invite while signed out: welcome page instead of the (unrelated) local trip.
  if (pendingJoin && !user && !gateSkipped)
    return (
      <div className="app">
        <InviteGate onSkip={() => setGateSkipped(true)} />
        <NoticeBar />
      </div>
    )

  return (
    <div className="app">
      <JoinBanner />
      <div className={`chrome ${compact ? 'is-compact' : ''}`}>
        <Header />
        {!compact && <TripBar />}
        {/* Luggage-tag pull tab hanging from the chrome: fold the top away / bring it back. */}
        <button className="chrome-tab" onClick={toggleCompact} aria-expanded={!compact} title={compact ? '展開上方功能列' : '收合上方功能列，讓行程有更多空間'}>
          {compact ? '展開 ︾' : '收合 ︽'}
        </button>
      </div>
      <div className="main">
        <div className="content">
          {view === 'board' && <Board />}
          {view === 'map' && <MapView />}
          {view === 'budget' && <BudgetView />}
          {view === 'docs' && <DocsView />}
        </div>
        {selected && (view === 'board' || view === 'map') && <ActivityEditor />}
      </div>
      <NoticeBar />
      <PrintView />
    </div>
  )
}
