import PDFDocument from 'pdfkit'
import type { CycleSummary, HealthSummary, MetricKey, MetricSummary } from '../insights/summary'
import { TYPICAL_CYCLE } from '../insights/summary'
import { formatDateLong, formatSummaryValue, SUMMARY_DISCLAIMER } from '../insights/wording'

// ─── Renders a HealthSummary as an A4 report ────────────────────────────────
// Made to be read by a doctor in a minute:
//   page 1  header, "at a glance" (average, direction, how much was logged),
//           then one chart per measure: a dot for every day logged, a line
//           through the weekly averages, and for sleep the recommended band;
//   page 2  cycle (lengths against the typical range, flow, symptoms), things
//           worth discussing, patterns in their logs; notes after, if shared.
// Every page carries the person, the period and a page number.

const PAGE = { width: 595.28, height: 841.89, margin: 36 }
const CONTENT_W = PAGE.width - PAGE.margin * 2
const FOOTER_Y = PAGE.height - 28

const INK = '#111827'
const BODY = '#374151'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
const LINE = '#e5e7eb'
const PANEL = '#f9fafb'
const BRAND = '#14532d'
const BRAND_LIGHT = '#bbf7d0'
const AMBER_BG = '#fef3c7'
const AMBER_INK = '#92400e'

/** One colour per measure (checked together for colour-blind separation; each chart shows one measure) */
const COLOR: Record<MetricKey, string> = { sleep: '#7C3AED', mood: '#DB2777', stress: '#EA580C', walks: '#16A34A' }
const CYCLE = '#E11D48'

/**
 * The built-in PDF fonts only cover Western European characters. Anything
 * else (emoji, other scripts) would print as garbage, so it's replaced.
 */
const EXTRA_WIN_ANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
export function pdfSafe(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const code = ch.codePointAt(0)!
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || EXTRA_WIN_ANSI.includes(ch)) return ch
      if (ch === '\n') return ch
      return code > 0xffff ? '' : '?' // drop emoji, mark other unsupported letters
    })
    .join('')
}

const TITLE: Record<MetricKey, string> = { sleep: 'Sleep', mood: 'Mood', stress: 'Stress', walks: 'Walks' }
const UNIT: Record<MetricKey, string> = { sleep: 'average a night', mood: 'average, out of 5', stress: 'average, out of 5', walks: 'average on walk days' }
const SCALE_NOTE: Partial<Record<MetricKey, string>> = { sleep: 'Shaded: the recommended 7–9 h for adults', mood: '1 = very low, 5 = very good', stress: '1 = very calm, 5 = very stressed' }
const NOTABLE: Partial<Record<MetricKey, (n: number) => string>> = {
  sleep: (n) => `${n} night${n === 1 ? '' : 's'} under 6 h`,
  mood: (n) => `${n} low day${n === 1 ? '' : 's'} (2 or less)`,
  stress: (n) => `${n} high-stress day${n === 1 ? '' : 's'} (4 or more)`,
}

type Doc = PDFKit.PDFDocument

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (key: string) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }

function text(doc: Doc, s: string, x: number, y: number, o: { font?: string; size?: number; color?: string; width?: number; align?: 'left' | 'right' | 'center'; lineGap?: number } = {}): number {
  doc.font(o.font ?? 'Helvetica').fontSize(o.size ?? 9).fillColor(o.color ?? BODY)
  doc.text(pdfSafe(s), x, y, { width: o.width, align: o.align, lineGap: o.lineGap ?? 1 })
  return doc.y
}

function sectionTitle(doc: Doc, title: string, y: number, sub?: string): number {
  doc.rect(PAGE.margin, y + 1, 3, 12).fillColor(BRAND).fill()
  text(doc, title, PAGE.margin + 9, y, { font: 'Helvetica-Bold', size: 11.5, color: INK })
  if (sub) text(doc, sub, PAGE.margin + 9, y + 15, { size: 8, color: MUTED, width: CONTENT_W - 9 })
  return y + (sub ? 30 : 20)
}

