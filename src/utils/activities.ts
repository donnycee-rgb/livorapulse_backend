// ─── Activities other than walking ──────────────────────────────────────────
// What a logged activity is worth, worked out here on the server so every
// number comes from the same rules (the app shows a preview with the same
// table: livorapulse/src/lib/activities.ts — keep the two in step).
//
// MET values: Compendium of Physical Activities (Ainsworth et al., 2011),
// typical intensity for each activity.

export const ACTIVITIES = {
  gym:       { label: 'Gym / weights',          met: 5.0 },
  running:   { label: 'Running',                met: 8.3 },
  cycling:   { label: 'Cycling',                met: 7.5 },
  football:  { label: 'Football',               met: 7.0 },
  basketball:{ label: 'Basketball',             met: 6.5 },
  swimming:  { label: 'Swimming',               met: 6.0 },
  hiking:    { label: 'Hiking',                 met: 6.0 },
  dancing:   { label: 'Dancing',                met: 5.0 },
  skipping:  { label: 'Skipping rope',          met: 11.0 },
  aerobics:  { label: 'Aerobics / HIIT',        met: 7.3 },
  farming:   { label: 'Shamba work / digging',  met: 5.0 },
  housework: { label: 'Housework / cleaning',   met: 3.3 },
  yoga:      { label: 'Yoga / stretching',      met: 2.5 },
} as const

export type ActivityType = keyof typeof ACTIVITIES
export const ACTIVITY_TYPES = Object.keys(ACTIVITIES) as ActivityType[]

/** Used when the profile has no weight yet */
export const DEFAULT_WEIGHT_KG = 70
/** WHO: 6 MET and above is vigorous; a vigorous minute counts as two moderate ones */
const VIGOROUS_MET = 6
/** About 100 steps a minute is moderate walking (Tudor-Locke et al.) */
const STEPS_PER_MODERATE_MINUTE = 100

/**
 * Active calories (MET minus the 1 MET burned at rest anyway, × weight ×
 * hours), and the credit toward the day's step goal. Light activity (under
 * 3 MET, e.g. stretching) burns calories but earns no step credit.
 */
export function activityValue(type: ActivityType, minutes: number, weightKg: number | null | undefined) {
  const { met } = ACTIVITIES[type]
  const mins = Math.max(0, Math.round(minutes))
  const kg = weightKg && weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG
  const caloriesKcal = Math.round(Math.max(0, met - 1) * kg * (mins / 60))
  const perMinute = met >= VIGOROUS_MET ? 2 : met >= 3 ? 1 : 0
  return { caloriesKcal, stepEquivalent: mins * STEPS_PER_MODERATE_MINUTE * perMinute }
}
