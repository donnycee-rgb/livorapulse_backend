import { describe, expect, it } from 'vitest'
import { calculateGoals, type OnboardingAnswers } from '../src/services/GoalService'
import { checkInSchema, onboardingSchema } from '../src/schemas/onboarding.schema'

const base: OnboardingAnswers = {
  dateOfBirth: '1998-06-01T00:00:00.000Z',
  gender: 'female',
  heightCm: 165,
  weightKg: 68,
  hasDisability: false,
  goals: ['build-habits'],
  currentActivityLevel: 'light',
  currentSleepHours: 6.5,
  currentScreenHours: 5,
  ecoConsciousness: 'sometimes',
}
const g = (goals: string[]) => calculateGoals({ ...base, goals })

describe('starting targets from several goals', () => {
  it('each goal still does what it did on its own', () => {
    expect(g(['improve-fitness']).goalStepsPerDay - g(['build-habits']).goalStepsPerDay).toBe(2000)
    expect(g(['better-sleep']).goalScreenMinutes).toBe(120)
    expect(g(['lose-weight']).goalCaloriesPerDay).toBeLessThan(g(['build-habits']).goalCaloriesPerDay)
  })

  it('goals combine: better sleep + fitness + eco', () => {
    const t = g(['better-sleep', 'improve-fitness', 'eco-lifestyle'])
    expect(t.goalScreenMinutes).toBe(120) // from better sleep
    expect(t.goalStepsPerDay).toBe(g(['improve-fitness']).goalStepsPerDay) // from fitness
    expect(t.goalEcoActionsPerDay).toBe(g(['build-habits']).goalEcoActionsPerDay + 1) // from eco
  })

  it("step boosts don't stack: fitness + weight loss is the fitness boost", () => {
    expect(g(['lose-weight', 'improve-fitness']).goalStepsPerDay).toBe(g(['improve-fitness']).goalStepsPerDay)
  })

  it('losing weight and gaining muscle together: eat at maintenance', () => {
    const plain = g(['build-habits']).goalCaloriesPerDay
    expect(g(['lose-weight', 'gain-muscle']).goalCaloriesPerDay).toBe(plain)
  })

  it('the stricter screen limit wins', () => {
    expect(g(['reduce-stress', 'better-sleep']).goalScreenMinutes).toBe(120)
  })

  it('focus: the most ambitious goal that sets one', () => {
    expect(g(['build-habits', 'reduce-stress']).goalFocusMinutes).toBe(90)
    expect(g(['reduce-stress', 'lose-weight']).goalFocusMinutes).toBe(45)
    expect(g(['lose-weight']).goalFocusMinutes).toBe(60)
  })
})

describe('what the app may send', () => {
  it('up to three goals, the first is the main one', () => {
    const r = onboardingSchema.parse({ goals: ['better-sleep', 'reduce-stress'] })
    expect(r).toMatchObject({ goals: ['better-sleep', 'reduce-stress'], primaryGoal: 'better-sleep' })
  })

  it('older app versions send one primaryGoal', () => {
    expect(onboardingSchema.parse({ primaryGoal: 'eco-lifestyle' })).toMatchObject({ goals: ['eco-lifestyle'], primaryGoal: 'eco-lifestyle' })
  })

  it('none, more than three, or unknown goals are refused', () => {
    expect(onboardingSchema.safeParse({}).success).toBe(false)
    expect(onboardingSchema.safeParse({ goals: [] }).success).toBe(false)
    expect(onboardingSchema.safeParse({ goals: ['lose-weight', 'gain-muscle', 'better-sleep', 'reduce-stress'] }).success).toBe(false)
    expect(onboardingSchema.safeParse({ goals: ['fly'] }).success).toBe(false)
  })

  it('the weekly check-in takes several goals too', () => {
    expect(checkInSchema.parse({ goals: ['gain-muscle', 'better-sleep'] }).primaryGoal).toBe('gain-muscle')
  })

  it('the same goal twice counts once', () => {
    expect(onboardingSchema.parse({ goals: ['better-sleep', 'better-sleep'] }).goals).toEqual(['better-sleep'])
  })
})
