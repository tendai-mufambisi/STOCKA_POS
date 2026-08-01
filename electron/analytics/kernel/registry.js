const { AnalyticsError, CODES } = require('./errors')
const { UNITS } = require('./figure')

// The metric registry.
//
// Every business number in Stocka is declared here exactly once. A metric is
// either a LEAF (it reads the database) or DERIVED (it is computed from other
// metrics and may not touch the database at all). That split is what stops
// gross profit from being re-derived, slightly differently, in five places.
//
// validate() runs at startup and in tests, so a typo in a dependency id is a
// boot failure rather than a report that quietly prints the wrong figure.

const metrics = new Map()
const bundles = new Map()

/**
 * @param def.id          'profit.gross' — stable, referenced by reports and insights
 * @param def.label       human label used by renderers
 * @param def.unit        currency | count | ratio | percent | days | text
 * @param def.grain       scalar | series | breakdown
 * @param def.dependsOn   [metricId] — presence makes this metric DERIVED
 * @param def.quality     [checkId] — checks that reduce this metric's confidence
 * @param def.bundle      bundleId — share one SQL pass with sibling leaves
 * @param def.sql(ctx)    leaf only → { text, params }
 * @param def.reduce(rows, ctx)  leaf only → value
 * @param def.pick(row, ctx)     bundled leaf only → value
 * @param def.compute(ctx, deps) derived only → value. MUST be pure.
 */
function defineMetric(def) {
  if (!def || !def.id) throw new Error('defineMetric: id is required')
  if (metrics.has(def.id)) throw new Error(`defineMetric: duplicate metric id '${def.id}'`)
  if (def.unit && !UNITS.includes(def.unit)) {
    throw new Error(`defineMetric('${def.id}'): unknown unit '${def.unit}'`)
  }

  const derived = Array.isArray(def.dependsOn) && def.dependsOn.length > 0
  if (derived && !def.compute) {
    throw new Error(`defineMetric('${def.id}'): declares dependsOn but has no compute()`)
  }
  if (!derived && !def.sql && !def.bundle) {
    throw new Error(`defineMetric('${def.id}'): a leaf metric needs sql() or bundle`)
  }
  if (def.bundle && !def.pick) {
    throw new Error(`defineMetric('${def.id}'): bundled metric needs pick(row, ctx)`)
  }

  metrics.set(def.id, {
    grain: 'scalar',
    dependsOn: [],
    quality: [],
    ...def,
    derived,
  })
  return def.id
}

/**
 * A set of leaf metrics that share one SQL pass.
 *
 * Without this, a report asking for 40 figures over the same period issues 40
 * scans of `sales`. With it, one SELECT computes the lot and each metric picks
 * its column.
 */
function defineBundle(def) {
  if (!def || !def.id) throw new Error('defineBundle: id is required')
  if (bundles.has(def.id)) throw new Error(`defineBundle: duplicate bundle id '${def.id}'`)
  if (!def.sql) throw new Error(`defineBundle('${def.id}'): sql(ctx) is required`)
  bundles.set(def.id, def)
  return def.id
}

function getMetric(id) {
  const m = metrics.get(id)
  if (!m) throw new AnalyticsError(CODES.UNKNOWN_METRIC, `No metric registered as '${id}'`, { id })
  return m
}

function getBundle(id) {
  const b = bundles.get(id)
  if (!b) throw new Error(`No bundle registered as '${id}'`)
  return b
}

const hasMetric = (id) => metrics.has(id)
const allMetricIds = () => [...metrics.keys()].sort()
const allMetrics = () => [...metrics.values()]

/**
 * Structural validation of the whole registry: unknown dependencies, cycles,
 * unknown bundles, unknown quality check ids.
 *
 * Returns a list of problems rather than throwing on the first, so a wiring
 * mistake shows all of its consequences at once.
 */
function validate({ knownCheckIds = null } = {}) {
  const problems = []

  for (const m of metrics.values()) {
    for (const dep of m.dependsOn) {
      if (!metrics.has(dep)) problems.push(`${m.id}: depends on unknown metric '${dep}'`)
    }
    if (m.bundle && !bundles.has(m.bundle)) {
      problems.push(`${m.id}: references unknown bundle '${m.bundle}'`)
    }
    if (knownCheckIds) {
      for (const q of m.quality) {
        if (!knownCheckIds.includes(q)) problems.push(`${m.id}: references unknown quality check '${q}'`)
      }
    }
  }

  // Cycle detection — a cycle would otherwise recurse until the stack gives out,
  // during a report run, in front of a user.
  const WHITE = 0, GREY = 1, BLACK = 2
  const colour = new Map([...metrics.keys()].map((id) => [id, WHITE]))
  const stack = []

  function visit(id) {
    if (!metrics.has(id)) return
    if (colour.get(id) === BLACK) return
    if (colour.get(id) === GREY) {
      problems.push(`circular dependency: ${[...stack, id].join(' → ')}`)
      return
    }
    colour.set(id, GREY)
    stack.push(id)
    for (const dep of metrics.get(id).dependsOn) visit(dep)
    stack.pop()
    colour.set(id, BLACK)
  }

  for (const id of metrics.keys()) visit(id)
  return problems
}

/** Throws if the registry is inconsistent. Called once at startup. */
function assertValid(opts) {
  const problems = validate(opts)
  if (problems.length) {
    throw new AnalyticsError(
      CODES.CIRCULAR_DEPENDENCY,
      `Metric registry is invalid:\n  ${problems.join('\n  ')}`,
      { problems }
    )
  }
}

/** Test-only: wipe the registry so a suite can register in isolation. */
function _reset() {
  metrics.clear()
  bundles.clear()
}

module.exports = {
  defineMetric,
  defineBundle,
  getMetric,
  getBundle,
  hasMetric,
  allMetricIds,
  allMetrics,
  validate,
  assertValid,
  _reset,
}
