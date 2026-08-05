const { ENGINE_VERSION } = require('../version')

// Provenance answers the accountant's question: where did this number come from?
//
// An accountant does not ask "how do I display this" — they ask which rows were
// counted, which were excluded and why, and what was assumed. If the engine
// cannot answer that, the PDF is just a nicer-looking guess.
//
// Captured per figure and rolled up into the ReportDocument, so a printed report
// remains auditable long after the screen that produced it is gone.

function buildProvenance({
  metricId,
  unit,
  period,
  scope,
  sources = [],
  derivedFrom = [],
  sql = null,
  notes = [],
  confidence = 1,
}) {
  return {
    metricId,
    unit,
    engineVersion: ENGINE_VERSION,
    computedAt: new Date().toISOString(),
    period: period ? { start: period.start, end: period.end, key: period.key } : null,
    scope: scope ? { key: scope.key, label: scope.label } : null,
    // Which tables were read, with the filter applied and how many rows matched.
    sources,
    // Which other metrics fed this one. Empty for a leaf.
    derivedFrom,
    // Retained only when opts.explain is set — SQL text on every figure of every
    // report would bloat a stored document for no routine benefit.
    sql,
    notes,
    confidence,
  }
}

/**
 * Walk a figure's dependencies into a tree for `analytics:explain`.
 * Depth-limited because a cycle would already have failed registry validation,
 * but a defensive bound costs nothing and beats a stack overflow in a report.
 */
function lineage(metricId, figures, depth = 0) {
  const fig = figures[metricId]
  if (!fig || depth > 12) return null
  const p = fig.provenance || {}
  return {
    metricId,
    value: fig.value,
    unit: fig.unit,
    unavailable: fig.unavailable,
    confidence: p.confidence,
    sources: p.sources || [],
    sql: p.sql || null,
    notes: p.notes || [],
    derivedFrom: (p.derivedFrom || [])
      .map((d) => lineage(d, figures, depth + 1))
      .filter(Boolean),
  }
}

module.exports = { buildProvenance, lineage }
