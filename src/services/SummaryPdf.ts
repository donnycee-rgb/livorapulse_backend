import PDFDocument from 'pdfkit'
import type { HealthSummary, MetricKey, MetricSummary } from '../insights/summary'
import { formatDateLong, formatSummaryValue, SUMMARY_DISCLAIMER } from '../insights/wording'

// ─── Renders a HealthSummary as an A4 PDF ───────────────────────────────────
// One page for the summary; the user's notes (only if they chose to include
// them) go on a second page.

const PAGE = { width: 595.28, height: 841.89, margin: 40 }
const CONTENT_W = PAGE.width - PAGE.margin * 2
const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'
const GREEN = '#4CAF50'
const INDIGO = '#6366F1'

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

const METRIC_TITLE: Record<MetricKey, string> = { sleep: 'Sleep', mood: 'Mood', stress: 'Stress', walks: 'Walks' }
const METRIC_UNIT: Record<MetricKey, string> = { sleep: 'a night', mood: 'out of 5', stress: 'out of 5 (5 = very stressed)', walks: 'on walk days' }

type Doc = PDFKit.PDFDocument

function metricBox(doc: Doc, key: MetricKey, m: MetricSummary, x: number, y: number, w: number, h: number): void {
  doc.roundedRect(x, y, w, h, 8).lineWidth(0.8).strokeColor(LINE).stroke()
  const pad = 10
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(METRIC_TITLE[key], x + pad, y + pad, { width: w - pad * 2 })

  const avg = m.average === null ? '–' : formatSummaryValue(key, m.average)
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(avg, x + pad, y + pad + 15, { continued: true })
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(m.average === null ? '' : `  ${METRIC_UNIT[key]}`)

  doc.font('Helvetica').fontSize(8).fillColor(INK).text(pdfSafe(m.text), x + pad, y + pad + 38, { width: w - pad * 2, lineGap: 1 })

  // Weekly averages as small bars along the bottom
  const chartH = 26
  const chartY = y + h - pad - chartH
  const values = m.weekly.map((wk) => wk.value)
  const top = key === 'mood' || key === 'stress' ? 5 : Math.max(1, ...values.filter((v): v is number => v !== null))
  const gap = 2
  const barW = (w - pad * 2 - gap * (values.length - 1)) / Math.max(1, values.length)
  values.forEach((v, i) => {
    const bx = x + pad + i * (barW + gap)
    doc.rect(bx, chartY, barW, chartH).fillColor('#f3f4f6').fill()
    if (v !== null) {
      const bh = Math.max(1.5, (v / top) * chartH)
      doc.rect(bx, chartY + chartH - bh, barW, bh).fillColor(key === 'stress' ? INDIGO : GREEN).fill()
    }
  })
  doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text('Weekly averages', x + pad, chartY - 9)
}

function sectionTitle(doc: Doc, title: string, y: number): number {
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(title, PAGE.margin, y)
  return y + 15
}

/** Renders the summary and resolves with the PDF bytes */
export function renderSummaryPdf(s: HealthSummary): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    info: { Title: 'Health summary', Author: 'LivoraPulse', Subject: SUMMARY_DISCLAIMER },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const left = PAGE.margin
  let y = PAGE.margin

  // ── Header ──
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('Health summary', left, y)
  doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN).text('LivoraPulse', left, y + 4, { width: CONTENT_W, align: 'right' })
  y += 26
  const who = [s.person.name, s.person.age !== null ? `${s.person.age} years` : null, s.person.sex].filter(Boolean).join(' · ')
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(pdfSafe(who), left, y)
  y += 14
  doc.fillColor(MUTED).fontSize(9).text(
    `${formatDateLong(s.period.from)} – ${formatDateLong(s.period.to)} (${s.period.days} days) · Generated ${formatDateLong(s.generatedAt.slice(0, 10))}`,
    left,
    y,
  )
  y += 18

  // ── Disclaimer ──
  doc.roundedRect(left, y, CONTENT_W, 24, 6).fillColor('#fef3c7').fill()
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#92400e').text(SUMMARY_DISCLAIMER, left + 10, y + 8, { width: CONTENT_W - 20 })
  y += 34

  // ── Four metrics in a 2 × 2 grid ──
  const boxW = (CONTENT_W - 10) / 2
  const boxH = 150
  const keys: MetricKey[] = ['sleep', 'mood', 'stress', 'walks']
  keys.forEach((k, i) => {
    metricBox(doc, k, s[k], left + (i % 2) * (boxW + 10), y + Math.floor(i / 2) * (boxH + 10), boxW, boxH)
  })
  y += boxH * 2 + 10 + 16

  // ── Cycle ──
  if (s.cycle) {
    y = sectionTitle(doc, 'Menstrual cycle', y)
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(pdfSafe(s.cycle.text), left, y, { width: CONTENT_W, lineGap: 1 })
    y = doc.y + 12
  }

  // ── Flags (Phase 4) ──
  if (s.flags.length > 0) {
    y = sectionTitle(doc, 'Worth discussing', y)
    for (const f of s.flags) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(pdfSafe(f.title), left, y, { width: CONTENT_W })
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(pdfSafe(f.detail), left, doc.y + 1, { width: CONTENT_W })
      y = doc.y + 6
    }
    y += 6
  }

  // ── Insights ──
  if (s.insights.length > 0) {
    y = sectionTitle(doc, 'Patterns in their own logs (links, not proven causes)', y)
    for (const text of s.insights.slice(0, 5)) {
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(`•  ${pdfSafe(text)}`, left, y, { width: CONTENT_W, lineGap: 1 })
      y = doc.y + 4
    }
  }

  // ── Footer ──
  const footer = 'Values are entered by the user in the LivoraPulse app and have not been clinically verified.'
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(footer, left, PAGE.height - PAGE.margin - 10, { width: CONTENT_W, align: 'center', lineBreak: false })

  // ── Notes, on their own page ──
  if (s.notes && s.notes.length > 0) {
    doc.addPage()
    let ny = PAGE.margin
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text('Notes written by the user', left, ny)
    ny += 20
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Included because the user chose to share them. Most recent first.', left, ny)
    ny += 18
    for (const n of s.notes) {
      if (ny > PAGE.height - PAGE.margin - 40) {
        doc.addPage()
        ny = PAGE.margin
      }
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(`${formatDateLong(n.date)} · ${n.area}`, left, ny)
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(pdfSafe(n.text), left, doc.y + 1, { width: CONTENT_W, lineGap: 1 })
      ny = doc.y + 8
    }
  }

  doc.end()
  return done
}