/** Small up / down triangle, or a dot for steady */
function trendMark(doc: Doc, trend: MetricSummary['trend'], x: number, y: number): void {
  doc.fillColor(BODY)
  if (trend === 'higher') doc.polygon([x, y + 6], [x + 7, y + 6], [x + 3.5, y]).fill()
  else if (trend === 'lower') doc.polygon([x, y], [x + 7, y], [x + 3.5, y + 6]).fill()
  else if (trend === 'steady') doc.circle(x + 3.5, y + 3, 2.6).fill()
}
const TREND_WORD = { higher: 'Higher lately', lower: 'Lower lately', steady: 'Steady' } as const

// ── Page furniture ──────────────────────────────────────────────────────────

function header(doc: Doc, s: HealthSummary): number {
  const h = 92
  doc.rect(0, 0, PAGE.width, h).fillColor(BRAND).fill()
  text(doc, 'LIVORAPULSE', PAGE.margin, 22, { font: 'Helvetica-Bold', size: 8, color: BRAND_LIGHT })
  text(doc, 'Health summary', PAGE.margin, 33, { font: 'Helvetica-Bold', size: 22, color: '#ffffff' })
  const who = [s.person.name, s.person.age !== null ? `${s.person.age} years` : null, s.person.sex].filter(Boolean).join('  ·  ')
  text(doc, who, PAGE.margin, 62, { size: 10, color: '#ffffff' })
  const period = `${formatDateLong(s.period.from)} – ${formatDateLong(s.period.to)}`
  text(doc, period, PAGE.margin, 30, { font: 'Helvetica-Bold', size: 10, color: '#ffffff', width: CONTENT_W, align: 'right' })
  text(doc, `${s.period.days} days  ·  generated ${formatDateLong(s.generatedAt.slice(0, 10))}`, PAGE.margin, 45, { size: 8.5, color: BRAND_LIGHT, width: CONTENT_W, align: 'right' })

  const y = h + 12
  doc.roundedRect(PAGE.margin, y, CONTENT_W, 22, 5).fillColor(AMBER_BG).fill()
  text(doc, `${s.disclaimer}  Values are entered by the person in the app and have not been clinically verified.`,
    PAGE.margin + 10, y + 7, { font: 'Helvetica', size: 8, color: AMBER_INK, width: CONTENT_W - 20 })
  return y + 34
}

function footers(doc: Doc, s: HealthSummary): void {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    // the footer sits below the text area; without this PDFKit would start a new page
    doc.page.margins.bottom = 0
    doc.moveTo(PAGE.margin, FOOTER_Y - 6).lineTo(PAGE.width - PAGE.margin, FOOTER_Y - 6).lineWidth(0.5).strokeColor(LINE).stroke()
    const left = `${s.person.name}  ·  ${formatDateLong(s.period.from)} – ${formatDateLong(s.period.to)}  ·  LivoraPulse`
    doc.font('Helvetica').fontSize(7).fillColor(FAINT)
    doc.text(pdfSafe(left), PAGE.margin, FOOTER_Y, { lineBreak: false })
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.margin, FOOTER_Y, { width: CONTENT_W, align: 'right', lineBreak: false })
  }
}

// ── At a glance ─────────────────────────────────────────────────────────────

function glance(doc: Doc, s: HealthSummary, y: number): number {
  const keys: MetricKey[] = ['sleep', 'mood', 'stress', 'walks']
  const gap = 8
  const w = (CONTENT_W - gap * 3) / 4
  const h = 82
  keys.forEach((k, i) => {
    const m = s[k]
    const x = PAGE.margin + i * (w + gap)
    doc.roundedRect(x, y, w, h, 7).fillColor(PANEL).fill()
    doc.rect(x, y + 10, 2.5, 14).fillColor(COLOR[k]).fill()
    text(doc, TITLE[k].toUpperCase(), x + 10, y + 13, { font: 'Helvetica-Bold', size: 7.5, color: MUTED })
    const value = m.average === null ? '–' : formatSummaryValue(k, m.average)
    text(doc, value, x + 10, y + 27, { font: 'Helvetica-Bold', size: k === 'walks' ? 13 : 16, color: INK, width: w - 16 })
    text(doc, UNIT[k], x + 10, y + 46, { size: 7, color: MUTED, width: w - 16 })
    if (m.trend) {
      trendMark(doc, m.trend, x + 10, y + 59)
      text(doc, TREND_WORD[m.trend], x + 21, y + 58.5, { size: 7.5, color: BODY })
    }
    // How much of the period was logged
    const frac = m.daysLogged / s.period.days
    const by = y + h - 9
    doc.roundedRect(x + 10, by, w - 20, 3, 1.5).fillColor(LINE).fill()
    if (frac > 0) doc.roundedRect(x + 10, by, Math.max(3, (w - 20) * Math.min(1, frac)), 3, 1.5).fillColor(COLOR[k]).fill()
    text(doc, `${m.daysLogged}/${s.period.days} days`, x + 10, by - 10, { size: 6.5, color: FAINT, width: w - 20, align: 'right' })
  })
  return y + h + 16
}

