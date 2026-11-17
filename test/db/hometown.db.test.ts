import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/App'
import { prisma } from '../../src/db/prisma'
import { signAccessToken } from '../../src/utils/jwt'

// The home town the walking journey starts from, saved on the profile

let app: FastifyInstance
let me: { id: string; email: string }
const headers = () => ({ authorization: `Bearer ${signAccessToken({ id: me.id, email: me.email })}` })
const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/user/profile', headers: headers(), payload })
const stored = async () => (await prisma.userProfile.findUnique({ where: { userId: me.id } }))?.homeTown

beforeAll(async () => {
  app = await buildApp()
  me = await prisma.user.create({ data: { name: 'walker', email: `walker-${Date.now()}@example.test` } })
})

afterAll(async () => {
  await prisma.user.delete({ where: { id: me.id } })
  await app.close()
  await prisma.$disconnect()
})

describe('home town', () => {
  it('is saved, even before the profile exists, and sent back with it', async () => {
    const res = await put({ homeTown: 'kisumu' })
    expect(res.statusCode).toBe(200)
    expect(await stored()).toBe('kisumu')
    const me2 = await app.inject({ method: 'GET', url: '/api/user/profile', headers: headers() })
    expect(JSON.stringify(me2.json())).toContain('"homeTown":"kisumu"')
  })

  it('can be changed and cleared', async () => {
    await put({ homeTown: 'mombasa' })
    expect(await stored()).toBe('mombasa')
    await put({ homeTown: null })
    expect(await stored()).toBeNull()
  })

  it('refuses anything that is not a town id', async () => {
    expect((await put({ homeTown: 'Kisumu City!' })).statusCode).toBe(400)
    expect((await put({ homeTown: '' })).statusCode).toBe(400)
  })

  it('other profile changes leave it alone', async () => {
    await put({ homeTown: 'nakuru' })
    await put({ name: 'Walker Two' })
    expect(await stored()).toBe('nakuru')
  })
})
