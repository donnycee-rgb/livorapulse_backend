// ─── The walking journey, from where the person is ──────────────────────────
// "You've walked 40 km this week, about as far as Kondele to Maseno." The
// route is built once from a rough location (rounded to ~1 km, never stored):
// named places around it (from OpenStreetMap, see PlacesService) and Kenyan
// towns further out (below), picked so the stops are spread from a couple of
// km to a few hundred. Distances are straight-line × a road factor: "about".
// Pure functions: no network, no database.

export type LatLng = { lat: number; lng: number }
/** A named place; rank: 3 city, 2 town, 1 suburb / neighbourhood, 0 village */
export type Candidate = LatLng & { name: string; rank: number }
export type Stop = { name: string; km: number }
export type WalkRoute = { area: string; stops: Stop[] }

/** Roads wind: about 1.25 × the straight line, on average */
export const ROAD_FACTOR = 1.25

export function straightKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const roadKm = (a: LatLng, b: LatLng) => {
  const km = straightKm(a, b) * ROAD_FACTOR
  return km < 10 ? Math.round(km * 10) / 10 : Math.round(km)
}

/** About 1 km: enough for "the area around you", not a home address */
export const roundLocation = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 })

/** Kenyan towns, for stops further out and for when the map service can't be reached. Approximate centres. */
export const KENYA_TOWNS: Candidate[] = ([
  ['Nairobi', -1.286, 36.817, 3], ['Mombasa', -4.043, 39.668, 3], ['Kisumu', -0.102, 34.762, 3], ['Nakuru', -0.303, 36.080, 3],
  ['Eldoret', 0.514, 35.270, 3], ['Thika', -1.033, 37.069, 2], ['Nyeri', -0.420, 36.947, 2], ['Machakos', -1.517, 37.263, 2],
  ['Kakamega', 0.282, 34.752, 2], ['Meru', 0.047, 37.649, 2], ['Kisii', -0.677, 34.780, 2], ['Malindi', -3.218, 40.117, 2],
  ['Kitale', 1.016, 35.006, 2], ['Garissa', -0.453, 39.646, 2], ['Embu', -0.531, 37.450, 2], ['Kericho', -0.367, 35.283, 2],
  ['Naivasha', -0.717, 36.433, 2], ['Nanyuki', 0.007, 37.074, 2], ['Voi', -3.396, 38.556, 2], ['Lamu', -2.271, 40.902, 2],
  ['Isiolo', 0.354, 37.582, 2], ['Bungoma', 0.563, 34.561, 2], ['Busia', 0.460, 34.111, 2], ['Homa Bay', -0.527, 34.457, 2],
  ['Migori', -1.063, 34.473, 2], ['Narok', -1.078, 35.860, 2], ['Kitui', -1.367, 38.010, 2], ['Lodwar', 3.119, 35.597, 2],
  ['Marsabit', 2.335, 37.990, 2], ['Wajir', 1.747, 40.057, 2], ['Mandera', 3.937, 41.856, 2], ['Kilifi', -3.630, 39.850, 2],
  ['Kajiado', -1.852, 36.776, 2], ['Nyahururu', 0.038, 36.364, 2], ["Murang'a", -0.721, 37.153, 2], ['Kerugoya', -0.498, 37.280, 2],
  ['Siaya', 0.061, 34.288, 2], ['Vihiga', 0.076, 34.722, 2], ['Webuye', 0.607, 34.770, 2], ['Iten', 0.671, 35.508, 2],
  ['Kapsabet', 0.203, 35.105, 2], ['Chuka', -0.333, 37.646, 2], ['Mwingi', -0.934, 38.060, 2], ['Kabarnet', 0.492, 35.743, 2],
  ['Maralal', 1.097, 36.698, 2], ['Moyale', 3.527, 39.056, 2], ['Wote', -1.783, 37.633, 2], ['Emali', -2.083, 37.467, 2],
  ['Namanga', -2.545, 36.785, 2], ['Kapenguria', 1.239, 35.112, 2], ['Eldama Ravine', 0.050, 35.717, 2], ['Molo', -0.250, 35.733, 2],
  ['Gilgil', -0.500, 36.317, 2], ['Ruiru', -1.150, 36.960, 2], ['Kiambu', -1.171, 36.835, 2], ['Limuru', -1.105, 36.642, 2],
  ['Karatina', -0.483, 37.130, 2], ['Othaya', -0.550, 36.933, 2], ['Ol Kalou', -0.270, 36.380, 2], ['Mumias', 0.336, 34.489, 2],
  ['Athi River', -1.456, 36.978, 2], ['Kangundo', -1.300, 37.350, 2], ['Mtwapa', -3.950, 39.745, 2], ['Ukunda', -4.280, 39.570, 2],
] as Array<[string, number, number, number]>).map(([name, lat, lng, rank]) => ({ name, lat, lng, rank }))

/** Distances along the way: a couple of km to the other end of the country */
const TARGETS = [2, 4, 7, 10, 15, 21, 30, 42, 60, 80, 100, 150, 200, 300, 450]

/**
 * Build the route from `origin`: the start is named after the closest place
 * (within 4 km), then for each target distance the best-fitting place not
 * used yet, bigger places preferred when distances are close. Null when too
 * few places are found (the app then shows plain distances).
 */
export function buildRoute(origin: LatLng, nearby: Candidate[], towns: Candidate[] = KENYA_TOWNS): WalkRoute | null {
  const seen = new Set<string>()
  const all = [...nearby, ...towns]
    .filter((c) => c.name && c.name.trim().length > 1)
    .map((c) => ({ ...c, name: c.name.trim(), km: roadKm(origin, c) }))
    .filter((c) => { const k = c.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.km - b.km)

  const closest = all.find((c) => c.km <= 4)
  const nearTown = all.find((c) => c.rank >= 2 && c.km <= 25)
  const area = closest?.name ?? (nearTown ? `near ${nearTown.name}` : 'Your area')

  const used = new Set<string>(closest ? [closest.name] : [])
  const stops: Stop[] = []
  let last = 0
  for (const t of TARGETS) {
    const lo = Math.max(last * 1.3, last + 1)
    const hi = t * 1.5
    let best: (typeof all)[number] | null = null
    let bestScore = Infinity
    for (const c of all) {
      if (c.km < lo || c.km > hi || used.has(c.name)) continue
      const score = Math.abs(c.km - t) / t - c.rank * 0.08
      if (score < bestScore) { bestScore = score; best = c }
    }
    if (best) {
      stops.push({ name: best.name, km: best.km })
      used.add(best.name)
      last = best.km
    }
    if (stops.length >= 12) break
  }
  return stops.length >= 4 ? { area, stops } : null
}

/** A town from the list by name (for people who'd rather pick than share their location) */
export const townByName = (name: string) => KENYA_TOWNS.find((t) => t.name.toLowerCase() === name.trim().toLowerCase()) ?? null