// ── One chart per measure ───────────────────────────────────────────────────

type Axis = { lo: number; hi: number; ticks: number[]; label: (v: number) => string; band?: [number, number] }

function axisFor(k: MetricKey, m: MetricSummary): Axis {
  if (k === 'mood' || k === 'stress') return { lo: 1, hi: 5, ticks: [1, 2, 3, 4, 5], label: (v) => String(v) }
  if (k === 'sleep') {
    const vals = [...(m.daily ?? []), ...m.weekly.map((w) => w.value)].filter((v): v is number => v !== null)
    const lo = Math.min(240, Math.floor((Math.min(...vals, 240) - 30) / 60) * 60)
    const hi = Math.max(600, Math.ceil((Math.max(...vals, 600) + 30) / 60) * 60)
    const ticks: number[] = []
    for (let t = lo; t <= hi; t += 120) ticks.push(t)
    return { lo, hi, ticks, label: (v) => `${v / 60}h`, band: [420, 540] }
  }
  const top = Math.max(1000, ...(m.daily ?? []).filter((v): v is number => v !== null), ...m.weekly.map((w) => w.value ?? 0))
  const step = top > 20000 ? 10000 : top > 8000 ? 5000 : 2000
  const hi = Math.ceil(top / step) * step
  const ticks: number[] = []
  for (let t = 0; t <= hi; t += step) ticks.push(t)
  return { lo: 0, hi, ticks, label: (v) => (v === 0 ? '0' : `${v / 1000}k`) }
}

