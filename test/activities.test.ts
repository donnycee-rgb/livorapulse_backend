import { describe, expect, it } from 'vitest'
import { activityValue, ACTIVITIES, DEFAULT_WEIGHT_KG } from '../src/utils/activities'

describe('what another activity is worth', () => {
  it('active calories from MET, weight and time', () => {
    // gym 5 MET, 60 kg, 1 h: (5 − 1) × 60 × 1 = 240
    expect(activityValue('gym', 60, 60).caloriesKcal).toBe(240)
  })

  it('uses a typical weight when the profile has none', () => {
    expect(activityValue('gym', 60, null).caloriesKcal).toBe(Math.round(4 * DEFAULT_WEIGHT_KG))
  })

  it('moderate minutes count as 100 steps, vigorous as 200, light as none', () => {
    expect(activityValue('gym', 30, 70).stepEquivalent).toBe(3000) // 5 MET: moderate
    expect(activityValue('running', 30, 70).stepEquivalent).toBe(6000) // 8.3 MET: vigorous
    expect(activityValue('yoga', 30, 70).stepEquivalent).toBe(0) // 2.5 MET: light
  })

  it('every activity has a sensible MET', () => {
    for (const [key, a] of Object.entries(ACTIVITIES)) {
      expect(a.met, key).toBeGreaterThanOrEqual(2)
      expect(a.met, key).toBeLessThanOrEqual(12)
    }
  })
})
