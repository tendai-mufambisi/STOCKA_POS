const { isAvailable } = require('../../kernel/figure')

// Section builders.
//
// Templates describe WHAT a report says; these turn that into the document's
// data shapes. No formatting decisions live here — no currency symbols, no
// colours, no widths. A renderer decides how a `currency` value looks; this
// layer only says that it is one.
//
// The rule that runs through all of them: a figure the engine could not compute
// is passed through as null with its reason attached, never as 0. Renderers
// print an em dash. A zero would be a claim.

/** A headline figure, optionally with its comparison. */
function kpi(bundle, metricId, { label, delta = null, hint = null } = {}) {
  const fig = bundle.get(metricId)
  return {
    metricId,
    label: label || bundle.ctx?.labelFor?.(metricId) || metricId,
    value: isAvailable(fig) ? fig.value : null,
    unit: fig?.unit || null,
    unavailable: fig?.unavailable || null,
    confidence: fig?.provenance?.confidence ?? null,
    notes: fig?.provenance?.notes || [],
    delta,
    hint,
  }
}

function kpiGrid(items, { title = null, columns = 4 } = {}) {
  return { type: 'kpiGrid', title, columns, items: items.filter(Boolean) }
}

/**
 * @param columns [{ key, label, unit, align }]
 * @param rows    plain objects keyed by column key
 */
function table(columns, rows, { title = null, totals = null, note = null, emptyMessage = null } = {}) {
  return {
    type: 'table',
    title,
    columns,
    rows: rows || [],
    totals,
    note,
    emptyMessage: emptyMessage || 'Nothing to show for this period.',
  }
}

/**
 * A chart carries the raw series AND (optionally) pre-rendered SVG.
 *
 * That dual payload is what lets one document serve five outputs: the PDF and
 * the emailed HTML print the SVG, while the React dashboard binds recharts to
 * the same series. Neither recomputes anything.
 */
function chart(kind, series, { title = null, svg = null, axes = {}, note = null } = {}) {
  return { type: 'chart', chart: kind, title, series, svg, axes, note }
}

function narrative(blocks, { title = null } = {}) {
  return { type: 'narrative', title, blocks }
}

function paragraph(text) {
  return { kind: 'p', text }
}

function bullets(items) {
  return { kind: 'bullets', items }
}

function keyValue(items, { title = null } = {}) {
  return { type: 'keyValue', title, items: items.filter(Boolean) }
}

function insightList(insightIds, { title = null, emptyMessage = null } = {}) {
  return {
    type: 'insightList',
    title,
    insightIds,
    emptyMessage: emptyMessage || 'Nothing needs your attention this period.',
  }
}

/**
 * A running financial statement — label, value, and whether the line is a
 * subtotal, a deduction, or the bottom line. Kept as its own type because a
 * profit statement reads as arithmetic, not as a table of unrelated rows.
 */
function statement(lines, { title = null, note = null } = {}) {
  return { type: 'statement', title, lines: lines.filter(Boolean), note }
}

function line(label, value, { kind = 'item', unit = 'currency', unavailable = null, hint = null } = {}) {
  return { label, value, kind, unit, unavailable, hint }
}

/** A statement line taken straight from a metric, carrying its unavailability. */
function metricLine(bundle, metricId, label, { kind = 'item' } = {}) {
  const fig = bundle.get(metricId)
  return line(label, isAvailable(fig) ? fig.value : null, {
    kind,
    unit: fig?.unit || 'currency',
    unavailable: fig?.unavailable || null,
  })
}

const divider = () => ({ type: 'divider' })
const pageBreak = () => ({ type: 'pageBreak' })

module.exports = {
  kpi,
  kpiGrid,
  table,
  chart,
  narrative,
  paragraph,
  bullets,
  keyValue,
  insightList,
  statement,
  line,
  metricLine,
  divider,
  pageBreak,
}