function metricPanel(doc: Doc, k: MetricKey, m: MetricSummary, s: HealthSummary, x: number, y: number, w: number, h: number): void {
  doc.roundedRect(x, y, w, h, 8).lineWidth(0.7).strokeColor(LINE).stroke()
  const pad = 12
  doc.circle(x + pad + 3, y + pad + 4, 3).fillColor(COLOR[k]).fill()
  text(doc, TITLE[k], x + pad + 11, y + pad - 1, { font: 'Helvetica-Bold', size: 10.5, color: INK })
  if (m.average !== null) {
    text(doc, formatSummaryValue(k, m.average), x + pad, y + pad - 1, { font: 'Helvetica-Bold', size: 10.5, color: INK, width: w - pad * 2, align: 'right' })
  }
  if (SCALE_NOTE[k]) text(doc, SCALE_NOTE[k]!, x + pad + 11, y + pad + 13, { size: 7, color: FAINT })

  // Plot area
  const px = x + pad + 24
  const py = y + pad + 28
  const pw = w - pad * 2 - 26
  const ph = 92
  const a = axisFor(k, m)
  const yOf = (v: number) => py + ph - ((Math.min(a.hi, Math.max(a.lo, v)) - a.lo) / (a.hi - a.lo)) * ph

  if (a.band) {
    const top = yOf(a.band[1]), bottom = yOf(a.band[0])
    doc.rect(px, top, pw, bottom - top).fillColor(COLOR[k]).fillOpacity(0.08).fill().fillOpacity(1)
  }
  for (const t of a.ticks) {
    const ty = yOf(t)
    doc.moveTo(px, ty).lineTo(px + pw, ty).lineWidth(0.4).strokeColor(LINE).stroke()
    text(doc, a.label(t), x + pad - 2, ty - 3.5, { size: 6.5, color: FAINT, width: 22, align: 'right' })
  }

  const n = s.period.days
  const xOfDay = (i: number) => px + ((i + 0.5) / n) * pw
  const daily = m.daily ?? []
  const any = m.daysLogged > 0

  if (!any) {
    text(doc, k === 'walks' ? 'No walks recorded in this period' : 'Not logged in this period', px, py + ph / 2 - 5, { size: 8.5, color: FAINT, width: pw, align: 'center' })
  } else {
    // a dot for every day logged
    doc.fillColor(COLOR[k]).fillOpacity(0.28)
    daily.forEach((v, i) => { if (v !== null) doc.circle(xOfDay(i), yOf(v), 1.7).fill() })
    doc.fillOpacity(1)
    // the weekly averages as a line (broken where a week has nothing)
    const pts = m.weekly.map((wk, i) => {
      const mid = Math.min(n - 1, i * 7 + 3)
      return wk.value === null ? null : { x: xOfDay(mid), y: yOf(wk.value) }
    })
    let drawing = false
    pts.forEach((p) => {
      if (!p) { drawing = false; return }
      if (!drawing) { doc.moveTo(p.x, p.y); drawing = true } else doc.lineTo(p.x, p.y)
    })
    doc.lineWidth(1.8).strokeColor(COLOR[k]).lineJoin('round').stroke()
    pts.forEach((p) => { if (p) doc.circle(p.x, p.y, 2.6).lineWidth(1.2).fillAndStroke(COLOR[k], '#ffffff') })
  }

  // Week labels along the bottom (every other week for 3 months)
  const every = m.weekly.length > 6 ? 2 : 1
  m.weekly.forEach((wk, i) => {
    if (i % every !== 0) return
    const lx = xOfDay(Math.min(n - 1, i * 7))
    text(doc, shortDate(wk.weekStart), lx - 14, py + ph + 4, { size: 6.5, color: FAINT, width: 28, align: 'center' })
  })

  // Numbers that matter, then the sentence
  const facts: string[] = []
  if (m.min !== null && m.max !== null) facts.push(`Lowest ${formatSummaryValue(k, m.min)}  ·  Highest ${formatSummaryValue(k, m.max)}`)
  if (m.notableDays !== null && NOTABLE[k]) facts.push(NOTABLE[k]!(m.notableDays))
  let ty = py + ph + 16
  if (facts.length) ty = text(doc, facts.join('  ·  '), x + pad, ty, { font: 'Helvetica-Bold', size: 7.5, color: BODY, width: w - pad * 2 }) + 2
  text(doc, m.text, x + pad, ty, { size: 7.5, color: MUTED, width: w - pad * 2, lineGap: 1.2 })
  if (any) {
    const ly = y + h - 12
    doc.circle(x + pad + 2, ly + 2.5, 1.7).fillColor(COLOR[k]).fillOpacity(0.35).fill().fillOpacity(1)
    text(doc, 'each day', x + pad + 7, ly, { size: 6.5, color: FAINT })
    doc.moveTo(x + pad + 42, ly + 2.5).lineTo(x + pad + 54, ly + 2.5).lineWidth(1.6).strokeColor(COLOR[k]).stroke()
    text(doc, 'weekly average', x + pad + 58, ly, { size: 6.5, color: FAINT })
  }
}

// ── Cycle ───────────────────────────────────────────────────────────────────

