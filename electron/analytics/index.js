const { getDb } = require('../database')
const registry = require('./kernel/registry')
const { AnalyticsContext } = require('./kernel/context')
const { Period } = require('./kernel/period')
const { Scope } = require('./kernel/scope')
const { resolveAll, resolveMetric } = require('./kernel/resolver')
const { lineage } = require('./kernel/provenance')
const { runPreflight } = require('./quality/preflight')
const { allCheckIds } = require('./quality/checks')
const { ENGINE_VERSION } = require('./version')

// Public face of the analytics engine.
//
// Everything above this line is internal; IPC, reports and tests come through
// here. Nothing in the renderer ever sees a metric definition, a Period object
// or a SQL fragment — only plain serialisable results.

require('./metrics')

// Structural validation once at load: unknown dependency ids, cycles, unknown
// bundles, unknown quality check ids. A wiring mistake becomes a startup
// failure rather than a report that quietly prints a wrong number.
registry.assertValid({ knownCheckIds: allCheckIds() })

/** Build a Period from a plain object sent over IPC. */
function toPeriod(spec) {
  if (!spec) return Period.day()
  if (spec instanceof Period) return spec
  switch (spec.type) {
    case 'day': return Period.day(spec.date)
    case 'week': return Period.week(spec.date)
    case 'month': return Period.month(spec.year, spec.month)
    case 'quarter': return Period.quarter(spec.year, spec.quarter)
    case 'year': return Period.year(spec.year)
    case 'monthOf': return Period.monthOf(spec.date)
    case 'range':
    default: return Period.range(spec.start, spec.end)
  }
}

function toScope(spec) {
  if (!spec) return Scope.all()
  if (spec instanceof Scope) return spec
  return new Scope(spec)
}

function makeContext(periodSpec, scopeSpec, opts = {}) {
  const ctx = new AnalyticsContext({
    db: getDb(),
    period: toPeriod(periodSpec),
    scope: toScope(scopeSpec),
    opts,
  })
  ctx.quality = runPreflight(ctx)
  return ctx
}

/** Serialise a Figure for IPC — drops nothing the renderer needs, adds nothing it doesn't. */
function serialiseFigure(fig, id) {
  return {
    id,
    value: fig.value,
    unit: fig.unit,
    unavailable: fig.unavailable,
    confidence: fig.provenance?.confidence ?? null,
    notes: fig.provenance?.notes || [],
    label: registry.hasMetric(id) ? registry.getMetric(id).label : id,
  }
}

/**
 * Compute a set of metrics.
 * @returns { period, scope, quality, metrics: { id: SerialisedFigure } }
 */
function computeMetrics(ids, periodSpec, scopeSpec, opts = {}) {
  const ctx = makeContext(periodSpec, scopeSpec, opts)
  const wanted = ids?.length ? ids : registry.allMetricIds()

  // Blocked metrics report as unavailable with the reason attached, never as 0.
  // Enforced inside the resolver so the block propagates to anything derived
  // from a blocked figure rather than only to directly-requested ones.
  const out = {}
  for (const id of wanted) {
    out[id] = serialiseFigure(resolveMetric(ctx, id), id)
  }

  return {
    engineVersion: ENGINE_VERSION,
    period: ctx.period.toJSON(),
    scope: ctx.scope.toJSON(),
    quality: ctx.quality.toJSON(),
    metrics: out,
  }
}

/**
 * Compute a metric alongside the same metric over the previous period and the
 * same period last year. This is the entire mechanism behind every "↑ 14%" on
 * the reports — no metric is comparison-aware.
 */
function compareMetrics(ids, periodSpec, scopeSpec, opts = {}) {
  const ctx = makeContext(periodSpec, scopeSpec, opts)
  const prevCtx = ctx.withPeriod(ctx.period.previous())
  const yoyCtx = ctx.withPeriod(ctx.period.priorYear())
  prevCtx.quality = runPreflight(prevCtx)
  yoyCtx.quality = runPreflight(yoyCtx)

  const { pctChange } = require('./kernel/money')
  const out = {}

  for (const id of ids) {
    const cur = resolveMetric(ctx, id)
    const prev = resolveMetric(prevCtx, id)
    const yoy = resolveMetric(yoyCtx, id)

    out[id] = {
      ...serialiseFigure(cur, id),
      previous: prev.value,
      priorYear: yoy.value,
      // null rather than Infinity when there is no baseline: a first month of
      // trading has not grown infinitely, the comparison simply does not exist.
      changeVsPrevious: pctChange(cur.value, prev.value),
      changeVsPriorYear: pctChange(cur.value, yoy.value),
      comparable: prev.unavailable == null && prev.value != null,
    }
  }

  return {
    engineVersion: ENGINE_VERSION,
    period: ctx.period.toJSON(),
    comparisonPeriod: prevCtx.period.toJSON(),
    priorYearPeriod: yoyCtx.period.toJSON(),
    scope: ctx.scope.toJSON(),
    quality: ctx.quality.toJSON(),
    metrics: out,
  }
}

