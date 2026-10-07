import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useStore, useCurrentTrip } from '../store'
import { CATEGORY_META, type Activity, type Trip } from '../types'
import { dayActivities, dayColor, formatMoney } from '../utils'
import { BASEMAPS, resolveBasemap, type BasemapKey } from '../basemaps'
import { navLinks } from '../nav'
import { useGooglePlaces } from '../places'
import GoogleMapPane from './GoogleMap'

export interface DayGroup {
  index: number
  color: string
  activities: Activity[]
}

interface PaneProps {
  trip: Trip
  days: DayGroup[]
  hidden: Set<number>
  selectedId: string | null
  onSelect: (id: string | null) => void
  picking: boolean
  onPick: (lat: number, lng: number) => void
}

const DEFAULT_CENTER: [number, number] = [25.034, 121.5645] // Taipei

const hasGeo = (a: Activity): a is Activity & { lat: number; lng: number } => a.lat != null && a.lng != null

/** Tracks the OS dark-mode preference. */
const usePrefersDark = () => {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return dark
}

export default function MapView() {
  const trip = useCurrentTrip()
  const { selectedActivityId, select, pickingLocationFor, setPickingLocation, updateActivity, basemap, setBasemap } = useStore()
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  // Google Maps everywhere except Korea (and only when a key is configured).
  const google = useGooglePlaces(trip.destination)

  const days = useMemo<DayGroup[]>(
    () => trip.days.map((_, i) => ({ index: i, color: dayColor(i), activities: dayActivities(trip, i) })),
    [trip],
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

  const paneProps: PaneProps = {
    trip,
    days,
    hidden,
    selectedId: selectedActivityId,
    onSelect: select,
    picking: Boolean(pickingLocationFor),
    onPick,
  }

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
        {google ? <GoogleMapPane {...paneProps} /> : <LeafletPane {...paneProps} />}

        <div className="map-legend">
          {pickingLocationFor && <div style={{ color: 'var(--warn)', fontWeight: 600 }}>點擊地圖設定位置</div>}
          {!google && (
            <label className="basemap-select">
              底圖
              <select value={basemap} onChange={(e) => setBasemap(e.target.value as BasemapKey)}>
                <option value="auto">自動（跟隨深色模式）</option>
                {BASEMAPS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          )}
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

const pinIcon = (color: string, n: number, selected: boolean) =>
  L.divIcon({
    className: '',
    html: `<div class="marker-pin ${selected ? 'selected' : ''}" style="background:${color}"><span>${n}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -26],
  })

/** Leaflet / OpenStreetMap implementation (Korea, or no Google key). */
function LeafletPane({ trip, days, hidden, selectedId, onSelect, picking, onPick }: PaneProps) {
  const basemap = useStore((s) => s.basemap)
  const prefersDark = usePrefersDark()
  const tiles = resolveBasemap(basemap, prefersDark)
  const visible = days.filter((d) => !hidden.has(d.index))
  const points = visible.flatMap((d) => d.activities.filter(hasGeo).map((a) => [a.lat, a.lng] as [number, number]))
  const selected = selectedId ? trip.activities[selectedId] : undefined

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={12} scrollWheelZoom>
      <TileLayer key={tiles.key} attribution={tiles.attribution} url={tiles.url} maxZoom={tiles.maxZoom} subdomains={tiles.subdomains ?? 'abc'} />
      {tiles.overlay && <TileLayer key={`${tiles.key}-labels`} url={tiles.overlay} maxZoom={tiles.maxZoom} zIndex={2} />}
      <FitBounds points={points} tripId={trip.id} />
      <FlyToSelected activity={selected} />
      <ClickCapture enabled={picking} onPick={onPick} />

      {visible.map((d) => {
        const geo = d.activities.filter(hasGeo)
        return (
          <div key={d.index}>
            {geo.length > 1 && (
              <Polyline positions={geo.map((a) => [a.lat, a.lng])} pathOptions={{ color: d.color, weight: 3, opacity: 0.7, dashArray: '6 6' }} />
            )}
            {d.activities.map((a, n) =>
              hasGeo(a) ? (
                <Marker key={a.id} position={[a.lat, a.lng]} icon={pinIcon(d.color, n + 1, selectedId === a.id)} eventHandlers={{ click: () => onSelect(a.id) }}>
                  <Popup>
                    <b>
                      {CATEGORY_META[a.category].icon} {a.title}
                    </b>
                    <br />第 {d.index + 1} 天 · {a.start} – {a.end}
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
                    <div className="popup-nav">
                      {navLinks(trip, a).map((l) => (
                        <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer">
                          🧭 {l.name}
                        </a>
                      ))}
                    </div>
                  </Popup>
                </Marker>
              ) : null,
            )}
          </div>
        )
      })}
    </MapContainer>
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