function cycleSection(doc: Doc, c: CycleSummary, y: number): number {
  y = sectionTitle(doc, 'Menstrual cycle', y, 'From the days the person marked as period days.')

  // three numbers
  const stats: Array<[string, string]> = [
    [String(c.periodsLogged), c.periodsLogged === 1 ? 'period logged' : 'periods logged'],
    [c.averageLength === null ? '–' : `${c.averageLength} days`, 'average cycle length'],
    [String(c.outsideTypicalRange), `cycles outside ${TYPICAL_CYCLE.min}–${TYPICAL_CYCLE.max} days`],
  ]
  const w = (CONTENT_W - 16) / 3
  stats.forEach(([v, l], i) => {
    const x = PAGE.margin + i * (w + 8)
    doc.roundedRect(x, y, w, 44, 7).fillColor(PANEL).fill()
    text(doc, v, x + 10, y + 8, { font: 'Helvetica-Bold', size: 15, color: INK })
    text(doc, l, x + 10, y + 28, { size: 7.5, color: MUTED, width: w - 20 })
  })
  y += 56

  // cycle lengths on a line, against the typical range
  if (c.lengths.length > 0) {
    text(doc, 'Cycle lengths', PAGE.margin, y, { font: 'Helvetica-Bold', size: 8.5, color: INK })
    text(doc, 'in days', PAGE.margin, y + 11, { size: 7, color: FAINT })
    const lo = 15, hi = 50
    const lx = PAGE.margin + 60, lw = CONTENT_W - 70, ly = y + 16
    const xOf = (d: number) => lx + ((Math.min(hi, Math.max(lo, d)) - lo) / (hi - lo)) * lw
    doc.rect(xOf(TYPICAL_CYCLE.min), ly - 9, xOf(TYPICAL_CYCLE.max) - xOf(TYPICAL_CYCLE.min), 18).fillColor('#dcfce7').fill()
    text(doc, `typical ${TYPICAL_CYCLE.min}–${TYPICAL_CYCLE.max} days`, xOf(TYPICAL_CYCLE.min) + 3, ly - 19, { size: 6.5, color: '#15803d' })
    doc.moveTo(lx, ly).lineTo(lx + lw, ly).lineWidth(0.6).strokeColor(FAINT).stroke()
    for (let t = 15; t <= 50; t += 5) {
      doc.moveTo(xOf(t), ly - 2).lineTo(xOf(t), ly + 2).stroke()
      text(doc, String(t), xOf(t) - 8, ly + 6, { size: 6.5, color: FAINT, width: 16, align: 'center' })
    }
    c.lengths.forEach((d, i) => {
      const off = (i % 2 === 0 ? -1 : 1) * Math.min(4, Math.floor(i / 2))
      doc.circle(xOf(d), ly + off, 3.6).lineWidth(1).fillAndStroke(CYCLE, '#ffffff')
    })
    y += 40
  }

  // flow and symptoms, side by side
  const colW = (CONTENT_W - 20) / 2
  const startY = y
  const bars = (items: Array<{ label: string; n: number }>, x: number, by: number, title: string) => {
    text(doc, title, x, by, { font: 'Helvetica-Bold', size: 8.5, color: INK })
    by += 14
    const max = Math.max(1, ...items.map((i) => i.n))
    for (const it of items) {
      text(doc, it.label, x, by, { size: 7.5, color: BODY, width: 80 })
      const bw = (colW - 110) * (it.n / max)
      doc.roundedRect(x + 84, by + 1, Math.max(3, bw), 6, 2).fillColor(CYCLE).fillOpacity(0.75).fill().fillOpacity(1)
      text(doc, String(it.n), x + 88 + bw, by, { size: 7.5, color: BODY })
      by += 12
    }
    return by
  }
  const FLOW_ORDER = ['spotting', 'light', 'medium', 'heavy']
  const flow = FLOW_ORDER.filter((f) => c.flow[f]).map((f) => ({ label: f[0].toUpperCase() + f.slice(1), n: c.flow[f] }))
  const sym = c.symptoms.slice(0, 7).map((x) => ({ label: x.name, n: x.count }))
  const endA = flow.length ? bars(flow, PAGE.margin, startY, 'Heaviest flow, by period') : startY
  const endB = sym.length ? bars(sym, PAGE.margin + colW + 20, startY, 'Symptoms, periods they were logged with') : startY
  y = Math.max(endA, endB) + (flow.length || sym.length ? 6 : 0)

  y = text(doc, c.text, PAGE.margin, y, { size: 8, color: MUTED, width: CONTENT_W, lineGap: 1.2 }) + 14
  return y
}

// ── Report ──────────────────────────────────────────────────────────────────

