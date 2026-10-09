import { describe, expect, it } from 'vitest'
import {
  benjaminiHochberg,
  hashString,
  mean,
  median,
  ranks,
  sd,
  seededRandom,
  spearman,
  stratifiedPermutationTest,
} from '../../src/insights/stats'

describe('basic statistics', () => {
  it('mean, median and sd', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3)
    expect(mean([])).toBeNaN()
  })

  it('gives tied values the average rank', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4])
  })

  it('spearman is 1 for any increasing relation and -1 for decreasing', () => {
    const x = [1, 2, 3, 4, 5, 6]
    expect(spearman(x, x.map((v) => v ** 3))).toBeCloseTo(1)
    expect(spearman(x, x.map((v) => -Math.exp(v)))).toBeCloseTo(-1)
  })

  it('spearman is 0 when one side is constant', () => {
    expect(spearman([1, 2, 3], [5, 5, 5])).toBe(0)
  })
})

describe('seeded random numbers', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('stays in [0, 1)', () => {
    const r = seededRandom(hashString('sleep->stress'))
    for (let i = 0; i < 10000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('benjaminiHochberg', () => {
  it('matches a worked example', () => {
    // p sorted: 0.01, 0.02, 0.03, 0.04, 0.5 → raw p·m/k: 0.05, 0.05, 0.05, 0.05, 0.5
    const q = benjaminiHochberg([0.03, 0.5, 0.01, 0.04, 0.02])
    expect(q.map((v) => +v.toFixed(4))).toEqual([0.05, 0.5, 0.05, 0.05, 0.05])
  })

  it('never lowers a p-value and caps at 1', () => {
    const p = [0.2, 0.9, 0.95]
    const q = benjaminiHochberg(p)
    q.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(p[i] - 1e-12) // allow floating-point rounding
      expect(v).toBeLessThanOrEqual(1)
    })
  })

  it('handles an empty list', () => {
    expect(benjaminiHochberg([])).toEqual([])
  })
})

describe('stratifiedPermutationTest', () => {
  const below = (t: number) => (v: number) => v < t

  it('finds a clear link', () => {
    const driver = Array.from({ length: 40 }, (_, i) => i)
    const outcome = driver.map((d, i) => d * 0.1 + (i % 3) * 0.2)
    const strata = driver.map(() => 'all')
    const r = stratifiedPermutationTest(driver, outcome, strata, below(20), 999, seededRandom(1))
    expect(r.rho).toBeGreaterThan(0.9)
    expect(r.diff).toBeGreaterThan(1.5)
    expect(r.p).toBeLessThan(0.01)
  })

  it('does not credit the driver with a link the strata explain', () => {
    // The driver is higher on weekends and so is the outcome, but within
    // each stratum the driver makes no difference. Across many such data
    // sets the test should reject at about its nominal rate (5% at p < 0.05).
    let rejected = 0
    let worstAdjusted = 0
    for (let s = 1; s <= 200; s++) {
      const strata: string[] = []
      const driver: number[] = []
      const outcome: number[] = []
      const rand = seededRandom(s)
      for (let i = 0; i < 70; i++) {
        const weekend = i % 7 >= 5
        strata.push(weekend ? 'we' : 'wd')
        driver.push((weekend ? 8 : 4) + rand() * 2)
        outcome.push((weekend ? 8 : 3) + rand())
      }
      const r = stratifiedPermutationTest(driver, outcome, strata, below(6), 499, seededRandom(s + 1000))
      expect(r.rho).toBeGreaterThan(0.4) // the raw correlation always looks strong
      if (r.p < 0.05) rejected++
      worstAdjusted = Math.max(worstAdjusted, Math.abs(r.adjustedDiff))
    }
    expect(rejected / 200).toBeLessThanOrEqual(0.09)
    expect(worstAdjusted).toBeLessThan(1) // vs a raw difference of about 5
  })

  it('handles a constant outcome without dividing by zero', () => {
    const r = stratifiedPermutationTest([1, 2, 3, 4, 5, 6], [3, 3, 3, 3, 3, 3], ['s', 's', 's', 's', 's', 's'], below(3.5), 99, seededRandom(4))
    expect(r.rho).toBe(0)
    expect(r.diff).toBe(0)
    expect(r.p).toBe(1)
  })

  it('is reproducible with the same seed', () => {
    const driver = [1, 2, 3, 4, 5, 6, 7, 8]
    const outcome = [2, 1, 4, 3, 6, 5, 8, 7]
    const strata = driver.map(() => 's')
    const a = stratifiedPermutationTest(driver, outcome, strata, below(4.5), 200, seededRandom(3))
    const b = stratifiedPermutationTest(driver, outcome, strata, below(4.5), 200, seededRandom(3))
    expect(a).toEqual(b)
  })
})
