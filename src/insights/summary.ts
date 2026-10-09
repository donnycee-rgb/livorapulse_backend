// ─── Health summary for a doctor ────────────────────────────────────────────
// Pure: HealthSummaryService loads the data, this shapes it. The web page and
// the PDF both render this object, so they always say the same thing.

import { addDays } from '../utils/day'
import type { FeatureDay } from './analyze'
import { mean } from './stats'
import { summaryText, SUMMARY_DISCLAIMER } from './wording'

export type SummaryMonths = 1 | 3
export const SUMMARY_DAYS: Record<SummaryMonths, number> = { 1: 30, 3: 91 }

/** A typical cycle is 21–35 days; outside that is reported as a count, never a diagnosis */
export const TYPICAL_CYCLE = { min: 21, max: 35 }
const MAX_NOTES = 40
const MAX_NOTE_CHARS = 300

export type MetricKey = 'sleep' | 'mood' | 'stress' | 'walks'

export interface WeekValue {
  weekStart: string
  value: number | null
}

export interface MetricSummary {
  daysLogged: number
  /** In the units the app shows: sleep in minutes, mood and stress 1–5, walks in steps */
  average: number | null
  min: number | null
  max: number | null
  weekly: WeekValue[]
  /** Second half of the period vs the first; null with too little data */
  trend: 'higher' | 'lower' | 'steady' | null
  /** Nights under 6 h, mood ≤ 2, stress ≥ 4 — null for walks */
  notableDays: number | null
  text: string
}

export interface CycleSummary {
  periodsLogged: number
  lastPeriodStart: string | null
  /** Lengths of cycles that started in the period and have ended */
  lengths: number[]
  averageLength: number | null
  outsideTypicalRange: number
  flow: Record<string, number>
  symptoms: { name: string; count: number }[]
  text: string
}

export interface SummaryNote {
  date: string
  area: 'Mood' | 'Cycle'
  text: string
}

export interface HealthSummary {
  version: 1
  generatedAt: string
  period: { from: string; to: string; months: SummaryMonths; days: number }
  person: { name: string; age: number | null; sex: string | null }
  disclaimer: string
  sleep: MetricSummary
  mood: MetricSummary
  stress: MetricSummary
  walks: MetricSummary
  /** Null when the user doesn't track their cycle */
  cycle: CycleSummary | null
  insights: string[]
  /** "Worth getting checked" flags (Phase 4); empty until then */
  flags: { title: string; detail: string }[]
  /** Only when the user chose to include them */
  notes: SummaryNote[] | null
}

export interface SummaryPeriodLog {
  startKey: string
  periodDuration: number
  flowIntensity: string | null
  symptoms: unknown
}

export interface SummaryInput {
  today: string
  months: SummaryMonths
  generatedAt: Date
  person: { name: string; dateOfBirth: Date | null; gender: string | null }
  days: FeatureDay[]
  /** All of the user's periods, oldest first; empty if they don't track */
  periods: SummaryPeriodLog[]
  insights: string[]
  flags: { title: string; detail: string }[]
  notes: SummaryNote[] | null
}

// ─── Metrics ────────────────────────────────────────────────────────────────

interface MetricSpec {
  pick: (d: FeatureDay) => number | null
  /** Change between halves that counts as higher/lower, in display units */
  trendStep: number
  notable?: (v: number) => boolean
}

const METRICS: Record<MetricKey, MetricSpec> = {
  sleep: { pick: (d) => d.values.sleepMinutes ?? null, trendStep: 20, notable: (v) => v < 360 },
  mood: { pick: (d) => d.values.moodValue ?? null, trendStep: 0.3, notable: (v) => v <= 2 },
  // Stored 1–10, shown 1–5
  stress: { pick: (d) => (d.values.stressScore == null ? null : d.values.stressScore / 2), trendStep: 0.3, notable: (v) => v >= 4 },
  walks: { pick: (d) => d.values.steps ?? null, trendStep: 1000 },
}

const MIN_DAYS_PER_HALF = 4

