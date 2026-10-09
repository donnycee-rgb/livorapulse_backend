// ─── Raw logs for one local day → that day's features ───────────────────────
// Pure: FeatureService loads the rows and saves the result.
//
// The rule for every field. "Missing is null, never 0":
//
//   sleepMinutes          Latest entry with sleepMinutes > 0 that day (sleep is one value
//                         per night; an old duplicate is replaced, not added). Values over
//                         20 h are ignored as typos. Entries with sleepMinutes = 0 are
//                         walks or other activity, not "slept 0 minutes".
//                         Attribution: the entry logged on day D is the night that ended
//                         on the morning of D.
//   steps, distanceKm     Sum over entries with steps > 0 or distance > 0 (tracked walks).
//                         Null on days with no walk; the app has no all-day step count.
//   activeCaloriesKcal    Sum over entries with caloriesKcal > 0 (walks and "other activity").
//   screenMinutes         Sum of logged screen sessions; null if none.
//   social / entertainment Sum of that category; 0 on days with other screen sessions logged,
//                         null on days with no screen sessions at all.
//   focusMinutes          Sum of FOCUS sessions; null if none.
//   studyMinutes          Sum of STUDY sessions (each tap logs 30 min); null if none.
//   moodValue             Mean of the day's emojis mapped 😣1 … 😄5; unknown emojis and
//                         stress-only check-ins are skipped; null if no mood.
//   stressScore           Mean of the day's stress answers (1–10 as stored); null if none.
//   caloriesIn, proteinG  Sums, but only on days with 2+ different meal types logged —
//                         a lone snack says more about logging than about eating.
//   waterGlasses          Sum; null if no water logged.
//   ecoActions            Count of actions that saved CO₂ (> 0 kg). 0 when only 0 kg
//                         actions were logged (e.g. "Driving"); null if no eco logs.
//   cyclePhase, cycleDay  From the period that started on or before the day (see cycleForDay).
//   symptoms              Symptoms logged with the period, on that period's days.

import { computeCyclePhase } from '../routes/cycle'
import type { CyclePhase } from './config'

export const EMOJI_VALUE: Record<string, number> = { '😄': 5, '🙂': 4, '😐': 3, '😕': 2, '😣': 1 }

const MAX_SLEEP_MINUTES = 20 * 60

export interface RawDay {
  physical: { steps: number; distanceKm: number; caloriesKcal: number; sleepMinutes: number; timestamp: Date }[]
  digital: { screenTimeMinutes: number; categoryBreakdown: unknown }[]
  productivity: { kind: string; durationSec: number }[]
  mood: { emoji: string | null; stressScore: number | null }[]
  nutrition: { mealType: string; calories: number; proteinG: number }[]
  water: { glasses: number }[]
  eco: { impactKgCO2: number }[]
}

export const emptyRawDay = (): RawDay => ({
  physical: [], digital: [], productivity: [], mood: [], nutrition: [], water: [], eco: [],
})

export interface CycleDayInfo {
  phase: CyclePhase
  cycleDay: number
  symptoms: string[] | null
}

/** The DailyFeatures columns, minus id/user/date */
export interface DayFeatures {
  sleepMinutes: number | null
  steps: number | null
  distanceKm: number | null
  activeCaloriesKcal: number | null
  screenMinutes: number | null
  socialMinutes: number | null
  entertainmentMinutes: number | null
  focusMinutes: number | null
  studyMinutes: number | null
  moodValue: number | null
  stressScore: number | null
  caloriesIn: number | null
  proteinG: number | null
  waterGlasses: number | null
  ecoActions: number | null
  cyclePhase: string | null
  cycleDay: number | null
  symptoms: string[] | null
}

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0)
const meanOrNull = (values: number[]) => (values.length > 0 ? sum(values) / values.length : null)

