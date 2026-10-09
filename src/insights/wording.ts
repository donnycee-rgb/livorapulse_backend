// ─── Every sentence and label the user sees for an insight ──────────────────
// Templates, not AI text. Rules: say "linked with" / "on days when…", never
// "causes"; always show the numbers and how many days they're based on.
// All English strings live in this file so a Swahili version can sit beside it.

import type { CyclePhase, FeatureKey, Lag } from './config'
import type { Split, TestResult } from './analyze'

// ─── Number formatting ──────────────────────────────────────────────────────

const thousands = (n: number) => Math.round(n).toLocaleString('en-US')

/** 95 → "1h 35m", 360 → "6h", 45 → "45 min" */
export function formatMinutes(min: number): string {
  const m = Math.round(min / 5) * 5
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** How a driver value reads in a sentence, with its unit */
function formatDriver(driver: FeatureKey, v: number): string {
  switch (driver) {
    case 'sleepMinutes':
    case 'screenMinutes':
    case 'socialMinutes':
    case 'entertainmentMinutes':
    case 'workMinutes':
      return formatMinutes(v)
    case 'steps':
      return `${thousands(Math.round(v / 100) * 100)} steps`
    case 'waterGlasses':
      return plural(Math.round(v), 'glass of water', 'glasses of water')
    case 'caloriesIn':
      return `${thousands(Math.round(v / 50) * 50)} kcal`
    case 'ecoActions':
      return plural(Math.round(v), 'eco action', 'eco actions')
    default:
      return thousands(v)
  }
}

// ─── Outcome values in the units the user sees ──────────────────────────────

/**
 * Stress is stored 1–10 but the app shows a 1–5 slider, so it is halved for
 * display. Mood is already 1–5.
 */
export function displayValue(outcome: FeatureKey, stored: number): number {
  if (outcome === 'stressScore') return stored / 2
  return stored
}

function formatOutcome(outcome: FeatureKey, stored: number): string {
  const v = displayValue(outcome, stored)
  switch (outcome) {
    case 'stressScore':
    case 'moodValue':
      return v.toFixed(1)
    case 'sleepMinutes':
    case 'focusMinutes':
      return formatMinutes(v)
    case 'steps':
      return `${thousands(Math.round(v / 100) * 100)} steps`
    default:
      return thousands(v)
  }
}

/** The scale shown next to bars, when the outcome has one */
export function outcomeScaleMax(outcome: FeatureKey): number | null {
  return outcome === 'stressScore' || outcome === 'moodValue' ? 5 : null
}

// ─── English templates ──────────────────────────────────────────────────────

const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'Period',
  follicular: 'Follicular phase',
  ovulation: 'Around ovulation',
  luteal: 'Luteal phase',
}

const PHASE_OPENING: Record<CyclePhase, string> = {
  menstrual: 'During your period',
  follicular: 'In your follicular phase',
  ovulation: 'Around ovulation',
  luteal: 'In your luteal phase',
}

/** Short noun added to group labels, e.g. "Under 6h sleep" */
const DRIVER_NOUN: Partial<Record<FeatureKey, string>> = {
  sleepMinutes: 'sleep',
  screenMinutes: 'screen time',
  socialMinutes: 'social media',
  entertainmentMinutes: 'entertainment',
  workMinutes: 'focus + study',
}

/** Names used in progress messages ("Log sleep and mood on 9 more days") */
export const AREA_LABEL: Record<FeatureKey | 'cyclePhase', string> = {
  sleepMinutes: 'sleep',
  steps: 'walks',
  screenMinutes: 'screen time',
  socialMinutes: 'social media time',
  entertainmentMinutes: 'entertainment time',
  focusMinutes: 'focus sessions',
  studyMinutes: 'study sessions',
  workMinutes: 'focus or study sessions',
  moodValue: 'mood',
  stressScore: 'stress',
  caloriesIn: 'meals (2 or more a day)',
  waterGlasses: 'water',
  ecoActions: 'eco actions',
  cyclePhase: 'your cycle',
}

/** The low group's condition, e.g. "under 6h" or "6h or less" */
function lowCondition(driver: FeatureKey, split: Split): string {
  const v = formatDriver(driver, split.value)
  if (driver === 'ecoActions' && split.mode === 'below' && Math.round(split.value) <= 1) return 'no eco actions'
  const isCount = driver === 'ecoActions' || driver === 'waterGlasses'
  if (split.mode === 'below') return `${isCount ? 'fewer than' : 'under'} ${v}`
  return `${v} or ${isCount ? 'fewer' : 'less'}`
}

