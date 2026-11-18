import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/App'
import { prisma } from '../../src/db/prisma'
import { setPlacesFetcher } from '../../src/services/PlacesService'
import { signAccessToken } from '../../src/utils/jwt'

// The walking journey built from a rough location or a town, with a fake map service

let app: FastifyInstance
let me: { id: string; email: string }
const asked: Array<{ lat: number; lng: number }> = []
let mapDown = false
const headers = () => ({ authorization: `Bearer ${signAccessToken({ id: me.id, email: me.email })}` })
const post = (payload: object) => app.inject({ method: 'POST', url: '/api/user/walk-route', headers: headers(), payload })
const profile = () => prisma.userProfile.findUniqueOrThrow({ where: { userId: me.id } })

beforeAll(async () => {
  setPlacesFetcher(async (p) => {
    asked.push(p)
    if (mapDown) return []
    return [
      { name: 'Kondele', lat: -0.085, lng: 34.771, rank: 1 },
      { name: 'Mamboleo', lat: -0.067, lng: 34.795, rank: 1 },
      { name: 'Kibos', lat: -0.050, lng: 34.820, rank: 0 },
      { name: 'Ahero', lat: -0.170, lng: 34.920, rank: 2 },
    ]
  })
  app = await buildApp()
  me = await prisma.user.create({ data: { name: 'walker', email: `walker-${Date.now()}@example.test` } })
})

afterAll(async () => {
  await prisma.user.delete({ where: { id: me.id } })
  await app.close()
  await prisma.$disconnect()
})

describe('from a rough location', () => {
  it('builds and saves the route; only a rounded point is used, and none is kept', async () => {
    const res = await post({ lat: -0.0874321, lng: 34.7701234 })
    expect(res.statusCode).toBe(200)
    expect(asked.at(-1)).toEqual({ lat: -0.09, lng: 34.77 })
    const { area, stops } = res.json().data
    expect(area).toBe('Kondele')
    expect(stops.length).toBeGreaterThanOrEqual(6)
    const p = await profile()
    expect(p.walkArea).toBe('Kondele')
    expect(JSON.stringify(p)).not.toMatch(/34\.77|-0\.08/) // no coordinates stored anywhere on the profile
  })

  it('still builds a route from the town list when the map service is down', async () => {
    mapDown = true
    const res = await post({ lat: -0.30, lng: 36.08 })
    mapDown = false
    expect(res.json().data.area).toBe('Nakuru')
    expect(res.json().data.stops.length).toBeGreaterThanOrEqual(4)
  })
})

describe('from a town instead', () => {
  it('a town from the list', async () => {
    const towns = (await app.inject({ method: 'GET', url: '/api/user/walk-towns', headers: headers() })).json().data
    expect(towns).toContain('Kisumu')
    const res = await post({ town: 'kisumu' })
    expect(res.json().data.area).toBe('Kisumu')
  })

  it('an unknown town, or a bad location, is refused', async () => {
    expect((await post({ town: 'Atlantis' })).statusCode).toBe(404)
    expect((await post({ lat: 200, lng: 0 })).statusCode).toBe(400)
  })
})

it('can be cleared (back to the Nairobi route)', async () => {
  await post({ clear: true })
  const p = await profile()
  expect(p.walkArea).toBeNull()
  expect(p.walkRoute).toBeNull()
})
