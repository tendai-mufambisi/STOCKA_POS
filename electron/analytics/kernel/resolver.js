const registry = require('./registry')
const { figure, unavailable, dependencyUnavailable, isAvailable, valueOf } = require('./figure')
const { buildProvenance } = require('./provenance')
const { AnalyticsError, CODES } = require('./errors')

// Evaluates metrics, memoised, in dependency order.
//
// The contract that makes the engine trustworthy: a derived metric NEVER issues
// SQL. It receives its dependencies as already-resolved Figures and combines
// them. So `profit.gross` is literally `sales.net − cogs.total` — if either
// changes, gross profit changes with it, and there is no second definition to
// forget to update.

/** Resolve one metric id to a Figure, memoised on the context. */
function resolveMetric(ctx, id, seen = new Set()) {
  const key = ctx.cacheKey(id)
  if (ctx.cache.has(key)) return ctx.cache.get(key)

  // Registry validation already rules cycles out; this catches a metric added at
  // runtime and stops the recursion with a named error rather than a stack blowout.
  if (seen.has(id)) {
    throw new AnalyticsError(CODES.CIRCULAR_DEPENDENCY, `Circular dependency at '${id}'`, { id })
  }
  seen.add(id)

  const def = registry.getMetric(id)
  let result

  try {
    result = def.derived ? evaluateDerived(ctx, def, seen) : evaluateLeaf(ctx, def)
  } catch (err) {
    if (err instanceof AnalyticsError) throw err
    // A metric that blows up must not take the whole report with it — the rest
    // of the page is still worth printing. It reports as unavailable, loudly.
    result = unavailable(
      CODES.DATA_INSUFFICIENT,
      `${id} failed: ${err.message}`,
      buildProvenance({ metricId: id, unit: def.unit, period: ctx.period, scope: ctx.scope })
    )
  }

  seen.delete(id)
  ctx.cache.set(key, result)
  return result
}

function evaluateDerived(ctx, def, seen) {
  const deps = {}
  for (const depId of def.dependsOn) {
    const depFig = resolveMetric(ctx, depId, seen)
    // Propagate unavailability rather than substituting 0. A margin computed
    // from an unavailable COGS is not a margin, it is a fabrication.
    if (!isAvailable(depFig)) {
      return dependencyUnavailable(
        def.id,
        depId,
        buildProvenance({
          metricId: def.id,
          unit: def.unit,
          period: ctx.period,
          scope: ctx.scope,
          derivedFrom: def.dependsOn,
        })
      )
    }
    deps[depId] = depFig
  }

  const value = def.compute(ctx, deps)
  const confidence = Math.min(
    1,
    ...def.dependsOn.map((d) => ctx.cache.get(ctx.cacheKey(d))?.provenance?.confidence ?? 1)
  )

  if (value == null) {
    return unavailable(
      CODES.DATA_INSUFFICIENT,
      `${def.id} has no value for this period`,
      buildProvenance({
        metricId: def.id, unit: def.unit, period: ctx.period, scope: ctx.scope,
        derivedFrom: def.dependsOn, confidence,
      })
    )
  }

  return figure(
    value,
    def.unit,
    buildProvenance({
      metricId: def.id,
      unit: def.unit,
      period: ctx.period,
      scope: ctx.scope,
      derivedFrom: def.dependsOn,
      notes: notesFor(ctx, def),
      confidence,
    })
  )
}

function evaluateLeaf(ctx, def) {
  let value
  let sqlText = null
  let rowsScanned = 0
  const sources = []

  if (def.bundle) {
    const row = resolveBundle(ctx, def.bundle)
    value = def.pick(row, ctx)
    sources.push({ table: def.sourceTable || 'sales', via: `bundle:${def.bundle}` })
  } else {
    const sql = def.sql(ctx)
    sqlText = sql.text
    const rows = ctx.query(sql)
    rowsScanned = rows.length
    value = def.reduce ? def.reduce(rows, ctx) : rows
    sources.push({
      table: def.sourceTable || 'sales',
      rowsScanned,
      filter: def.sourceFilter || "status = 'completed'",
    })
  }

  const confidence = confidenceFor(ctx, def)

  if (value == null) {
    return unavailable(
      CODES.DATA_INSUFFICIENT,
      `${def.id} has no value for this period`,
      buildProvenance({
        metricId: def.id, unit: def.unit, period: ctx.period, scope: ctx.scope,
        sources, sql: ctx.explain ? sqlText : null, confidence,
      })
    )
  }

  return figure(
    value,
    def.unit,
    buildProvenance({
      metricId: def.id,
      unit: def.unit,
      period: ctx.period,
      scope: ctx.scope,
      sources,
      sql: ctx.explain ? sqlText : null,
      notes: notesFor(ctx, def),
      confidence,
    })
  )
}

/** One SQL pass shared by every metric that declared this bundle. */
function resolveBundle(ctx, bundleId) {
  const key = `bundle:${bundleId}|${ctx.period.key}|${ctx.scope.key}`
  if (ctx.cache.has(key)) return ctx.cache.get(key)
  const bundle = registry.getBundle(bundleId)
  const row = ctx.queryOne(bundle.sql(ctx))
  ctx.cache.set(key, row)
  return row
}

// Confidence comes from the preflight: a metric declares which checks affect it,
// and each failing check reduces confidence in proportion to its measured
// exposure rather than by a flat constant. A single $2 line item with no cost
// should not drag a $40,000 month down as hard as a $12,000 one.
function confidenceFor(ctx, def) {
  if (!ctx.quality || !def.quality?.length) return 1
  let c = 1
  for (const checkId of def.quality) {
    const check = ctx.quality.byId?.[checkId]
    if (check && !check.passed) c -= check.weight ?? 0.05
  }
  return Math.max(0, Math.min(1, c))
}

function notesFor(ctx, def) {
  if (!ctx.quality || !def.quality?.length) return []
  return def.quality
    .map((id) => ctx.quality.byId?.[id])
    .filter((c) => c && !c.passed)
    .map((c) => c.message)
}

/**
 * Resolve many metrics into a bundle with a small read API.
 *
 * Insight rules receive this and never the database — which is how a rule is
 * guaranteed not to become a second implementation of a metric.
 */
function resolveAll(ctx, ids) {
  const figures = {}
  for (const id of ids) figures[id] = resolveMetric(ctx, id)

  return {
    ids,
    figures,
    ctx,
    get: (id) => figures[id],
    value: (id) => valueOf(figures[id]),
    has: (id) => isAvailable(figures[id]),
    confidenceOf: (id) => figures[id]?.provenance?.confidence ?? null,
    unavailable: () => ids.filter((id) => !isAvailable(figures[id])),
  }
}

module.exports = { resolveMetric, resolveAll, resolveBundle }
