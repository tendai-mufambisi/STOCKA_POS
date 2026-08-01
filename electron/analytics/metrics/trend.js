// Trend and forecast.
//
// Two rules govern everything here, and both exist because a forecast is the
// easiest place in a business report to be confidently wrong:
//
//   1. Never forecast from too little history. Two weeks of data cannot tell
//      you what next month looks like, and a number produced from it will be
//      acted on anyway because it appears on a page next to real figures.
//
//   2. Never publish a point forecast without an interval. "You will sell $840
//      of cooking oil" is a guess wearing a suit. "$700–$980, based on 9 weeks"
//      is a forecast, and it lets the owner decide how much to lean on it.

const MIN_POINTS_FOR_TREND = 4
const MIN_POINTS_FOR_FORECAST = 8

/** Simple moving average over a series of {x, y}. */
function movingAverage(points, window = 7) {
  if (!points?.length) return []
  return points.map((p, i) => {
    const from = Math.max(0, i - window + 1)
    const slice = points.slice(from, i + 1)
    const sum = slice.reduce((n, q) => n + (q.y || 0), 0)
    return { x: p.x, y: sum / slice.length }
  })
}

/**
 * Least-squares line through a series.
 * Returns null rather than a meaningless slope when there is too little data.
 */
function linearTrend(points) {
  const usable = (points || []).filter((p) => p.y != null)
  if (usable.length < MIN_POINTS_FOR_TREND) {
    return { available: false, reason: `needs at least ${MIN_POINTS_FOR_TREND} points, has ${usable.length}` }
  }

  const n = usable.length
  const xs = usable.map((_, i) => i)
  const ys = usable.map((p) => p.y)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  if (den === 0) return { available: false, reason: 'no variation in the period axis' }

  const slope = num / den
  const intercept = meanY - slope * meanX

  // R² — how much of the movement the line actually explains. Reported so a
  // near-random series cannot be presented as a trend.
  const ssTot = ys.reduce((n2, y) => n2 + (y - meanY) ** 2, 0)
  const ssRes = ys.reduce((n2, y, i) => n2 + (y - (intercept + slope * xs[i])) ** 2, 0)
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  return {
    available: true,
    slope,
    intercept,
    r2,
    // Per-period change as a share of the average, which is what a reader means
    // by "growing 6% a month".
    percentPerPeriod: meanY !== 0 ? slope / Math.abs(meanY) : null,
    direction: slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat',
    strength: r2 >= 0.7 ? 'strong' : r2 >= 0.4 ? 'moderate' : 'weak',
    points: usable.length,
  }
}

/**
 * Forecast the next period from history, with a prediction interval.
 *
 * Seasonal-naive plus drift: the level comes from the recent mean, the
 * direction from the fitted trend, and the interval from the residual spread.
 * Deliberately simple — an ARIMA on 9 monthly points would be false precision.
 */
function forecastNext(points, { confidence = 0.8 } = {}) {
  const usable = (points || []).filter((p) => p.y != null)
  if (usable.length < MIN_POINTS_FOR_FORECAST) {
    return {
      available: false,
      reason: `Not enough history to forecast — needs ${MIN_POINTS_FOR_FORECAST} periods, has ${usable.length}.`,
      pointsAvailable: usable.length,
      pointsNeeded: MIN_POINTS_FOR_FORECAST,
    }
  }

  const trend = linearTrend(usable)
  const n = usable.length
  const ys = usable.map((p) => p.y)

  const predicted = trend.available ? trend.intercept + trend.slope * n : ys.reduce((a, b) => a + b, 0) / n

  // Residual standard deviation around the fit, which is the honest measure of
  // how wrong this has been on the data we have.
  const residuals = ys.map((y, i) =>
    trend.available ? y - (trend.intercept + trend.slope * i) : y - predicted
  )
  const variance = residuals.reduce((a, r) => a + r * r, 0) / Math.max(1, n - 2)
  const sd = Math.sqrt(variance)

  // z for 80% / 90% / 95%. Normal approximation is adequate at this sample size
  // and far more honest than presenting a bare point estimate.
  const z = confidence >= 0.95 ? 1.96 : confidence >= 0.9 ? 1.645 : 1.282
  const margin = z * sd

  return {
    available: true,
    value: Math.max(0, predicted),
    low: Math.max(0, predicted - margin),
    high: predicted + margin,
    confidence,
    basedOnPeriods: n,
    trendStrength: trend.available ? trend.strength : 'unknown',
    // A wide interval relative to the value is a warning in its own right.
    reliability: predicted !== 0 && margin / Math.abs(predicted) < 0.25 ? 'usable' : 'indicative',
  }
}

/**
 * Days until stock runs out at the recent rate of sale.
 * The basis for "reorder Milk within 2 days" recommendations.
 */
function daysUntilStockout(currentQty, unitsSoldPerDay) {
  if (!unitsSoldPerDay || unitsSoldPerDay <= 0) return null
  if (currentQty == null) return null
  return currentQty / unitsSoldPerDay
}

module.exports = {
  movingAverage,
  linearTrend,
  forecastNext,
  daysUntilStockout,
  MIN_POINTS_FOR_TREND,
  MIN_POINTS_FOR_FORECAST,
}
