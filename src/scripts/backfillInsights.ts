import 'dotenv/config'
import { prisma } from '../db/prisma'
import { computeFeatures, firstLogDay } from '../services/FeatureService'
import { refreshInsights } from '../services/InsightService'
import { addDays, dayKey } from '../utils/day'

// One-off: build DailyFeatures for every user's whole history, then run the
// insights once. Run after deploying the insights migration:
//   npm run insights:backfill        (built:  node dist/scripts/backfillInsights.js)
// Safe to re-run — every write is an upsert.

const CHUNK_DAYS = 60

async function main(): Promise<void> {
  const today = dayKey()
  const yesterday = addDays(today, -1)
  const users = await prisma.user.findMany({ select: { id: true } })
  console.log(`Backfilling ${users.length} users up to ${yesterday}`)

  let done = 0
  for (const { id } of users) {
    const first = await firstLogDay(id)
    let rows = 0
    if (first && first <= yesterday) {
      for (let from = first; from <= yesterday; from = addDays(from, CHUNK_DAYS)) {
        const to = addDays(from, CHUNK_DAYS - 1)
        rows += await computeFeatures(id, from, to < yesterday ? to : yesterday)
      }
    }
    const summary = await refreshInsights(id, today)
    done++
    console.log(`[${done}/${users.length}] ${id}: ${rows} feature days, ${summary.active} active insights`)
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err instanceof Error ? err.message.split('\n')[0] : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
