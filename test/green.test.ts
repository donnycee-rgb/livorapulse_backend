import { describe, expect, it } from 'vitest'
import { greenScore, HABIT_KEYS, tripAvoidedKg } from '../src/utils/green'

describe('trips', () => {
  it('CO₂ avoided is what a car would emit minus what you did', () => {
    expect(tripAvoidedKg('walk', 3)).toBe(0.51) // 3 km × 0.17
    expect(tripAvoidedKg('matatu', 10)).toBe(0.7) // 10 × (0.17 − 0.10)
    expect(tripAvoidedKg('car', 20)).toBe(0)
  })
})

describe('eco score', () => {
  it('habits against the goal when there were no trips', () => {
    expect(greenScore(3, 3, { lowCarbon: 0, total: 0 })).toBe(100)
    expect(greenScore(1, 4, { lowCarbon: 0, total: 0 })).toBe(25)
  })

  it('with trips: 70% habits, 30% the low-carbon share', () => {
    // all habits done, half the trips by car: 70 + 15
    expect(greenScore(3, 3, { lowCarbon: 1, total: 2 })).toBe(85)
    expect(greenScore(0, 3, { lowCarbon: 2, total: 2 })).toBe(30)
  })

  it('a goal above the number of habits is capped', () => {
    expect(greenScore(HABIT_KEYS.length, 10, { lowCarbon: 0, total: 0 })).toBe(100)
  })
})
