import { describe, expect, it } from 'vitest'
import { KENYA_TOWNS, buildRoute, roadKm, roundLocation, type Candidate } from '../src/utils/walkRoute'

const KONDELE = { lat: -0.087, lng: 34.770 }
const nearKisumu: Candidate[] = [
  { name: 'Kondele', lat: -0.085, lng: 34.771, rank: 1 },
  { name: 'Mamboleo', lat: -0.067, lng: 34.795, rank: 1 },
  { name: 'Kibos', lat: -0.050, lng: 34.820, rank: 0 },
  { name: 'Kisian', lat: -0.080, lng: 34.660, rank: 0 },
  { name: 'Maseno', lat: 0.000, lng: 34.600, rank: 2 },
  { name: 'Ahero', lat: -0.170, lng: 34.920, rank: 2 },
  { name: 'Kisumu', lat: -0.102, lng: 34.762, rank: 3 },
]

describe('distances', () => {
  it('about the road distance: Nairobi to Thika ≈ 45 km', () => {
    const nbi = KENYA_TOWNS.find((t) => t.name === 'Nairobi')!
    const thika = KENYA_TOWNS.find((t) => t.name === 'Thika')!
    expect(roadKm(nbi, thika)).toBeGreaterThan(38)
    expect(roadKm(nbi, thika)).toBeLessThan(52)
  })

  it('a location is rounded to about 1 km before it goes anywhere', () => {
    expect(roundLocation({ lat: -0.0874321, lng: 34.7701234 })).toEqual({ lat: -0.09, lng: 34.77 })
  })
})

describe('the route from where someone is', () => {
  const route = buildRoute(KONDELE, nearKisumu)!

  it('starts from the closest place, and never passes it again', () => {
    expect(route.area).toBe('Kondele')
    expect(route.stops.some((s) => s.name === 'Kondele')).toBe(false)
  })

  it('stops go outward, each one once, from a few km to far towns', () => {
    const kms = route.stops.map((s) => s.km)
    expect(kms).toEqual([...kms].sort((a, b) => a - b))
    expect(new Set(route.stops.map((s) => s.name)).size).toBe(route.stops.length)
    expect(kms[0]).toBeLessThan(8)
    expect(kms.at(-1)!).toBeGreaterThan(150)
    expect(route.stops.length).toBeGreaterThanOrEqual(6)
    expect(route.stops.length).toBeLessThanOrEqual(12)
  })

  it('uses the places around, then towns further out', () => {
    const names = route.stops.map((s) => s.name)
    expect(names.some((n) => ['Maseno', 'Ahero'].includes(n))).toBe(true) // a local place 20–30 km out
    expect(names.some((n) => ['Kakamega', 'Kericho', 'Eldoret', 'Nakuru', 'Nairobi'].includes(n))).toBe(true)
  })

  it('still works when the map service is down (built-in towns only)', () => {
    const r = buildRoute({ lat: -0.30, lng: 36.08 }, [])! // Nakuru
    expect(r.area).toBe('Nakuru')
    expect(r.stops.length).toBeGreaterThanOrEqual(4)
  })

  it('names the area after a nearby town when nothing is very close', () => {
    expect(buildRoute({ lat: -1.20, lng: 37.10 }, [])!.area).toMatch(/^near /) // countryside between towns
  })

  it('nowhere near anything: no route (the app shows plain distances)', () => {
    expect(buildRoute({ lat: 40, lng: -30 }, [])).toBeNull()
  })
})
