const { Period } = require('./period')
const { Scope } = require('./scope')
const { costResolverFor } = require('../sql/costResolver')

// Everything a metric needs, and nothing it should reach for itself.
//
// Metrics receive the connection here rather than calling getDb(), which is what
// lets the same metric run against a test database, a past period, or a
// different scope without knowing it. The layering guard enforces it.
//
// The cache is per-run and mandatory. It is not a performance nicety: it is what
// makes composition safe. `profit.gross` and `profit.grossMargin` both depend on
// `sales.net`, and without memoisation that is two queries returning two
// separately-rounded numbers that can disagree in the last cent.

class AnalyticsContext {
  constructor({ db, period, scope, opts = {} }) {
    if (!db) throw new Error('AnalyticsContext: db is required')
    this.db = db
    this.period = period || Period.day()
    this.scope = scope || Scope.all()
    this.opts = opts

    this.cache = new Map()
    // Notes raised while computing, folded into the figures that caused them.
    this.notes = []
    // Cost resolution is fixed for the whole run: as at the period end, so a
    // report of last month values last month's stock at last month's cost.
    this.costResolver = costResolverFor(db, {
      asOf: opts.costAsOf === undefined ? this.period.end : opts.costAsOf,
      mode: opts.costMode || 'business',
    })
    this.quality = null // set by the preflight before metrics run
  }

  /** A context over a different period, same everything else. Used by comparisons. */
  withPeriod(period) {
    return new AnalyticsContext({ db: this.db, period, scope: this.scope, opts: this.opts })
  }

  withScope(scope) {
    return new AnalyticsContext({ db: this.db, period: this.period, scope, opts: this.opts })
  }

  cacheKey(metricId) {
    return `${metricId}|${this.period.key}|${this.scope.key}`
  }

  /** Run a { text, params } query and record how many rows it touched. */
  query(sql) {
    const stmt = this.db.prepare(sql.text)
    return stmt.all(sql.params || {})
  }

  queryOne(sql) {
    return this.db.prepare(sql.text).get(sql.params || {}) || {}
  }

  get explain() {
    return !!this.opts.explain
  }
}

module.exports = { AnalyticsContext }
