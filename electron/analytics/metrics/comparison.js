const { resolveMetric } = require('../kernel/resolver')
const { isAvailable } = require('../kernel/figure')
const { pctChange } = require('../kernel/money')

// Comparison.
//
// The trick that makes every "↑ 14% vs last month" free: re-run the SAME metric
// against a shifted Period. Not a parallel implementation, not a stored
// previous value — literally the same definition evaluated over different dates.
//
// So a comparison can never drift from the headline it sits next to, and no
// metric anywhere needs to know that comparison exists.

/**
 * Compare a metric against another period.
 *
 * @param ctx     the current context
 * @param metricId
 * @param shift   'previous' | 'priorYear'
 */
function delta(ctx, metricId, shift = 'previous') {
  const current = resolveMetric(ctx, metricId)
  const otherPeriod = shift === 'priorYear' ? ctx.period.priorYear() : ctx.period.previous()
  const otherCtx = ctx.withPeriod(otherPeriod)
  // The comparison period inherits the current run's quality report rather than
  // re-running the preflight: the checks describe the data, and re-running them
  // for every comparison would triple the cost of a report for no new insight.
  otherCtx.quality = ctx.quality
  const previous = resolveMetric(otherCtx, metricId)

  const comparable = isAvailable(current) && isAvailable(previous)
  const change = comparable ? pctChange(current.value, previous.value) : null

  return {
    metricId,
    current: current.value,
    previous: previous.value,
    period: ctx.period.toJSON(),
    comparisonPeriod: otherPeriod.toJSON(),
    absoluteChange: comparable ? current.value - previous.value : null,
    // null, not Infinity: a first month of trading has not grown infinitely,
    // the comparison simply does not exist yet.
    percentChange: change,
    direction: change == null ? 'unknown' : change > 0.001 ? 'up' : change < -0.001 ? 'down' : 'flat',
    // False when the prior period predates the data. The report says
    // "no comparison available" rather than inventing a baseline.
    comparable,
  }
}

/**
 * A metric's value across each of the last N periods of the same granularity,
 * oldest first. The input to trend and forecast.
 */
function history(ctx, metricId, count = 12) {
  const out = []
  let period = ctx.period
  for (let i = 0; i < count; i++) {
    const c = ctx.withPeriod(period)
    c.quality = ctx.quality
    const fig = resolveMetric(c, metricId)
    out.unshift({
      period: period.toJSON(),
      label: period.label(),
      value: isAvailable(fig) ? fig.value : null,
    })
    period = period.previous()
  }
  return out
}

module.exports = { delta, history }
