// Synthetic users for the insights tests. Values follow what the app can
// actually record: stress in steps of 2 (1–5 slider × 2), mood 1–5, sleep in
// half hours, gaps where nothing was logged, and weekend habits that change
// both drivers and outcomes.

import type { FeatureDay } from '../../src/insights/analyze'
import { seededRandom } from '../../src/insights/stats'
import { addDays } from '../../src/utils/day'

export const TODAY = '2026-10-09'

function normal(rand: () => number): number {
  // Box–Muller
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface SyntheticOptions {
  seed: number
  days?: number
  /** Share of days each value is missing, independently */
  missing?: number
  /** Make the outcome depend on the driver — the planted effect */
  plant?: (day: FeatureDay, prev: FeatureDay | undefined) => void
  /** Add a 28-day cycle */
  cycle?: boolean
}

export function syntheticUser(opts: SyntheticOptions): FeatureDay[] {
  const rand = seededRandom(opts.seed)
  const n = opts.days ?? 90
  const missing = opts.missing ?? 0.25
  const out: FeatureDay[] = []

  const maybe = (v: number) => (rand() < missing ? null : v)

  for (let i = n; i >= 1; i--) {
    const date = addDays(TODAY, -i)
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
    const weekend = dow === 0 || dow === 6

    // Weekend habits shift drivers and outcomes together, with no direct link
    const sleep = Math.round(clamp(400 + (weekend ? 60 : 0) + normal(rand) * 50, 180, 720) / 30) * 30
    const stressLevel = clamp(Math.round(3 - (weekend ? 1 : 0) + normal(rand)), 1, 5)
    const mood = clamp(Math.round(3.4 + (weekend ? 0.5 : 0) + normal(rand) * 0.9), 1, 5)
    const social = Math.round(clamp(90 + (weekend ? 60 : 0) + normal(rand) * 40, 0, 400) / 15) * 15

    const day: FeatureDay = {
      date,
      cyclePhase: null,
      cycleDay: null,
      values: {
        sleepMinutes: maybe(sleep),
        steps: rand() < 0.5 ? Math.round(clamp(4000 + normal(rand) * 1800, 300, 15000)) : null, // walks only some days
        screenMinutes: maybe(Math.round(clamp(240 + (weekend ? 60 : 0) + normal(rand) * 60, 0, 900))),
        socialMinutes: maybe(social),
        entertainmentMinutes: maybe(Math.round(clamp(60 + (weekend ? 45 : 0) + normal(rand) * 30, 0, 400))),
        focusMinutes: rand() < 0.6 ? Math.round(clamp(70 - (weekend ? 30 : 0) + normal(rand) * 25, 5, 300)) : null,
        studyMinutes: rand() < 0.3 ? 30 * (1 + Math.floor(rand() * 3)) : null,
        moodValue: maybe(mood),
        stressScore: maybe(stressLevel * 2),
        caloriesIn: rand() < 0.4 ? Math.round(clamp(1900 + normal(rand) * 350, 600, 4000)) : null,
        waterGlasses: maybe(clamp(Math.round(6 + normal(rand) * 2), 0, 14)),
        ecoActions: rand() < 0.4 ? Math.floor(rand() * 4) : null,
      },
    }

    if (opts.cycle) {
      const cycleDay = ((n - i + 11) % 28) + 1
      day.cycleDay = cycleDay
      day.cyclePhase = cycleDay <= 5 ? 'menstrual' : cycleDay < 14 ? 'follicular' : cycleDay <= 15 ? 'ovulation' : 'luteal'
    }

    out.push(day)
  }

  if (opts.plant) out.forEach((d, i) => opts.plant!(d, out[i - 1]))
  return out
}
