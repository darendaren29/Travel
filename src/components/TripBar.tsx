import { useState } from 'react'
import { useStore, useCurrentTrip } from '../store'
import { addDays, formatDate, formatMoney, tripTotalCost } from '../utils'
import { TRAVEL_MODES, type TravelMode } from '../types'
import { useGooglePlaces } from '../places'
import { tripMode } from '../routes'

const titleEm = (name: string) => Math.max(4, [...name].reduce((n, ch) => n + (/[\u2E80-\uFFFF]/.test(ch) ? 1.08 : 0.64), 0)).toFixed(1)

export default function TripBar() {
  const trip = useCurrentTrip()
  const { updateTrip, routing, routingError } = useStore()
  const [open, setOpen] = useState(false)
  const routesEnabled = useGooglePlaces(trip.destination)
  const total = tripTotalCost(trip)
  const count = Object.keys(trip.activities).length
  const endDate = addDays(trip.startDate, trip.days.length - 1)

  return (
    <div className={`trip-bar ${open ? 'open' : ''}`}>
      <div className="trip-summary">
        <input
          className="trip-title"
          value={trip.name}
          onChange={(e) => updateTrip({ name: e.target.value })}
          placeholder="旅程名稱"
          // Size to the text (CJK ≈ 1em, Latin ≈ 0.6em, plus letter-spacing) so long names aren't cut off; CSS caps it at 100%.
          style={{ width: `calc(${titleEm(trip.name)}em + 30px)` }}
          title={trip.name}
        />
        {/* Only visible on narrow screens: toggles the detail fields below. */}
        <button className="btn sm ghost trip-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? '收合 ▴' : '設定 ▾'}
        </button>
      </div>

      <div className="trip-fields">
        <label>
          目的地
          <input
            value={trip.destination}
            onChange={(e) => updateTrip({ destination: e.target.value })}
            placeholder="例：日本・東京"
            style={{ width: 140 }}
          />
        </label>
        <label>
          出發日
          <input type="date" value={trip.startDate} onChange={(e) => updateTrip({ startDate: e.target.value })} />
        </label>
        <label>
          幣別
          <input
            value={trip.currency}
            onChange={(e) => updateTrip({ currency: e.target.value.toUpperCase() })}
            style={{ width: 64 }}
            maxLength={4}
          />
        </label>
        <label>
          預算
          <input
            type="number"
            min={0}
            value={trip.budget || ''}
            onChange={(e) => updateTrip({ budget: Number(e.target.value) || 0 })}
            style={{ width: 100 }}
            placeholder="0"
          />
        </label>
        {routesEnabled && (
          <label title="景點之間的交通時間與路徑會依此計算">
            交通
            <select value={tripMode(trip)} onChange={(e) => updateTrip({ travelMode: e.target.value as TravelMode })}>
              {(Object.keys(TRAVEL_MODES) as TravelMode[]).map((m) => (
                <option key={m} value={m}>
                  {TRAVEL_MODES[m].icon} {TRAVEL_MODES[m].label}
                </option>
              ))}
            </select>
            {routing === 'loading' && <span className="routing loading">計算路線中…</span>}
            {routing === 'error' && (
              <span className="routing error" title={routingError ?? ''}>
                部分路線無法計算
              </span>
            )}
          </label>
        )}
      </div>

      <div className="stat">
        <span>
          <b>{trip.days.length}</b> 天 · {formatDate(new Date(trip.startDate + 'T00:00:00'))} → {formatDate(endDate)}
        </span>
        <span>
          <b>{count}</b> 個活動
        </span>
        <span>
          花費 <b>{formatMoney(total, trip.currency)}</b>
          {trip.budget > 0 && (
            <span style={{ color: total > trip.budget ? 'var(--danger)' : 'var(--muted)' }}>
              {' '}
              / {formatMoney(trip.budget, trip.currency)}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
