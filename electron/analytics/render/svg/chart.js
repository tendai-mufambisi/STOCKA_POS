const { linear, niceTicks, formatAxis, esc } = require('./scales')
const { PALETTE, seriesColour } = require('../html/palette')

// Charts as SVG strings.
//
// No recharts, no d3, no DOM, no canvas. A PDF is produced in the main process
// where there is no document to render into, and scheduled reports run with
// nobody logged in — so the chart has to be a string the HTML can simply
// contain.
//
// The upside beyond PDF: these are pure functions from data to text, so they
// snapshot-test exactly like any other output, and a chart cannot break because
// a charting library changed its defaults.

const DEFAULTS = { width: 720, height: 260, padTop: 16, padRight: 16, padBottom: 34, padLeft: 56 }

function frame(opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  return {
    ...o,
    plotW: o.width - o.padLeft - o.padRight,
    plotH: o.height - o.padTop - o.padBottom,
  }
}

function open(f, title) {
  return (
    `<svg class="chart" viewBox="0 0 ${f.width} ${f.height}" width="100%" height="${f.height}" ` +
    `role="img" xmlns="http://www.w3.org/2000/svg"` +
    (title ? ` aria-label="${esc(title)}">` + `<title>${esc(title)}</title>` : '>')
  )
}

/** Horizontal gridlines with a y axis. Shared by bar and line. */
function yAxis(f, ticks, y, unit) {
  return ticks
    .map((t) => {
      const py = y(t).toFixed(1)
      return (
        `<line x1="${f.padLeft}" y1="${py}" x2="${f.padLeft + f.plotW}" y2="${py}" ` +
        `stroke="${PALETTE.ruleFaint}" stroke-width="1"/>` +
        `<text x="${f.padLeft - 8}" y="${py}" text-anchor="end" dominant-baseline="middle" ` +
        `font-size="10" fill="${PALETTE.inkFaint}">${esc(formatAxis(t, unit))}</text>`
      )
    })
    .join('')
}

/**
 * Vertical bars.
 * @param series [{ name, points: [{x, y}] }] — the first series is drawn.
 */
function barChart(series, opts = {}) {
  const f = frame(opts)
  const unit = opts.unit || 'currency'
  const points = series?.[0]?.points || []
  if (points.length === 0) return emptyChart(f, opts.title)

  const values = points.map((p) => Number(p.y) || 0)
  const { ticks, min, max } = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4)
  const y = linear(min, max, f.padTop + f.plotH, f.padTop)

  const slot = f.plotW / points.length
  const barW = Math.max(2, Math.min(48, slot * 0.62))

  // Label every bar when there is room; otherwise thin them out so the axis
  // does not turn into an unreadable smear.
  const labelEvery = Math.ceil((points.length * 46) / f.plotW)

  const bars = points
    .map((p, i) => {
      const v = Number(p.y) || 0
      const cx = f.padLeft + slot * i + slot / 2
      const top = Math.min(y(v), y(0))
      const h = Math.max(1, Math.abs(y(v) - y(0)))
      const label =
        i % labelEvery === 0
          ? `<text x="${cx.toFixed(1)}" y="${f.padTop + f.plotH + 14}" text-anchor="middle" ` +
            `font-size="10" fill="${PALETTE.inkFaint}">${esc(shortLabel(p.x))}</text>`
          : ''
      return (
        `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" ` +
        `height="${h.toFixed(1)}" fill="${opts.colour || PALETTE.series[0]}" rx="1.5"/>` + label
      )
    })
    .join('')

  return open(f, opts.title) + yAxis(f, ticks, y, unit) + bars + '</svg>'
}

