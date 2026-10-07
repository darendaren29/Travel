import { useStore } from './store'
import Header from './components/Header'
import TripBar from './components/TripBar'
import Board from './components/Board'
import MapView from './components/MapView'
import BudgetView from './components/BudgetView'
import ActivityEditor from './components/ActivityEditor'
import PrintView from './components/PrintView'

export default function App() {
  const view = useStore((s) => s.view)
  const selected = useStore((s) => s.selectedActivityId)

  return (
    <div className="app">
      <Header />
      <TripBar />
      <div className="main">
        <div className="content">
          {view === 'board' && <Board />}
          {view === 'map' && <MapView />}
          {view === 'budget' && <BudgetView />}
        </div>
        {selected && view !== 'budget' && <ActivityEditor />}
      </div>
      <PrintView />
    </div>
  )
}
