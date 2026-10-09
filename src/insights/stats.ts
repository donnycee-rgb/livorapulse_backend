// ─── Pure statistics for the insights engine ────────────────────────────────
// No database access and no Math.random — every function here is
// deterministic for a given input, so results are reproducible and testable.

export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  return values.reduce((s, v) => s + v, 0) / values.length
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Sample standard deviation (n − 1) */
export function sd(values: number[]): number {
  if (values.length < 2) return NaN
  const m = mean(values)
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1))
}

/** Ranks starting at 1; tied values share the average of their ranks */
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(values.length)
  let k = 0
  while (k < order.length) {
    let end = k
    while (end + 1 < order.length && order[end + 1].v === order[k].v) end++
    const avg = (k + end) / 2 + 1
    for (let j = k; j <= end; j++) out[order[j].i] = avg
    k = end + 1
  }
  return out
}

function pearson(x: number[], y: number[]): number {
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  if (sxx === 0 || syy === 0) return 0 // a constant series has no correlation
  return sxy / Math.sqrt(sxx * syy)
}

/** Spearman rank correlation (Pearson on tie-averaged ranks). 0 if either side is constant. */
export function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length) throw new Error('spearman: x and y differ in length')
  if (x.length < 2) return 0
  return pearson(ranks(x), ranks(y))
}

// ─── Seeded random numbers ───────────────────────────────────────────────────

/** Mulberry32: a small, fast PRNG. Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a hash of a string — turns an insight key into a stable seed */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ─── Permutation test ────────────────────────────────────────────────────────

export interface PermutationResult {
  /** Spearman correlation between driver and outcome */
  rho: number
  /** Average rho under the null — what the strata (e.g. weekends) alone produce */
  rhoNullMean: number
  /** mean(outcome | high driver) − mean(outcome | low driver) */
  diff: number
  /** Average group difference under the null */
  diffNullMean: number
  /** diff − diffNullMean: the part of the difference the strata don't explain */
  adjustedDiff: number
  /** Two-sided permutation p-value for rho, (extreme + 1) / (iterations + 1) */
  p: number
}

/**
 * Shuffles the driver values within each stratum (e.g. weekday vs weekend)
 * and asks how often a shuffled driver is as strongly linked to the outcome
 * as the real one. A pattern explained by weekends alone is not reported as
 * a link between the driver and the outcome.
 *
 * The p-value comes from the rank correlation, which uses every day. The
 * low/high group difference is computed under the same shuffles so it can be
 * adjusted for the strata too; it is shown to the user and checked against
 * the minimum effect, but not used for the p-value.
 *
 * Shuffling within strata keeps each stratum's values, so the null
 * distribution is centred on whatever the strata themselves produce. The
 * test is two-sided around that centre.
 */
export function stratifiedPermutationTest(
  driver: number[],
  outcome: number[],
  strata: string[],
  isLow: (v: number) => boolean,
  iterations: number,
  random: () => number,
): PermutationResult {
  const n = outcome.length
  if (driver.length !== n || strata.length !== n) throw new Error('permutation test: inputs differ in length')

  // Rank once; shuffling the driver just shuffles its ranks
  const rx = ranks(driver)
  const ry = ranks(outcome)
  const mry = mean(ry)
  const ryc = ry.map((v) => v - mry)
  const mrx = mean(rx)
  const sxx = rx.reduce((s, v) => s + (v - mrx) ** 2, 0)
  const syy = ryc.reduce((s, v) => s + v * v, 0)
  const denom = Math.sqrt(sxx * syy)

  const rhoOf = (r: number[]) => {
    if (denom === 0) return 0
    let sxy = 0
    for (let i = 0; i < n; i++) sxy += r[i] * ryc[i]
    return sxy / denom
  }
  const diffOf = (lows: boolean[]) => {
    let sumH = 0
    let nH = 0
    let sumL = 0
    let nL = 0
    for (let i = 0; i < n; i++) {
      if (lows[i]) { sumL += outcome[i]; nL++ } else { sumH += outcome[i]; nH++ }
    }
    return nH > 0 && nL > 0 ? sumH / nH - sumL / nL : 0
  }

  const low = driver.map(isLow)
  const rho = rhoOf(rx)
  const diff = diffOf(low)

  // Index positions per stratum, so each shuffle stays inside its stratum
  const groups = new Map<string, number[]>()
  strata.forEach((s, i) => {
    const g = groups.get(s)
    if (g) g.push(i)
    else groups.set(s, [i])
  })

  const pr = [...rx]
  const pl = [...low]
  const nullRho = new Array<number>(iterations)
  let diffSum = 0
  for (let it = 0; it < iterations; it++) {
    for (const idx of groups.values()) {
      // Fisher–Yates over this stratum's positions, moving rank and group together
      for (let j = idx.length - 1; j > 0; j--) {
        const a = idx[j]
        const b = idx[Math.floor(random() * (j + 1))]
        const tr = pr[a]; pr[a] = pr[b]; pr[b] = tr
        const tl = pl[a]; pl[a] = pl[b]; pl[b] = tl
      }
    }
    nullRho[it] = rhoOf(pr)
    diffSum += diffOf(pl)
  }

  const rhoNullMean = mean(nullRho)
  const diffNullMean = diffSum / iterations
  const dev = Math.abs(rho - rhoNullMean)
  // Small tolerance so floating-point noise doesn't make ties look less extreme
  const extreme = nullRho.filter((v) => Math.abs(v - rhoNullMean) >= dev - 1e-12).length
  return {
    rho,
    rhoNullMean,
    diff,
    diffNullMean,
    adjustedDiff: diff - diffNullMean,
    p: (extreme + 1) / (iterations + 1),
  }
}

// ─── Multiple testing ────────────────────────────────────────────────────────

/** Benjamini–Hochberg adjusted p-values (q-values), returned in input order */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length
  if (m === 0) return []
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const q = new Array<number>(m)
  let running = 1
  for (let k = m - 1; k >= 0; k--) {
    running = Math.min(running, (order[k].p * m) / (k + 1))
    q[order[k].i] = running
  }
  return q
}
