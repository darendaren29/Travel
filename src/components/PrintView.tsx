import { useCurrentTrip } from '../store'
import { CATEGORY_META } from '../types'
import { addDays, dayActivities, dayCost, formatDate, formatMoney, tripTotalCost } from '../utils'

/** Rendered only when printing (see @media print in styles.css). */
export default function PrintView() {
  const trip = useCurrentTrip()
  return (
    <div className="print-only">
      <h1>{trip.name}</h1>
      <div>
        {trip.destination && `${trip.destination} · `}
        {formatDate(new Date(trip.startDate + 'T00:00:00'))} 起，共 {trip.days.length} 天 · 總花費 {formatMoney(tripTotalCost(trip), trip.currency)}
      </div>
      {trip.days.map((_, i) => {
        const acts = dayActivities(trip, i)
        return (
          <div key={i}>
            <h2>
              第 {i + 1} 天 · {formatDate(addDays(trip.startDate, i))} · {formatMoney(dayCost(trip, i), trip.currency)}
            </h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>時間</th>
                  <th>活動</th>
                  <th>地點</th>
                  <th style={{ width: 90 }}>花費</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.start} – {a.end}
                    </td>
                    <td>
                      {CATEGORY_META[a.category].icon} {a.title}
                    </td>
                    <td>{a.location ?? ''}</td>
                    <td>{a.cost ? formatMoney(a.cost, trip.currency) : ''}</td>
                    <td>{a.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
