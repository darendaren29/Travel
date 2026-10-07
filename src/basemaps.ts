/** Free raster basemaps that need no API key. */
export type BasemapKey = 'auto' | 'osm' | 'voyager' | 'dark' | 'satellite' | 'topo' | 'gsi'

export interface Basemap {
  key: Exclude<BasemapKey, 'auto'>
  label: string
  url: string
  attribution: string
  maxZoom: number
  subdomains?: string
  dark?: boolean
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const BASEMAPS: Basemap[] = [
  {
    key: 'voyager',
    label: '簡潔',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
    maxZoom: 20,
    subdomains: 'abcd',
  },
  {
    key: 'osm',
    label: '標準 OSM',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTR,
    maxZoom: 19,
  },
  {
    key: 'dark',
    label: '深色',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
    maxZoom: 20,
    subdomains: 'abcd',
    dark: true,
  },
  {
    key: 'satellite',
    label: '衛星',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
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

export const resolveBasemap = (key: BasemapKey, prefersDark: boolean): Basemap => {
  const wanted = key === 'auto' ? (prefersDark ? 'dark' : 'voyager') : key
  return BASEMAPS.find((b) => b.key === wanted) ?? BASEMAPS[0]
}
