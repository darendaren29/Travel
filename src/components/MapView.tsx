import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useStore, useCurrentTrip } from '../store'
import { CATEGORY_META, type Activity } from '../types'
import { dayActivities, dayColor, formatMoney } from '../utils'

const DEFAULT_CENTER: [number, number] = [25.034, 121.5645] // Taipei

const hasGeo = (a: Activity): a is Activity & { lat: number; lng: number } => a.lat != null && a.lng != null

const pinIcon = (color: string, n: number, selected: boolean) =>
  L.divIcon({
    className: '',
    html: `<div class="marker-pin ${selected ? 'selected' : ''}" style="background:${color}"><span>${n}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -26],
  })

export default function MapView() {
  const trip = useCurrentTrip()
  const { selectedActivityId, select, pickingLocationFor, setPickingLocation, updateActivity } = useStore()
  const [hidden, setHidden] = useState<Set<number>>(new Set())

  const days = useMemo(
    () =>
      trip.days.map((_, i) => ({
        index: i,
        color: dayColor(i),
        activities: dayActivities(trip, i),
      })),
    [trip],
  )

  const points = useMemo(
    () => days.filter((d) => !hidden.has(d.index)).flatMap((d) => d.activities.filter(hasGeo).map((a) => [a.lat, a.lng] as [number, number])),
    [days, hidden],
  )

  const toggleDay = (i: number) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const onPick = (lat: number, lng: number) => {
    if (!pickingLocationFor) return
    updateActivity(pickingLocationFor, { lat, lng })
    setPickingLocation(null)
    select(pickingLocationFor)
  }

  const selected = selectedActivityId ? trip.activities[selectedActivityId] : undefined

  return (
    <div className="map-layout">
      <aside className="map-side">
        {days.map((d) => (
          <div key={d.index}>
            <h4>
              <span className="dot" style={{ width: 10, height: 10, borderRadius: 5, background: d.color, display: 'inline-block' }} />
              第 {d.index + 1} 天
              <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({d.activities.filter(hasGeo).length}/{d.activities.length} 已定位)</span>
            </h4>
            {d.activities.map((a, n) => (
              <div
                key={a.id}
                className={`item ${selectedActivityId === a.id ? 'selected' : ''} ${hasGeo(a) ? '' : 'nogeo'}`}
                onClick={() => select(a.id)}
              >
                <span className={`n ${hasGeo(a) ? '' : 'nogeo'}`} style={{ background: hasGeo(a) ? d.color : undefined }}>
                  {n + 1}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {CATEGORY_META[a.category].icon} {a.title}
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }}>{a.start}</span>
              </div>
            ))}
          </div>
        ))}
      </aside>

      <div className={`map-wrap ${pickingLocationFor ? 'picking' : ''}`}>
        <MapContainer center={DEFAULT_CENTER} zoom={12} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={points} tripId={trip.id} />
          <FlyToSelected activity={selected} />
          <ClickCapture enabled={Boolean(pickingLocationFor)} onPick={onPick} />

          {days
            .filter((d) => !hidden.has(d.index))
            .map((d) => {
              const geo = d.activities.filter(hasGeo)
              return (
                <div key={d.index}>
                  {geo.length > 1 && (
                    <Polyline positions={geo.map((a) => [a.lat, a.lng])} pathOptions={{ color: d.color, weight: 3, opacity: 0.7, dashArray: '6 6' }} />
                  )}
                  {d.activities.map((a, n) =>
                    hasGeo(a) ? (
                      <Marker
                        key={a.id}
                        position={[a.lat, a.lng]}
                        icon={pinIcon(d.color, n + 1, selectedActivityId === a.id)}
                        eventHandlers={{ click: () => select(a.id) }}
                      >
                        <Popup>
                          <b>
                            {CATEGORY_META[a.category].icon} {a.title}
                          </b>
                          <br />
                          第 {d.index + 1} 天 · {a.start} – {a.end}
                          {a.location && (
                            <>
                              <br />📍 {a.location}
                            </>
                          )}
                          {a.cost > 0 && (
                            <>
                              <br />💰 {formatMoney(a.cost, trip.currency)}
                            </>
                          )}
                        </Popup>
                      </Marker>
                    ) : null,
                  )}
                </div>
              )
            })}
        </MapContainer>

        <div className="map-legend">
          {pickingLocationFor && <div style={{ color: 'var(--warn)', fontWeight: 600 }}>點擊地圖設定位置</div>}
          {days.map((d) => (
            <label key={d.index}>
              <input type="checkbox" checked={!hidden.has(d.index)} onChange={() => toggleDay(d.index)} style={{ width: 'auto' }} />
              <span className="sw" style={{ background: d.color }} />第 {d.index + 1} 天
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

function FitBounds({ points, tripId }: { points: [number, number][]; tripId: string }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) map.setView(points[0], 14)
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40] })
    // Only re-fit when the trip changes or the number of points changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, points.length])
  return null
}

function FlyToSelected({ activity }: { activity?: Activity }) {
  const map = useMap()
  useEffect(() => {
    if (activity && hasGeo(activity)) map.panTo([activity.lat, activity.lng])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.id])
  return null
}

function ClickCapture({ enabled, onPick }: { enabled: boolean; onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      if (enabled) onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}
