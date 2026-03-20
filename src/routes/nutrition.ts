import { FastifyInstance } from 'fastify'
import { searchLocalFoods } from '../data/kenyanFoods'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { logNutritionSchema, logWaterSchema } from '../schemas/nutrition.schema'
import { prisma } from '../db/prisma'

function dayBounds(date: Date) {
  const start = new Date(date); start.setUTCHours(0, 0, 0, 0)
  const end = new Date(date); end.setUTCHours(23, 59, 59, 999)
  return { start, end }
}

// ---------------------------------------------------------------------------
// Food search proxy — avoids CORS issues in the browser
// ---------------------------------------------------------------------------
async function searchOpenFoodFacts(query: string): Promise<object[]> {
  try {
    // Use the faster v2 search API with strict field filtering
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=6&sort_by=unique_scans_n&fields=product_name,nutriments,serving_size,serving_quantity`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'LivoraPulse/1.0' }
    })
    clearTimeout(timeout)
    const data = await res.json() as { products?: any[] }
    return (data.products ?? [])
      .filter((p: any) => {
        const n = p.nutriments
        return (
          p.product_name &&
          typeof p.product_name === 'string' &&
          p.product_name.trim().length > 0 &&
          n && (n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0) > 0
        )
      })
      .slice(0, 6)
      .map((p: any) => {
        const n = p.nutriments
        const kcal = n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0
        return {
          name: p.product_name.trim(),
          calories: Math.round(kcal),
          proteinG: Math.round((n['proteins_100g'] ?? n['proteins'] ?? 0) * 10) / 10,
          carbsG: Math.round((n['carbohydrates_100g'] ?? n['carbohydrates'] ?? 0) * 10) / 10,
          fatG: Math.round((n['fat_100g'] ?? n['fat'] ?? 0) * 10) / 10,
          servingSize: p.serving_size ?? '100g',
        }
      })
  } catch {
    return []
  }
}

export async function nutritionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/nutrition/search?q=ugali — local DB first, then Open Food Facts
  app.get('/search', async (request, reply) => {
    const { q } = request.query as { q?: string }
    if (!q || q.trim().length < 2) {
      return reply.send({ success: true, data: [] })
    }
    const query = q.trim()

    // Search local Kenyan/East African database first — instant
    const localResults = searchLocalFoods(query).map(food => ({
      name: food.name,
      localName: food.name,
      aliases: food.aliases,
      calories: food.calories,
      proteinG: food.proteinG,
      carbsG: food.carbsG,
      fatG: food.fatG,
      servingSize: food.servingSize,
      servingGrams: food.servingGrams,
      category: food.category,
      community: food.community,
      source: 'local' as const,
    }))

    // Also search Open Food Facts for packaged/international foods
    const globalResults = await searchOpenFoodFacts(query)
    const globalMapped = (globalResults as any[]).map((r: any) => ({
      ...r,
      source: 'global' as const,
    }))

    // Local results first, then global
    const combined = [...localResults, ...globalMapped].slice(0, 10)

    return reply.send({ success: true, data: combined })
  })

  // POST /api/nutrition — log a food entry
  app.post('/', async (request, reply) => {
    const body = validate(logNutritionSchema, request.body)
    const entry = await prisma.nutritionLog.create({
      data: {
        userId: request.user!.id,
        mealType: body.mealType,
        foodName: body.foodName,
        calories: body.calories,
        proteinG: body.proteinG,
        carbsG: body.carbsG,
        fatG: body.fatG,
        quantity: body.quantity,
        unit: body.unit,
        ...(body.timestamp ? { timestamp: new Date(body.timestamp) } : {}),
      },
    })
    return reply.status(201).send({ success: true, data: entry })
  })

  // GET /api/nutrition/today — today's logs + totals
  app.get('/today', async (request, reply) => {
    const { start, end } = dayBounds(new Date())
    const entries = await prisma.nutritionLog.findMany({
      where: { userId: request.user!.id, timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' },
    })

    const totals = entries.reduce((acc, e) => ({
      calories: acc.calories + e.calories,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

    return reply.send({ success: true, data: { entries, totals } })
  })

  // GET /api/nutrition/weekly — last 7 days calorie totals
  app.get('/weekly', async (request, reply) => {
    const from = new Date(); from.setDate(from.getDate() - 6); from.setUTCHours(0, 0, 0, 0)
    const entries = await prisma.nutritionLog.findMany({
      where: { userId: request.user!.id, timestamp: { gte: from } },
      select: { calories: true, timestamp: true },
    })

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const map: Record<string, number> = {}
    entries.forEach(e => {
      const d = days[new Date(e.timestamp).getDay()]
      map[d] = (map[d] ?? 0) + e.calories
    })

    return reply.send({ success: true, data: map })
  })

  // DELETE /api/nutrition/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    await prisma.nutritionLog.deleteMany({ where: { id, userId: request.user!.id } })
    return reply.send({ success: true })
  })

  // POST /api/nutrition/water — log water
  app.post('/water', async (request, reply) => {
    const body = validate(logWaterSchema, request.body)
    const { start, end } = dayBounds(new Date())

    const existing = await prisma.waterLog.findFirst({
      where: { userId: request.user!.id, timestamp: { gte: start, lte: end } },
    })

    if (existing) {
      const updated = await prisma.waterLog.update({
        where: { id: existing.id },
        data: { glasses: existing.glasses + (body.glasses ?? 1) },
      })
      return reply.send({ success: true, data: updated })
    }

    const entry = await prisma.waterLog.create({
      data: { userId: request.user!.id, glasses: body.glasses ?? 1 },
    })
    return reply.status(201).send({ success: true, data: entry })
  })

  // GET /api/nutrition/water/today
  app.get('/water/today', async (request, reply) => {
    const { start, end } = dayBounds(new Date())
    const log = await prisma.waterLog.findFirst({
      where: { userId: request.user!.id, timestamp: { gte: start, lte: end } },
    })
    return reply.send({ success: true, data: { glasses: log?.glasses ?? 0 } })
  })
}