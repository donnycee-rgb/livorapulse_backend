import type { Candidate, LatLng } from '../utils/walkRoute'

// ─── Named places near a point, from OpenStreetMap ──────────────────────────
// Asked once when someone sets up their walking journey. Only the rounded
// point (~1 km) is sent; nothing about the person. If the service is slow or
// down, the route is built from the built-in town list instead.

// Public mirrors of the same OpenStreetMap service, tried in turn
const MIRRORS = (process.env.OVERPASS_URLS || [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
].join(',')).split(',').map((u) => u.trim()).filter(Boolean)
const RANK: Record<string, number> = { city: 3, town: 2, suburb: 1, quarter: 1, neighbourhood: 1, village: 0 }

type Fetcher = (p: LatLng) => Promise<Candidate[]>

async function overpass(p: LatLng): Promise<Candidate[]> {
  for (const url of MIRRORS) {
    const found = await ask(url, p)
    if (found) return found
  }
  console.warn('[Places] No map mirror answered; using the built-in town list')
  return []
}

/** One mirror: the places, or null if it didn't answer properly (try the next) */
async function ask(url: string, p: LatLng): Promise<Candidate[] | null> {
  const query = `[out:json][timeout:12];node["place"~"^(city|town|suburb|quarter|neighbourhood|village)$"](around:60000,${p.lat},${p.lng});out body 600;`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'LivoraPulse/1.0 (walking journey)' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { elements?: Array<{ lat: number; lon: number; tags?: Record<string, string> }> }
    return (json.elements ?? [])
      .map((e) => ({ name: e.tags?.['name:en'] || e.tags?.name || '', lat: e.lat, lng: e.lon, rank: RANK[e.tags?.place ?? ''] ?? 0 }))
      .filter((c) => c.name)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

let fetcher: Fetcher = overpass
/** Tests swap in a fake */
export function setPlacesFetcher(fn: Fetcher): void { fetcher = fn }

export const nearbyPlaces = (p: LatLng) => fetcher(p)
