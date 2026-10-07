import { useStore, useCurrentTrip } from '../store'
import { addDays, formatDate, formatMoney, tripTotalCost } from '../utils'

export default function TripBar() {
  const trip = useCurrentTrip()
  const updateTrip = useStore((s) => s.updateTrip)
  const total = tripTotalCost(trip)
  const count = Object.keys(trip.activities).length
  const endDate = addDays(trip.startDate, trip.days.length - 1)

  return (
    <div className="trip-bar">
      <input
        value={trip.name}
        onChange={(e) => updateTrip({ name: e.target.value })}
        placeholder="旅程名稱"
        style={{ fontWeight: 700, width: 180 }}
      />
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
