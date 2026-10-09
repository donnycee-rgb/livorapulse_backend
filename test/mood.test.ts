import { describe, expect, it, vi } from 'vitest'
import { moodScore } from '../src/services/ScoreService'
import { createMoodSchema } from '../src/schemas/mood.schema'

// ScoreService pulls in the database clients; the pure score functions don't use them.
// vi.mock is hoisted above the imports.
vi.mock('../src/db/prisma', () => ({ prisma: {} }))
vi.mock('../src/db/redis', () => ({ redis: {} }))

describe('moodScore with partial check-ins', () => {
  it('is 0 with no logs', () => {
    expect(moodScore([])).toBe(0)
  })

  it('blends feel and calm 60/40 when both are given', () => {
    // 🙂 = 75, stress 1 → calm 100
    expect(moodScore([{ emoji: '🙂', stressScore: 1 }])).toBeCloseTo(85)
  })

  it('uses only the emoji when no stress was given', () => {
    expect(moodScore([{ emoji: '😄', stressScore: null }])).toBe(100)
  })

  it('uses only stress when no emoji was given', () => {
    expect(moodScore([{ emoji: null, stressScore: 10 }])).toBe(0)
  })

  it('averages each answer over the logs that have it', () => {
    const logs = [
      { emoji: '😄', stressScore: null },
      { emoji: null, stressScore: 1 },
      { emoji: '😐', stressScore: null },
    ]
    // feel = (100 + 50) / 2 = 75, calm = 100
    expect(moodScore(logs)).toBeCloseTo(85)
  })
})

describe('createMoodSchema', () => {
  it('accepts mood only, stress only, or both', () => {
    expect(createMoodSchema.safeParse({ emoji: '🙂' }).success).toBe(true)
    expect(createMoodSchema.safeParse({ stressScore: 4 }).success).toBe(true)
    expect(createMoodSchema.safeParse({ emoji: '🙂', stressScore: 4 }).success).toBe(true)
  })

  it('rejects a check-in with neither', () => {
    expect(createMoodSchema.safeParse({}).success).toBe(false)
    expect(createMoodSchema.safeParse({ note: 'hi' }).success).toBe(false)
  })
})