function summarizeMetric(key: MetricKey, keys: string[], byDate: Map<string, FeatureDay>): MetricSummary {
  const spec = METRICS[key]
  const valueOn = (k: string) => {
    const d = byDate.get(k)
    return d ? spec.pick(d) : null
  }
  const values = keys.map(valueOn).filter((v): v is number => v !== null)

  const weekly: WeekValue[] = []
  for (let i = 0; i < keys.length; i += 7) {
    const week = keys.slice(i, i + 7).map(valueOn).filter((v): v is number => v !== null)
    weekly.push({ weekStart: keys[i], value: week.length > 0 ? mean(week) : null })
  }

  const half = Math.floor(keys.length / 2)
  const first = keys.slice(0, half).map(valueOn).filter((v): v is number => v !== null)
  const second = keys.slice(half).map(valueOn).filter((v): v is number => v !== null)
  let trend: MetricSummary['trend'] = null
  if (first.length >= MIN_DAYS_PER_HALF && second.length >= MIN_DAYS_PER_HALF) {
    const diff = mean(second) - mean(first)
    trend = Math.abs(diff) < spec.trendStep ? 'steady' : diff > 0 ? 'higher' : 'lower'
  }

  const summary: Omit<MetricSummary, 'text'> = {
    daysLogged: values.length,
    average: values.length > 0 ? mean(values) : null,
    min: values.length > 0 ? Math.min(...values) : null,
    max: values.length > 0 ? Math.max(...values) : null,
    weekly,
    trend,
    notableDays: spec.notable ? values.filter(spec.notable).length : null,
  }
  return { ...summary, text: summaryText.metric(key, summary, keys.length) }
}

// ─── Cycle ──────────────────────────────────────────────────────────────────

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000)
}

function summarizeCycle(periods: SummaryPeriodLog[], from: string, to: string): CycleSummary | null {
  if (periods.length === 0) return null
  const inRange = periods.filter((p) => p.startKey >= from && p.startKey <= to)

  // A cycle's length runs from its start to the next logged start
  const lengths: number[] = []
  periods.forEach((p, i) => {
    const next = periods[i + 1]
    if (next && p.startKey >= from && p.startKey <= to) lengths.push(daysBetween(p.startKey, next.startKey))
  })

  const flow: Record<string, number> = {}
  const symptomCounts = new Map<string, number>()
  for (const p of inRange) {
    if (p.flowIntensity) flow[p.flowIntensity] = (flow[p.flowIntensity] ?? 0) + 1
    if (Array.isArray(p.symptoms)) {
      for (const s of p.symptoms) if (typeof s === 'string') symptomCounts.set(s, (symptomCounts.get(s) ?? 0) + 1)
    }
  }

  const summary: Omit<CycleSummary, 'text'> = {
    periodsLogged: inRange.length,
    lastPeriodStart: inRange.length > 0 ? inRange[inRange.length - 1].startKey : null,
    lengths,
    averageLength: lengths.length > 0 ? Math.round(mean(lengths)) : null,
    outsideTypicalRange: lengths.filter((l) => l < TYPICAL_CYCLE.min || l > TYPICAL_CYCLE.max).length,
    flow,
    symptoms: [...symptomCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
  return { ...summary, text: summaryText.cycle(summary) }
}

// ─── Whole summary ──────────────────────────────────────────────────────────

function ageOn(dob: Date | null, today: string): number | null {
  if (!dob) return null
  const [y, m, d] = today.split('-').map(Number)
  let age = y - dob.getUTCFullYear()
  if (m - 1 < dob.getUTCMonth() || (m - 1 === dob.getUTCMonth() && d < dob.getUTCDate())) age--
  return age >= 0 && age < 130 ? age : null
}

const SEX: Record<string, string> = { male: 'Male', female: 'Female', 'non-binary': 'Non-binary' }

export function buildHealthSummary(input: SummaryInput): HealthSummary {
  const days = SUMMARY_DAYS[input.months]
  const to = addDays(input.today, -1)
  const from = addDays(input.today, -days)
  const keys: string[] = []
  for (let k = from; k <= to; k = addDays(k, 1)) keys.push(k)
  const byDate = new Map(input.days.map((d) => [d.date, d]))

  const notes = input.notes
    ? [...input.notes]
        .filter((n) => n.text.trim().length > 0 && n.date >= from && n.date <= to)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, MAX_NOTES)
        .map((n) => ({ ...n, text: n.text.length > MAX_NOTE_CHARS ? `${n.text.slice(0, MAX_NOTE_CHARS - 1).trimEnd()}…` : n.text }))
    : null

  return {
    version: 1,
    generatedAt: input.generatedAt.toISOString(),
    period: { from, to, months: input.months, days },
    person: {
      name: input.person.name,
      age: ageOn(input.person.dateOfBirth, input.today),
      sex: input.person.gender ? SEX[input.person.gender] ?? null : null,
    },
    disclaimer: SUMMARY_DISCLAIMER,
    sleep: summarizeMetric('sleep', keys, byDate),
    mood: summarizeMetric('mood', keys, byDate),
    stress: summarizeMetric('stress', keys, byDate),
    walks: summarizeMetric('walks', keys, byDate),
    cycle: summarizeCycle(input.periods, from, to),
    insights: input.insights,
    flags: input.flags,
    notes,
  }
}
