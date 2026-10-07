import { CARTO_API_KEY } from './config'

/** Raster basemaps. Everything listed by default works without an API key. */
export type BasemapKey = 'auto' | 'osm' | 'light' | 'dark' | 'satellite' | 'topo' | 'gsi' | 'carto-voyager' | 'carto-dark'

export interface Basemap {
  key: Exclude<BasemapKey, 'auto'>
  label: string
  url: string
  /** Optional label/reference layer drawn on top (Esri "Canvas" maps split base and labels). */
  overlay?: string
  attribution: string
  maxZoom: number
  subdomains?: string
  dark?: boolean
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_CANVAS_ATTR = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors, and the GIS user community'
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`

const FREE: Basemap[] = [
  {
    key: 'osm',
    label: '標準 OSM',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTR,
    maxZoom: 19,
  },
  {
    key: 'light',
    label: '簡潔（淺灰）',
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlay: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_CANVAS_ATTR,
    maxZoom: 16,
  },
  {
    key: 'dark',
    label: '深色',
    url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlay: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_CANVAS_ATTR,
    maxZoom: 16,
    dark: true,
  },
  {
    key: 'satellite',
    label: '衛星',
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
    dark: true,
  },
  {
    key: 'topo',
    label: '地形',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTR}, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    maxZoom: 17,
  },
  {
    key: 'gsi',
    label: '日本（地理院）',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
    maxZoom: 18,
  },
]

// CARTO tiles need a (free) key since Sept 2026; only offered when one is configured.
const CARTO: Basemap[] = CARTO_API_KEY
  ? [
      {
        key: 'carto-voyager',
        label: 'CARTO Voyager',
        url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
        attribution: CARTO_ATTR,
        maxZoom: 20,
        subdomains: 'abcd',
      },
      {
        key: 'carto-dark',
        label: 'CARTO 深色',
        url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
        attribution: CARTO_ATTR,
        maxZoom: 20,
        subdomains: 'abcd',
        dark: true,
      },
    ]
  : []

export const BASEMAPS: Basemap[] = [...FREE, ...CARTO]

export const resolveBasemap = (key: BasemapKey, prefersDark: boolean): Basemap => {
  const wanted = key === 'auto' ? (prefersDark ? 'dark' : 'osm') : key
  return BASEMAPS.find((b) => b.key === wanted) ?? BASEMAPS[0]
}
