import { prisma } from '../db/prisma'
import { buildFeatures } from './FeatureService'
import { addDays } from '../utils/day'

// ─── Today's mood forecast, worked out on demand ───────────────────────────
// The nightly Python job (ml/) fits each user's model and saves it in
// MlUserModel. Here we combine it with what's been logged so far today —
// above all last night's sleep, which people log in the morning, after the
// nightly job has run — so the forecast sharpens as soon as sleep is logged.
//
// This mirrors forecast_from_params() in ml/livora_ml/model.py exactly;
// test/moodForecast.test.ts checks it against Python's own answers
// (ml/tests/fixtures/forecast_parity.json).

export type FeatureRow = Partial<Record<
  'sleepMinutes' | 'steps' | 'screenMinutes' | 'socialMinutes' | 'focusMinutes' | 'waterGlasses' | 'moodValue',
  number | null
>>

export type ModelParams = {
  features: string[]
  scale: number[]
  means: (number | null)[]
  m: number[]
  S: number[][]
  yMean: number
  sigma2: number
  n: number
}

export type MoodForecastResult = { mean: number; lower: number; upper: number; usesSleep: boolean }

const Z80 = 1.2815515655446004
const MOOD_MIN = 1
const MOOD_MAX = 5

const num = (row: FeatureRow | null | undefined, key: keyof FeatureRow): number | null => {
  const v = row?.[key]
  return v === null || v === undefined ? null : Number(v)
}
const per = (v: number | null, k: number) => (v === null ? null : v / k)

/** Model inputs, in the order of ml/livora_ml/features.py FEATURES */
export const FEATURES: ReadonlyArray<{ name: string; read: (today: FeatureRow | null, yday: FeatureRow | null, dayKey: string) => number | null }> = [
  { name: 'sleepHours', read: (t) => per(num(t, 'sleepMinutes'), 60) },
  { name: 'stepsK', read: (_t, y) => per(num(y, 'steps'), 1000) },
  { name: 'screenHours', read: (_t, y) => per(num(y, 'screenMinutes'), 60) },
  { name: 'socialHours', read: (_t, y) => per(num(y, 'socialMinutes'), 60) },
  { name: 'focusHours', read: (_t, y) => per(num(y, 'focusMinutes'), 60) },
  { name: 'waterGlasses', read: (_t, y) => num(y, 'waterGlasses') },
  { name: 'moodYesterday', read: (_t, y) => num(y, 'moodValue') },
  { name: 'weekend', read: (_t, _y, key) => ([0, 6].includes(new Date(`${key}T00:00:00Z`).getUTCDay()) ? 1 : 0) },
]

const clip = (v: number) => Math.min(MOOD_MAX, Math.max(MOOD_MIN, v))

/**
 * Forecast for the local day `dayKey` from a saved model and that day's and
 * the day before's features. Null if the saved model is for a different set
 * of inputs (an older or newer model version).
 */
export function forecastFromParams(params: ModelParams, today: FeatureRow | null, yday: FeatureRow | null, dayKey: string): Omit<MoodForecastResult, 'usesSleep'> | null {
  if (params.features.length !== FEATURES.length || params.features.some((f, j) => f !== FEATURES[j].name)) return null

  // Within-person, standardised; missing (or never seen for this user) -> 0
  const x = FEATURES.map((f, j) => {
    const raw = f.read(today, yday, dayKey)
    const mean = params.means[j]
    if (raw === null || mean === null) return 0
    const v = (raw - mean) / params.scale[j]
    return Number.isFinite(v) ? v : 0
  })

  let mean = params.yMean
  let quad = 0
  for (let i = 0; i < x.length; i++) {
    mean += x[i] * params.m[i]
    for (let j = 0; j < x.length; j++) quad += x[i] * params.S[i][j] * x[j]
  }
  const sd = Math.sqrt(params.sigma2 + quad + params.sigma2 / params.n)
  return { mean: clip(mean), lower: clip(mean - Z80 * sd), upper: clip(mean + Z80 * sd) }
}

/** Today's mood forecast for a user, from their saved model and today's logs. Null without a model. */
export async function liveMoodForecast(userId: string, todayKey: string): Promise<MoodForecastResult | null> {
  const model = await prisma.mlUserModel.findUnique({
    where: { userId_outcome: { userId, outcome: 'mood' } },
    select: { params: true },
  })
  if (!model) return null

  const yKey = addDays(todayKey, -1)
  const built = await buildFeatures(userId, yKey, todayKey)
  const today = (built.get(todayKey) ?? null) as FeatureRow | null
  const yday = (built.get(yKey) ?? null) as FeatureRow | null

  const fc = forecastFromParams(model.params as unknown as ModelParams, today, yday, todayKey)
  if (!fc) return null
  return { ...fc, usesSleep: num(today, 'sleepMinutes') !== null }
}