/** The quality report on its own, for a persistent dashboard banner. */
function quality(periodSpec, scopeSpec, opts = {}) {
  const ctx = makeContext(periodSpec, scopeSpec, opts)
  return { period: ctx.period.toJSON(), ...ctx.quality.toJSON() }
}

/**
 * "Where did this number come from?" — the full dependency tree with each node's
 * value, the SQL that produced it and how many rows it touched.
 */
function explain(metricId, periodSpec, scopeSpec, opts = {}) {
  const ctx = makeContext(periodSpec, scopeSpec, { ...opts, explain: true })
  const bundle = resolveAll(ctx, [metricId])
  // Every figure the resolver touched, so the tree can be walked without re-running.
  const figures = {}
  for (const [key, val] of ctx.cache) {
    if (key.startsWith('bundle:')) continue
    const id = key.split('|')[0]
    if (val && typeof val === 'object' && 'unavailable' in val) figures[id] = val
  }
  return {
    metricId,
    period: ctx.period.toJSON(),
    scope: ctx.scope.toJSON(),
    lineage: lineage(metricId, figures),
    quality: ctx.quality.toJSON(),
    value: bundle.value(metricId),
  }
}

/**
 * A metric's value across the last N periods, plus its trend and next-period
 * forecast.
 *
 * The forecast is deliberately refused rather than fudged when there is too
 * little history — see metrics/trend.js.
 */
function trend(metricId, periodSpec, scopeSpec, opts = {}) {
  const ctx = makeContext(periodSpec, scopeSpec, opts)
  const { comparison, trend: trendFns } = require('./metrics')

  const count = opts.periods || 12
  const series = comparison.history(ctx, metricId, count)
  const points = series.map((s, i) => ({ x: s.label, y: s.value, i }))

  return {
    metricId,
    label: registry.hasMetric(metricId) ? registry.getMetric(metricId).label : metricId,
    period: ctx.period.toJSON(),
    scope: ctx.scope.toJSON(),
    series,
    trend: trendFns.linearTrend(points),
    forecast: trendFns.forecastNext(points, { confidence: opts.confidence || 0.8 }),
    quality: ctx.quality.toJSON(),
  }
}

// ── Reports ──────────────────────────────────────────────────────────────────

/**
 * Build a ReportDocument.
 *
 * The pipeline, in order, because the order is the design:
 *   preflight → metrics → insights → health → narrative → template → document
 *
 * Quality runs FIRST so that every downstream layer knows what it can and
 * cannot claim: metrics report blocked figures as unavailable, rules that need
 * confidence they do not have are skipped, and the narrator attaches the caveat
 * to the paragraph containing the figure it qualifies.
 */
function runReport(reportId, periodSpec, scopeSpec, opts = {}) {
  const { getTemplate } = require('./reportTemplates')
  const { runInsights, makeBundle } = require('./insights')
  const { businessHealth } = require('./insights/scoring/businessHealth')
  const { narrate } = require('./insights/narrative/templateNarrator')
  const { createDocument, assertValid } = require('./render/document')
  require('./insights/rules')

  const template = getTemplate(reportId)
  const ctx = makeContext(periodSpec, scopeSpec, opts)

  // Warm every metric the template declares in one pass, so the bundle handed
  // to rules and to the template is already resolved and shared.
  const bundle = makeBundle(ctx)
  for (const id of template.metrics || []) bundle.get(id)

  const { insights, skipped } = runInsights(ctx, { ruleIds: opts.ruleIds || null })
  const health = businessHealth(bundle, ctx)
  const narrative = narrate({ bundle, insights, health, ctx })

  const built = template.build({ bundle, insights, health, narrative, ctx })

  let shop = {}
  try { shop = require('../database/domains/shop').getShop() || {} } catch { shop = {} }

  const doc = createDocument({
    id: template.id,
    title: template.title,
    shop,
    period: ctx.period.toJSON(),
    comparisonPeriod: ctx.period.previous().toJSON(),
    scope: ctx.scope.toJSON(),
    quality: ctx.quality.toJSON(),
    sections: built.sections,
    insights,
    narrative,
    footnotes: built.footnotes || [],
    provenance: {
      tillCode: safeTillCode(),
      host: require('os').hostname(),
      costMode: ctx.costResolver.mode,
      health,
      skippedRules: skipped,
      // The full figure-level provenance is large and only needed when
      // someone asks "where did this come from", so it is fetched on demand
      // via analytics:explain rather than stored on every document.
      figureCount: ctx.cache.size,
    },
  })

  return assertValid(doc)
}

