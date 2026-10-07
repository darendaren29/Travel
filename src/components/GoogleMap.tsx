import { useEffect } from 'react'
import { APIProvider, AdvancedMarker, InfoWindow, Map, useMap } from '@vis.gl/react-google-maps'
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAP_ID } from '../config'
import { CATEGORY_META, type Activity, type Trip } from '../types'
import { formatMoney } from '../utils'
import { navLinks } from '../nav'
import type { DayGroup } from './MapView'

interface Props {
  trip: Trip
  days: DayGroup[]
  hidden: Set<number>
  selectedId: string | null
  onSelect: (id: string | null) => void
  picking: boolean
  onPick: (lat: number, lng: number) => void
}

const DEFAULT_CENTER = { lat: 25.034, lng: 121.5645 }
const hasGeo = (a: Activity): a is Activity & { lat: number; lng: number } => a.lat != null && a.lng != null

/** Google Maps implementation of the map pane (used outside Korea when a key is configured). */
export default function GoogleMapPane({ trip, days, hidden, selectedId, onSelect, picking, onPick }: Props) {
  const visible = days.filter((d) => !hidden.has(d.index))
  const points = visible.flatMap((d) => d.activities.filter(hasGeo).map((a) => ({ lat: a.lat, lng: a.lng })))
  const selected = selectedId ? trip.activities[selectedId] : undefined
  const selectedDay = selected ? days.find((d) => d.activities.some((a) => a.id === selected.id)) : undefined

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY} language="zh-TW" region="TW">
      <Map
        mapId={GOOGLE_MAP_ID || 'DEMO_MAP_ID'}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={12}
        gestureHandling="greedy"
        disableDefaultUI={false}
        streetViewControl={false}
        fullscreenControl={false}
        clickableIcons={!picking}
        style={{ width: '100%', height: '100%' }}
        onClick={(e) => {
          if (!picking) return
          const ll = e.detail.latLng
          if (ll) onPick(ll.lat, ll.lng)
        }}
      >
        <FitBounds points={points} tripId={trip.id} />
        <PanToSelected activity={selected} />
        {visible.map((d) => (
          <DayLine key={d.index} color={d.color} path={d.activities.filter(hasGeo).map((a) => ({ lat: a.lat, lng: a.lng }))} />
        ))}
        {visible.flatMap((d) =>
          d.activities.map((a, n) =>
            hasGeo(a) ? (
              <AdvancedMarker key={a.id} position={{ lat: a.lat, lng: a.lng }} onClick={() => onSelect(a.id)} title={a.title} zIndex={selectedId === a.id ? 10 : 1}>
                <div className={`marker-pin ${selectedId === a.id ? 'selected' : ''}`} style={{ background: d.color }}>
                  <span>{n + 1}</span>
                </div>
              </AdvancedMarker>
            ) : null,
          ),
        )}
        {selected && hasGeo(selected) && selectedDay && (
          <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} pixelOffset={[0, -28]} onCloseClick={() => onSelect(null)} headerDisabled>
            <div className="gm-popup">
              <b>
                {CATEGORY_META[selected.category].icon} {selected.title}
              </b>
              <br />第 {selectedDay.index + 1} 天 · {selected.start} – {selected.end}
              {selected.location && <><br />📍 {selected.location}</>}
              {selected.cost > 0 && <><br />💰 {formatMoney(selected.cost, trip.currency)}</>}
              <div className="popup-nav">
                {navLinks(trip, selected).map((l) => (
                  <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer">
                    🧭 {l.name}
                  </a>
                ))}
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  )
}

/** Dashed polyline through a day's stops (google.maps.Polyline has no React wrapper). */
function DayLine({ path, color }: { path: google.maps.LatLngLiteral[]; color: string }) {
  const map = useMap()
  useEffect(() => {
    if (!map || path.length < 2) return
    const line = new google.maps.Polyline({
      map,
      path,
      strokeOpacity: 0,
      icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: color, scale: 3 }, offset: '0', repeat: '14px' }],
    })
    return () => line.setMap(null)
  }, [map, color, JSON.stringify(path)]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function FitBounds({ points, tripId }: { points: google.maps.LatLngLiteral[]; tripId: string }) {
  const map = useMap()
  useEffect(() => {
    if (!map || points.length === 0) return
    if (points.length === 1) {
      map.setCenter(points[0])
      map.setZoom(14)
      return
    }
    const b = new google.maps.LatLngBounds()
    points.forEach((p) => b.extend(p))
    map.fitBounds(b, 40)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tripId, points.length])
  return null
}

function PanToSelected({ activity }: { activity?: Activity }) {
  const map = useMap()
  useEffect(() => {
    if (map && activity && hasGeo(activity)) map.panTo({ lat: activity.lat, lng: activity.lng })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activity?.id])
  return null
}
