import { describe, expect, it, vi } from 'vitest'
import { DAY_DECAY, rollingComponents, rollingScore, SCORE_WEIGHTS, type ComponentDay } from '../src/services/ScoreService'

// ScoreService loads the database clients; the pure functions don't use them
vi.mock('../src/db/prisma', () => ({ prisma: {} }))
vi.mock('../src/db/redis', () => ({ redis: {} }))

const all = (v: number | null) => ({ physical: v, digital: v, productivity: v, mood: v, eco: v, nutrition: v })

describe('rolling LifePulse Score', () => {
  it("doesn't reset at midnight: with nothing logged today it keeps the recent days' score", () => {
    const days: ComponentDay[] = [
      { ageDays: 0, components: all(null) }, // just after midnight
      { ageDays: 1, components: all(80) },
      { ageDays: 2, components: all(76) },
    ]
    const score = rollingScore(rollingComponents(days))
    expect(score).toBeGreaterThanOrEqual(76)
    expect(score).toBeLessThanOrEqual(80)
  })

  it('counts today most, and older days less', () => {
    const r = rollingComponents([
      { ageDays: 0, components: { mood: 100 } },
      { ageDays: 1, components: { mood: 0 } },
    ])
    // (100·1 + 0·0.8) / 1.8 ≈ 56: today pulls harder than yesterday
    expect(r.mood).toBe(Math.round(100 / (1 + DAY_DECAY)))
  })

  it('moves when you log today, without one day swinging it all the way', () => {
    const before = rollingScore(rollingComponents([{ ageDays: 1, components: all(70) }, { ageDays: 2, components: all(70) }]))!
    const bad = rollingScore(rollingComponents([{ ageDays: 0, components: all(20) }, { ageDays: 1, components: all(70) }, { ageDays: 2, components: all(70) }]))!
    expect(bad).toBeLessThan(before)
    expect(bad).toBeGreaterThan(40) // one bad day lowers it, it doesn't crash it
  })

  it('leaves out areas not tracked this week instead of counting them as 0', () => {
    const r = rollingComponents([{ ageDays: 0, components: { physical: 90, mood: 90 } }])
    expect(r.eco).toBeNull()
    expect(r.nutrition).toBeNull()
    expect(rollingScore(r)).toBe(90) // not dragged down by eco, food, screen or focus
  })

  it('treats a logged 0 as a real 0', () => {
    expect(rollingComponents([{ ageDays: 0, components: { mood: 0 } }]).mood).toBe(0)
  })

  it('only looks at the last 7 days', () => {
    const r = rollingComponents([{ ageDays: 7, components: all(90) }])
    expect(rollingScore(r)).toBeNull()
  })

  it('has no score until something has been logged this week', () => {
    expect(rollingScore(rollingComponents([]))).toBeNull()
  })

  it('weights areas the same way as before', () => {
    // Only physical (0.23) at 100 and mood (0.14) at 0 tracked
    const s = rollingScore({ physical: 100, mood: 0, digital: null, productivity: null, eco: null, nutrition: null })
    expect(s).toBe(Math.round((100 * SCORE_WEIGHTS.physical) / (SCORE_WEIGHTS.physical + SCORE_WEIGHTS.mood)))
  })
})