function safeTillCode() {
  try { return require('../database/tillPresence').getLocalTillCode() } catch { return null }
}

/** Report as a self-contained HTML string — preview, email, or print source. */
function renderReportHtml(reportId, periodSpec, scopeSpec, opts = {}) {
  const { toHtml } = require('./render/html/toHtml')
  const doc = opts.document || runReport(reportId, periodSpec, scopeSpec, opts)
  return toHtml(doc, { cover: opts.cover !== false, fragment: !!opts.fragment })
}

/** Report as a PDF buffer. Requires Electron; not available in plain Node. */
async function renderReportPdf(reportId, periodSpec, scopeSpec, opts = {}) {
  const { documentToPdf } = require('./render/pdf/toPdf')
  const doc = opts.document || runReport(reportId, periodSpec, scopeSpec, opts)
  const buffer = await documentToPdf(doc, opts)
  return { buffer, document: doc }
}

/**
 * Freeze a document so a reprint reproduces it exactly.
 *
 * Generalises what end_of_day.report_snapshot already does: a report that has
 * been printed and acted on must reprint identically forever, or a void entered
 * next week silently rewrites last month's figures.
 */
function saveReportSnapshot(doc, createdBy = 'System') {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO report_snapshots
         (report_id, period_start, period_end, granularity, scope_key, document_json,
          content_hash, engine_version, schema_version, quality_confidence, created_by)
       VALUES (@report_id, @period_start, @period_end, @granularity, @scope_key, @document_json,
               @content_hash, @engine_version, @schema_version, @quality_confidence, @created_by)`
    )
    .run({
      report_id: doc.id,
      period_start: doc.period.start,
      period_end: doc.period.end,
      granularity: doc.period.granularity || null,
      scope_key: JSON.stringify(doc.scope || {}),
      document_json: JSON.stringify(doc),
      content_hash: doc.contentHash,
      engine_version: doc.engineVersion,
      schema_version: doc.schemaVersion,
      quality_confidence: doc.quality?.confidence || null,
      created_by: createdBy,
    })
  return { id: info.lastInsertRowid, contentHash: doc.contentHash }
}

function listReportSnapshots({ reportId = null, limit = 50 } = {}) {
  const db = getDb()
  const where = reportId ? 'WHERE report_id = @reportId' : ''
  return db
    .prepare(
      `SELECT id, report_id, period_start, period_end, granularity, content_hash,
              engine_version, quality_confidence, created_by, created_at
         FROM report_snapshots ${where}
        ORDER BY created_at DESC LIMIT @limit`
    )
    .all({ reportId, limit })
}

/** Reprint reads the frozen document; it never recomputes. */
function getReportSnapshot(snapshotId) {
  const row = getDb().prepare('SELECT * FROM report_snapshots WHERE id = ?').get(snapshotId)
  if (!row) return null
  return { ...row, document: JSON.parse(row.document_json) }
}

/** Report as a workbook spec — the renderer turns this into an .xlsx file. */
function reportWorkbook(reportId, periodSpec, scopeSpec, opts = {}) {
  const { toWorkbook } = require('./render/xlsx/toWorkbook')
  const doc = opts.document || runReport(reportId, periodSpec, scopeSpec, opts)
  return toWorkbook(doc)
}

function listReports() {
  return require('./reportTemplates').listTemplates()
}

function listMetrics() {
  return registry.allMetrics().map((m) => ({
    id: m.id,
    label: m.label,
    unit: m.unit,
    grain: m.grain,
    derived: m.derived,
    dependsOn: m.dependsOn,
  }))
}

module.exports = {
  computeMetrics,
  compareMetrics,
  compare: compareMetrics,
  quality,
  explain,
  trend,
  listMetrics,
  runReport,
  renderReportHtml,
  renderReportPdf,
  reportWorkbook,
  saveReportSnapshot,
  listReportSnapshots,
  getReportSnapshot,
  listReports,
  ENGINE_VERSION,
  // exported for tests and future report templates
  makeContext,
  toPeriod,
  toScope,
}
