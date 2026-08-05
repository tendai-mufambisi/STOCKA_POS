// Scales and axis maths for the chart renderer.
//
// Small and self-contained on purpose: pulling in d3-scale to draw a bar chart
// into a PDF would add a dependency tree to the main process for arithmetic
// that fits on one screen.

/** Map a domain [d0,d1] onto a range [r0,r1]. */
function linear(d0, d1, r0, r1) {
  const span = d1 - d0
  return (v) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0))
}

/**
 * Axis ticks at human numbers — 1, 2, 2.5, 5, 10 × a power of ten.
 *
 * Without this an axis reads 0, 137.4, 274.8… which is accurate and unreadable.
 * A report is for a person deciding something, not for a machine.
 */
function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0], min: 0, max: 1 }
  if (min === max) {
    if (min === 0) return { ticks: [0, 1], min: 0, max: 1 }
    const pad = Math.abs(min) * 0.5
    min -= pad
    max += pad
  }

  const rawStep = (max - min) / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)))
  const norm = rawStep / mag
  const stepMul = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = stepMul * mag

  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step

  const ticks = []
  // Small epsilon so floating point does not drop the final tick.
  for (let v = niceMin; v <= niceMax + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  }
  return { ticks, min: niceMin, max: niceMax, step }
}

/** Compact axis labels: 1.2k, 3.4M. Long axis numbers wreck a narrow chart. */
function formatAxis(v, unit = 'currency') {
  if (v == null || !Number.isFinite(v)) return ''
  if (unit === 'percent' || unit === 'ratio') return `${Math.round(v * 100)}%`
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}k`
  if (unit === 'count') return String(Math.round(v))
  return `${sign}${abs < 10 ? abs.toFixed(2) : Math.round(abs)}`
}

function trim(n) {
  const s = n.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Escape a value for inclusion in SVG text. Product names reach these labels. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = { linear, niceTicks, formatAxis, esc }