function groupLabels(driver: FeatureKey, split: Split): { low: string; high: string } {
  const v = formatDriver(driver, split.value)
  const noun = DRIVER_NOUN[driver] ? ` ${DRIVER_NOUN[driver]}` : ''
  if (driver === 'ecoActions' && split.mode === 'below' && Math.round(split.value) <= 1) {
    return { low: 'No eco actions', high: '1+ eco actions' }
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  return split.mode === 'below'
    ? { low: cap(`${lowCondition(driver, split)}${noun}`), high: `${v}+${noun}` }
    : { low: cap(`${lowCondition(driver, split)}${noun}`), high: `Over ${v}${noun}` }
}

/** Opening clause describing the low-group days */
function opening(driver: FeatureKey, split: Split): string {
  const cond = lowCondition(driver, split)
  switch (driver) {
    case 'sleepMinutes': return `After nights with ${cond} of sleep`
    case 'steps': return `On days your logged walks add up to ${cond}`
    case 'screenMinutes': return `On days you log ${cond} of screen time`
    case 'socialMinutes': return `On days with ${cond} of social media`
    case 'entertainmentMinutes': return `On days with ${cond} of entertainment screen time`
    case 'workMinutes': return `On days with ${cond} of focus and study time`
    case 'waterGlasses': return `On days you drink ${cond}`
    case 'caloriesIn': return `On days you log ${cond} of food`
    case 'ecoActions': return `On days with ${cond}`
    default: return `On days with ${cond}`
  }
}

/** "that day", "the next day" — the sleep driver's day is the day after the night */
function when(driver: FeatureKey, lag: Lag): string {
  if (lag === 'next-day') return ' the next day'
  if (lag === 'same-day' && driver === 'sleepMinutes') return ' that day'
  return ''
}

function pairOutcomeClause(r: TestResult): string {
  const a = formatOutcome(r.outcome, r.meanLow!)
  const b = formatOutcome(r.outcome, r.meanHigh!)
  const w = when(r.driver as FeatureKey, r.lag)
  switch (r.outcome) {
    case 'stressScore': return `your stress${w} averages ${a} instead of ${b} (out of 5)`
    case 'moodValue': return `your mood${w} averages ${a} instead of ${b} (out of 5)`
    case 'sleepMinutes': return `you sleep ${a} that night instead of ${b}`
    case 'focusMinutes': {
      const pct = Math.round((Math.abs(r.meanLow! - r.meanHigh!) / r.meanHigh!) * 100)
      return `your focus time${w} is about ${pct}% ${r.meanLow! > r.meanHigh! ? 'longer' : 'shorter'} (${a} instead of ${b})`
    }
    case 'steps': return `your logged walks average ${a} instead of ${b}`
    default: return `it averages ${a} instead of ${b}`
  }
}

function cycleOutcomeClause(r: TestResult): string {
  const a = formatOutcome(r.outcome, r.meanLow!)
  const b = formatOutcome(r.outcome, r.meanHigh!)
  switch (r.outcome) {
    case 'stressScore': return `your stress averages ${a} out of 5, compared with ${b} in the rest of your cycle`
    case 'moodValue': return `your mood averages ${a} out of 5, compared with ${b} in the rest of your cycle`
    case 'sleepMinutes': return `you sleep ${a} a night on average, compared with ${b} in the rest of your cycle`
    case 'steps': return `your logged walks average ${a}, compared with ${b} in the rest of your cycle`
    default: return `it averages ${a}, compared with ${b} in the rest of your cycle`
  }
}

/** True when the phase is the harder stretch: lower mood or sleep, more stress */
function phaseIsHarder(r: TestResult): boolean {
  if (r.outcome === 'stressScore') return r.meanLow! > r.meanHigh!
  if (r.outcome === 'moodValue' || r.outcome === 'sleepMinutes') return r.meanLow! < r.meanHigh!
  return false
}

const basedOn = (n: number) => `Based on ${n} days.`

export interface InsightCopy {
  text: string
  groupLabelLow: string
  groupLabelHigh: string
}

/** The sentence and bar labels for a tested result that passed */
export function describeInsight(r: TestResult): InsightCopy {
  if (r.kind === 'cycle') {
    const phase = r.phase!
    const reassurance = phaseIsHarder(r) ? " That's a pattern, not a bad week." : ''
    return {
      text: `${PHASE_OPENING[phase]}, ${cycleOutcomeClause(r)}.${reassurance} ${basedOn(r.pairedDays)}`,
      groupLabelLow: PHASE_LABEL[phase],
      groupLabelHigh: 'Rest of cycle',
    }
  }
  const driver = r.driver as FeatureKey
  const labels = groupLabels(driver, r.split!)
  return {
    text: `${opening(driver, r.split!)}, ${pairOutcomeClause(r)}. ${basedOn(r.pairedDays)}`,
    groupLabelLow: labels.low,
    groupLabelHigh: labels.high,
  }
}

/** Short name for a pair in progress lists: "Sleep and mood", "Mood across your cycle" */
export function pairLabel(driver: FeatureKey | 'cyclePhase', outcome: FeatureKey): string {
  const text = driver === 'cyclePhase'
    ? `${AREA_LABEL[outcome]} across your cycle`
    : `${AREA_LABEL[driver]} and ${AREA_LABEL[outcome]}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Log sleep and mood on 9 more days to unlock your first insights." */
export function progressMessage(driver: FeatureKey | 'cyclePhase', outcome: FeatureKey, daysNeeded: number): string {
  const days = plural(daysNeeded, 'more day', 'more days')
  if (driver === 'cyclePhase') return `Keep logging your ${AREA_LABEL[outcome]} on ${days} to see how it changes across your cycle.`
  return `Log ${AREA_LABEL[driver]} and ${AREA_LABEL[outcome]} on ${days} to unlock your first insights.`
}
