// ─── Green habits and trips ──────────────────────────────────────────────────
// The Environment page's two kinds of entry (the app keeps a copy of these
// lists in livorapulse/src/lib/green.ts — keep the two in step):
//
// - Habits: done or not, at most once a day. No CO₂ number is attached:
//   carrying a bag or switching off lights can't be turned into an honest
//   kilogram figure for one person, so habits are counted, not weighed.
// - Trips: how you travelled and roughly how far. Only here is CO₂ worked
//   out, as what a car would have emitted for that distance minus what the
//   chosen way emitted (kg CO₂e per passenger-km, rounded from the UK
//   Government GHG conversion factors (DESNZ/DEFRA 2023); Kenyan-specific
//   factors aren't published, so these are approximations).

export const HABITS = {
  bag:     'Carried a reusable bag',
  bottle:  'Refilled a water bottle',
  recycle: 'Sorted or recycled waste',
  cooking: 'Cooked without charcoal (gas, electric or a clean stove)',
  power:   'Switched off lights and unplugged chargers',
  tree:    'Planted or watered a tree',
  meatfree:'Had a meat-free meal',
} as const

export type Habit = keyof typeof HABITS
export const HABIT_KEYS = Object.keys(HABITS) as Habit[]

export const TRIP_MODES = {
  walk:   { label: 'Walked',       kgPerKm: 0 },
  bike:   { label: 'Cycled',       kgPerKm: 0 },
  matatu: { label: 'Matatu / bus', kgPerKm: 0.10 },
  boda:   { label: 'Boda boda',    kgPerKm: 0.11 },
  car:    { label: 'Car / taxi',   kgPerKm: 0.17 },
} as const

export type TripMode = keyof typeof TRIP_MODES
export const TRIP_MODE_KEYS = Object.keys(TRIP_MODES) as TripMode[]

/** An average petrol car, per km: what the trip is compared with */
export const CAR_KG_PER_KM = TRIP_MODES.car.kgPerKm

/** CO₂ avoided by making this trip this way instead of by car (0 for a car) */
export function tripAvoidedKg(mode: TripMode, km: number): number {
  const d = Math.max(0, km)
  return Math.round(Math.max(0, CAR_KG_PER_KM - TRIP_MODES[mode].kgPerKm) * d * 100) / 100
}

/** Low-carbon means anything but a car */
export const isLowCarbon = (mode: string) => mode !== 'car'

/**
 * Eco score for a day, 0..100.
 * - Habits: distinct habits ticked, against the daily goal (at most the
 *   number of habits there are).
 * - Trips: the share of the day's trips that were low-carbon.
 * With trips, habits weigh 70% and trips 30%; with no trips, habits alone,
 * so a day without travelling isn't marked down.
 */
export function greenScore(habitsDone: number, goal: number, trips: { lowCarbon: number; total: number }): number {
  const target = Math.max(1, Math.min(goal, HABIT_KEYS.length))
  const habitPart = Math.min(1, habitsDone / target) * 100
  if (trips.total === 0) return Math.round(habitPart)
  const tripPart = (trips.lowCarbon / trips.total) * 100
  return Math.round(habitPart * 0.7 + tripPart * 0.3)
}
