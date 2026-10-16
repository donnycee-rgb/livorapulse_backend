import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/db/prisma'
import { findUserIdByEmail } from '../../src/utils/email'

// Lowercasing emails: the migration on real rows, and the lookup that ignores case

const run = `${Date.now()}`
const made: string[] = []
const user = async (email: string) => {
  const u = await prisma.user.create({ data: { name: 'Email Test', email } })
  made.push(u.id)
  return u.id
}
const emailOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).email

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } })
})

describe('lowercase_emails migration', () => {
  it('lowercases and trims emails, but leaves addresses that would clash', async () => {
    const mixed = await user(` Mixed-${run}@Example.test`)
    const clashA = await user(`Clash-${run}@example.test`)
    const clashB = await user(`clash-${run}@example.test`)

    const sql = readFileSync(path.join(__dirname, '../../prisma/migrations/20261016090000_lowercase_emails/migration.sql'), 'utf8')
    await prisma.$executeRawUnsafe(sql)

    expect(await emailOf(mixed)).toBe(`mixed-${run}@example.test`)
    expect(await emailOf(clashA)).toBe(`Clash-${run}@example.test`)
    expect(await emailOf(clashB)).toBe(`clash-${run}@example.test`)
  })
})

describe('findUserIdByEmail', () => {
  it('finds an account however the address is typed', async () => {
    const id = await user(`amina-${run}@example.test`)
    expect(await findUserIdByEmail(`  AMINA-${run}@Example.Test `)).toBe(id)
  })

  it('finds an older address stored with capitals', async () => {
    const id = await user(`Old-${run}@Example.test`)
    expect(await findUserIdByEmail(`old-${run}@example.test`)).toBe(id)
  })

  it('prefers the exact lowercase match when two accounts differ only by capitals', async () => {
    await user(`Twin-${run}@example.test`)
    const lower = await user(`twin-${run}@example.test`)
    expect(await findUserIdByEmail(`TWIN-${run}@example.test`)).toBe(lower)
  })

  it('finds nothing for an unknown address', async () => {
    expect(await findUserIdByEmail(`nobody-${run}@example.test`)).toBeNull()
  })
})