/** Renders the summary and resolves with the PDF bytes */
export function renderSummaryPdf(s: HealthSummary): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    margins: { top: PAGE.margin, bottom: 40, left: PAGE.margin, right: PAGE.margin },
    info: { Title: `Health summary – ${pdfSafe(s.person.name)}`, Author: 'LivoraPulse', Subject: SUMMARY_DISCLAIMER },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  const bottom = FOOTER_Y - 16
  const room = (y: number, need: number) => {
    if (y + need <= bottom) return y
    doc.addPage()
    return PAGE.margin
  }

  // ── Page 1: at a glance and the four measures ──
  let y = header(doc, s)
  y = sectionTitle(doc, 'At a glance', y)
  y = glance(doc, s, y)
  y = sectionTitle(doc, 'Day by day', y, 'Each dot is one day the person logged. The line joins the weekly averages.')
  const gap = 10
  const pw = (CONTENT_W - gap) / 2
  const ph = 214
  const keys: MetricKey[] = ['sleep', 'mood', 'stress', 'walks']
  keys.forEach((k, i) => metricPanel(doc, k, s[k], s, PAGE.margin + (i % 2) * (pw + gap), y + Math.floor(i / 2) * (ph + gap), pw, ph))
  y += ph * 2 + gap

  // ── Page 2: cycle, things to discuss, patterns ──
  const more = s.cycle || s.flags.length > 0 || s.insights.length > 0
  if (more) {
    doc.addPage()
    y = PAGE.margin

    if (s.flags.length > 0) {
      y = sectionTitle(doc, 'Worth discussing', y, 'Patterns the app suggests getting checked. They are not a diagnosis.')
      for (const f of s.flags) {
        doc.font('Helvetica').fontSize(8.5)
        const hgt = doc.heightOfString(pdfSafe(f.detail), { width: CONTENT_W - 28 }) + 26
        y = room(y, hgt)
        doc.roundedRect(PAGE.margin, y, CONTENT_W, hgt, 6).fillColor('#fffbeb').fill()
        doc.rect(PAGE.margin, y, 3, hgt).fillColor('#f59e0b').fill()
        text(doc, f.title, PAGE.margin + 14, y + 8, { font: 'Helvetica-Bold', size: 9.5, color: INK, width: CONTENT_W - 28 })
        text(doc, f.detail, PAGE.margin + 14, y + 21, { size: 8.5, color: BODY, width: CONTENT_W - 28 })
        y += hgt + 6
      }
      y += 8
    }

    if (s.cycle) {
      y = room(y, 200)
      y = cycleSection(doc, s.cycle, y)
    }

    if (s.insights.length > 0) {
      y = room(y, 60)
      y = sectionTitle(doc, 'Patterns in their own logs', y, 'Found by comparing their good and bad days. Links, not proven causes.')
      s.insights.slice(0, 6).forEach((t, i) => {
        doc.font('Helvetica').fontSize(8.5)
        const hgt = Math.max(18, doc.heightOfString(pdfSafe(t), { width: CONTENT_W - 30 }) + 6)
        y = room(y, hgt)
        doc.circle(PAGE.margin + 8, y + 6, 8).fillColor('#dcfce7').fill()
        text(doc, String(i + 1), PAGE.margin, y + 2, { font: 'Helvetica-Bold', size: 8, color: BRAND, width: 16, align: 'center' })
        text(doc, t, PAGE.margin + 24, y + 1.5, { size: 8.5, color: BODY, width: CONTENT_W - 30, lineGap: 1.2 })
        y = doc.y + 8
      })
    }
  }

  // ── Notes, only when the person chose to include them ──
  if (s.notes && s.notes.length > 0) {
    doc.addPage()
    y = sectionTitle(doc, 'Notes written by the person', PAGE.margin, 'Included because they chose to share them. Most recent first.')
    for (const n of s.notes) {
      doc.font('Helvetica').fontSize(8.5)
      const hgt = doc.heightOfString(pdfSafe(n.text), { width: CONTENT_W - 12 }) + 18
      y = room(y, hgt)
      text(doc, `${formatDateLong(n.date)}  ·  ${n.area}`, PAGE.margin + 12, y, { font: 'Helvetica-Bold', size: 8, color: MUTED })
      doc.rect(PAGE.margin, y, 2, hgt - 6).fillColor(LINE).fill()
      text(doc, n.text, PAGE.margin + 12, y + 11, { size: 8.5, color: BODY, width: CONTENT_W - 12, lineGap: 1.2 })
      y = doc.y + 10
    }
  }

  footers(doc, s)
  doc.end()
  return done
}
