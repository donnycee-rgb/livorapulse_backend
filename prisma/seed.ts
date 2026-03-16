import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  console.log('Seeding database...')

  // Remove any existing demo user (and cascade-delete all their data)
  await prisma.user.deleteMany({ where: { email: 'demo@livorapulse.com' } })

  const rounds = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10)
  const passwordHash = await bcrypt.hash('Demo1234!', rounds)

  const user = await prisma.user.create({
    data: {
      name: 'Demo User',
      email: 'demo@livorapulse.com',
      passwordHash,
      preferences: {
        create: {
          theme: 'dark',
          units: 'metric',
          notificationsEnabled: true,
          focusMode: false,
        },
      },
    },
  })

  const now = new Date()

  for (let i = 6; i >= 0; i--) {
    const day = new Date(now)
    day.setDate(day.getDate() - i)
    day.setUTCHours(10, 0, 0, 0)

    // Physical
    await prisma.physicalActivityEntry.create({
      data: {
        userId: user.id,
        steps: 5000 + Math.floor(Math.random() * 7000),
        distanceKm: parseFloat((3 + Math.random() * 5).toFixed(2)),
        caloriesKcal: 250 + Math.floor(Math.random() * 350),
        sleepMinutes: 360 + Math.floor(Math.random() * 120),
        timestamp: day,
      },
    })

    // Digital
    await prisma.digitalUsageEntry.create({
      data: {
        userId: user.id,
        screenTimeMinutes: 90 + Math.floor(Math.random() * 270),
        categoryBreakdown: {
          Social: 45 + Math.floor(Math.random() * 60),
          Productive: 60 + Math.floor(Math.random() * 90),
          Entertainment: 30 + Math.floor(Math.random() * 60),
        },
        date: day,
      },
    })

    // Productivity
    const startedAt = new Date(day)
    startedAt.setUTCHours(9, 0, 0, 0)
    const durationSec = 60 * 60 + Math.floor(Math.random() * 3 * 60 * 60) // 1–4 hrs
    const endedAt = new Date(startedAt.getTime() + durationSec * 1000)
    await prisma.productivitySession.create({
      data: {
        userId: user.id,
        kind: i % 3 === 0 ? 'STUDY' : 'FOCUS',
        label: i % 3 === 0 ? 'Study Session' : 'Deep Work',
        startedAt,
        endedAt,
        durationSec,
      },
    })

    // Mood
    await prisma.moodLog.create({
      data: {
        userId: user.id,
        emoji: ['😄', '🙂', '😐', '😕'][Math.floor(Math.random() * 4)] ?? '🙂',
        stressScore: 2 + Math.floor(Math.random() * 7),
        note: i % 2 === 0 ? 'Feeling productive today' : undefined,
        timestamp: day,
      },
    })

    // Eco
    const categories = ['TRANSPORT', 'FOOD', 'ENERGY', 'WASTE'] as const
    const types = ['Cycling', 'Plant-based meal', 'LED lighting', 'Recycling'] as const
    const idx = i % 4
    await prisma.ecoAction.create({
      data: {
        userId: user.id,
        category: categories[idx] ?? 'TRANSPORT',
        type: types[idx] ?? 'Cycling',
        impactKgCO2: parseFloat((-(0.3 + Math.random() * 1.5)).toFixed(3)),
        timestamp: day,
      },
    })
  }

  console.log('✓ Demo user created: demo@livorapulse.com / Demo1234!')
  console.log('✓ 7 days of sample data seeded for all trackers')
}

main()
  .catch((err: unknown) => {
    console.error('Seed error:', err)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