export function buildDayFeatures(raw: RawDay, cycle: CycleDayInfo | null): DayFeatures {
  // Sleep: the latest valid value wins
  const sleepEntries = raw.physical
    .filter((e) => e.sleepMinutes > 0 && e.sleepMinutes <= MAX_SLEEP_MINUTES)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  const walks = raw.physical.filter((e) => e.steps > 0 || e.distanceKm > 0)
  const burned = raw.physical.filter((e) => e.caloriesKcal > 0)

  let social = 0
  let entertainment = 0
  for (const e of raw.digital) {
    const bd = (e.categoryBreakdown ?? {}) as Record<string, unknown>
    if (typeof bd.Social === 'number') social += bd.Social
    if (typeof bd.Entertainment === 'number') entertainment += bd.Entertainment
  }
  const hasScreen = raw.digital.length > 0

  const focus = raw.productivity.filter((p) => p.kind === 'FOCUS')
  const study = raw.productivity.filter((p) => p.kind === 'STUDY')

  const moods = raw.mood.flatMap((m) => (m.emoji !== null && m.emoji in EMOJI_VALUE ? [EMOJI_VALUE[m.emoji]] : []))
  const stresses = raw.mood.flatMap((m) => (m.stressScore !== null ? [m.stressScore] : []))

  const mealTypes = new Set(raw.nutrition.map((n) => n.mealType))
  const fullFoodDay = mealTypes.size >= 2

  return {
    sleepMinutes: sleepEntries.length > 0 ? sleepEntries[0].sleepMinutes : null,
    steps: walks.length > 0 ? sum(walks.map((w) => w.steps)) : null,
    distanceKm: walks.length > 0 ? sum(walks.map((w) => w.distanceKm)) : null,
    activeCaloriesKcal: burned.length > 0 ? sum(burned.map((e) => e.caloriesKcal)) : null,
    screenMinutes: hasScreen ? sum(raw.digital.map((d) => d.screenTimeMinutes)) : null,
    socialMinutes: hasScreen ? Math.round(social) : null,
    entertainmentMinutes: hasScreen ? Math.round(entertainment) : null,
    focusMinutes: focus.length > 0 ? Math.round(sum(focus.map((p) => p.durationSec)) / 60) : null,
    studyMinutes: study.length > 0 ? Math.round(sum(study.map((p) => p.durationSec)) / 60) : null,
    moodValue: meanOrNull(moods),
    stressScore: meanOrNull(stresses),
    caloriesIn: fullFoodDay ? sum(raw.nutrition.map((n) => n.calories)) : null,
    proteinG: fullFoodDay ? sum(raw.nutrition.map((n) => n.proteinG)) : null,
    waterGlasses: raw.water.length > 0 ? sum(raw.water.map((w) => w.glasses)) : null,
    ecoActions: raw.eco.length > 0 ? raw.eco.filter((e) => e.impactKgCO2 > 0).length : null,
    cyclePhase: cycle?.phase ?? null,
    cycleDay: cycle?.cycleDay ?? null,
    symptoms: cycle?.symptoms ?? null,
  }
}

export function isEmpty(f: DayFeatures): boolean {
  return Object.values(f).every((v) => v === null)
}

// ─── Cycle phase for a past day ─────────────────────────────────────────────

export interface PeriodLog {
  startKey: string // local day the period started
  periodDuration: number
  symptoms: unknown
}

/** A period that hasn't been followed by another this many days past its expected length is a logging gap */
const MAX_DAYS_LATE = 10

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000)
}

/**
 * The cycle phase on a past day. Uses the period that started on or before
 * the day, and — when the next period has been logged — that cycle's real
 * length, which is more accurate in hindsight than the prediction the user
 * saw at the time. For the current cycle it falls back to `expectedLength`
 * (the user's smart average). Returns null before the first logged period or
 * when the current cycle has run so long that a period was probably not logged.
 *
 * @param periods sorted by startKey, oldest first
 */
export function cycleForDay(day: string, periods: PeriodLog[], expectedLength: number): CycleDayInfo | null {
  let idx = -1
  for (let i = 0; i < periods.length; i++) {
    if (periods[i].startKey <= day) idx = i
    else break
  }
  if (idx === -1) return null

  const p = periods[idx]
  const next = periods[idx + 1]
  const cycleLength = next ? daysBetween(p.startKey, next.startKey) : expectedLength
  const dayOfCycle = daysBetween(p.startKey, day) + 1
  if (!next && dayOfCycle > expectedLength + MAX_DAYS_LATE) return null

  const c = computeCyclePhase(new Date(`${p.startKey}T12:00:00Z`), cycleLength, p.periodDuration, day)
  const symptoms = Array.isArray(p.symptoms) && p.symptoms.length > 0 && c.periodActive
    ? p.symptoms.filter((s): s is string => typeof s === 'string')
    : null
  return { phase: c.phase, cycleDay: c.dayOfCycle, symptoms }
}