/** Line chart, optionally with several series. */
function lineChart(series, opts = {}) {
  const f = frame(opts)
  const unit = opts.unit || 'currency'
  const all = (series || []).filter((s) => s.points?.length)
  if (all.length === 0) return emptyChart(f, opts.title)

  const values = all.flatMap((s) => s.points.map((p) => Number(p.y) || 0))
  const { ticks, min, max } = niceTicks(Math.min(0, ...values), Math.max(...values), 4)
  const y = linear(min, max, f.padTop + f.plotH, f.padTop)
  const n = Math.max(...all.map((s) => s.points.length))
  const x = (i) => f.padLeft + (n === 1 ? f.plotW / 2 : (i / (n - 1)) * f.plotW)

  const lines = all
    .map((s, si) => {
      const d = s.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(p.y) || 0).toFixed(1)}`)
        .join(' ')
      const dots =
        s.points.length <= 40
          ? s.points
              .map(
                (p, i) =>
                  `<circle cx="${x(i).toFixed(1)}" cy="${y(Number(p.y) || 0).toFixed(1)}" r="2.2" ` +
                  `fill="${seriesColour(si)}"/>`
              )
              .join('')
          : ''
      return (
        `<path d="${d}" fill="none" stroke="${seriesColour(si)}" stroke-width="2" ` +
        `stroke-linejoin="round" stroke-linecap="round"/>` + dots
      )
    })
    .join('')

  const labelEvery = Math.ceil((n * 52) / f.plotW)
  const xLabels = (all[0].points || [])
    .map((p, i) =>
      i % labelEvery === 0
        ? `<text x="${x(i).toFixed(1)}" y="${f.padTop + f.plotH + 14}" text-anchor="middle" ` +
          `font-size="10" fill="${PALETTE.inkFaint}">${esc(shortLabel(p.x))}</text>`
        : ''
    )
    .join('')

  const legend = all.length > 1 ? seriesLegend(f, all) : ''
  return open(f, opts.title) + yAxis(f, ticks, y, unit) + lines + xLabels + legend + '</svg>'
}

/** Donut. Slices below 2% are grouped so the ring stays readable. */
function donutChart(slices, opts = {}) {
  const size = opts.size || 220
  const f = { width: size + 240, height: size + 20 }
  const clean = (slices || []).filter((s) => Number(s.value) > 0)
  if (clean.length === 0) return emptyChart({ ...f, padLeft: 0, padTop: 0, plotW: f.width, plotH: f.height }, opts.title)

  const total = clean.reduce((n, s) => n + Number(s.value), 0)
  const cx = size / 2 + 10
  const cy = size / 2 + 10
  const r = size / 2 - 6
  const inner = r * 0.58

  let angle = -Math.PI / 2
  const arcs = clean
    .map((s, i) => {
      const frac = Number(s.value) / total
      const end = angle + frac * Math.PI * 2
      // A full circle cannot be drawn as a single arc — its start and end
      // points coincide, so the path collapses to nothing.
      const d =
        frac >= 0.999
          ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} L ${cx - 0.01} ${cy - inner} ` +
            `A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner} Z`
          : arcPath(cx, cy, r, inner, angle, end)
      angle = end
      return `<path d="${d}" fill="${seriesColour(i)}"/>`
    })
    .join('')

  const legend = clean
    .map((s, i) => {
      const pctv = ((Number(s.value) / total) * 100).toFixed(0)
      const ly = 24 + i * 20
      return (
        `<rect x="${size + 30}" y="${ly - 8}" width="10" height="10" rx="2" fill="${seriesColour(i)}"/>` +
        `<text x="${size + 46}" y="${ly}" font-size="11" fill="${PALETTE.ink}">` +
        `${esc(s.label)} <tspan fill="${PALETTE.inkMuted}">${pctv}%</tspan></text>`
      )
    })
    .join('')

  return (
    `<svg class="chart" viewBox="0 0 ${f.width} ${f.height}" width="100%" height="${f.height}" ` +
    `role="img" xmlns="http://www.w3.org/2000/svg">` +
    (opts.title ? `<title>${esc(opts.title)}</title>` : '') +
    arcs +
    legend +
    '</svg>'
  )
}

/** Tiny inline trend line for a KPI card. */
function sparkline(points, opts = {}) {
  const w = opts.width || 90
  const h = opts.height || 24
  const vals = (points || []).map((p) => Number(p.y) || 0)
  if (vals.length < 2) return ''
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const y = linear(min, max, h - 2, 2)
  const x = (i) => (i / (vals.length - 1)) * w
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
    `xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="none" ` +
    `stroke="${opts.colour || PALETTE.inkMuted}" stroke-width="1.5"/></svg>`
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function arcPath(cx, cy, r, inner, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0
  const p = (rad, a) => [(cx + rad * Math.cos(a)).toFixed(2), (cy + rad * Math.sin(a)).toFixed(2)]
  const [x0, y0] = p(r, a0)
  const [x1, y1] = p(r, a1)
  const [x2, y2] = p(inner, a1)
  const [x3, y3] = p(inner, a0)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`
}

function emptyChart(f, title) {
  return (
    `<svg class="chart chart-empty" viewBox="0 0 ${f.width} ${f.height}" width="100%" ` +
    `height="${f.height}" xmlns="http://www.w3.org/2000/svg">` +
    (title ? `<title>${esc(title)}</title>` : '') +
    `<text x="${f.width / 2}" y="${f.height / 2}" text-anchor="middle" font-size="12" ` +
    `fill="${PALETTE.inkFaint}">No data for this period</text></svg>`
  )
}

function seriesLegend(f, series) {
  return series
    .map(
      (s, i) =>
        `<rect x="${f.padLeft + i * 110}" y="4" width="9" height="9" rx="2" fill="${seriesColour(i)}"/>` +
        `<text x="${f.padLeft + i * 110 + 14}" y="12" font-size="10" fill="${PALETTE.inkMuted}">${esc(s.name)}</text>`
    )
    .join('')
}

/** '2026-07-14' reads as '14 Jul' on an axis; anything else is passed through. */
function shortLabel(x) {
  const s = String(x ?? '')
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return s.length > 12 ? s.slice(0, 11) + '…' : s
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`
}

module.exports = { barChart, lineChart, donutChart, sparkline }
