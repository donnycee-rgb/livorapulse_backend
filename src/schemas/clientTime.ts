import { z } from 'zod'

// When something was logged, as the phone saw it. Logs saved offline are
// uploaded later, sometimes days later, and must land on the day they
// happened. Limits: not in the future (a few minutes' clock drift allowed),
// and not older than two weeks.
export const CLIENT_TIME_MAX_AGE_DAYS = 14
const DRIFT_MS = 5 * 60 * 1000

export const clientTime = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + DRIFT_MS, { message: 'Time is in the future' })
  .refine((v) => Date.parse(v) >= Date.now() - CLIENT_TIME_MAX_AGE_DAYS * 86_400_000, {
    message: `Time is more than ${CLIENT_TIME_MAX_AGE_DAYS} days ago`,
  })
