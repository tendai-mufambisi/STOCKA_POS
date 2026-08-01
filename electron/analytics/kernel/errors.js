// Typed errors for the analytics engine.
//
// The engine's governing rule is that a figure it cannot compute reliably is
// reported as unavailable, with a reason — never as 0. A zero is a claim: it
// says "this happened, and the amount was nothing". These codes are how a
// metric says "I could not answer" in a way a report can render honestly and a
// caller can branch on without matching message strings.

const CODES = {
  /** The dimension exists in the schema but holds no usable data. */
  UNSUPPORTED_DIMENSION: 'UNSUPPORTED_DIMENSION',
  /** Not enough history to answer (e.g. opening stock before the ledger starts). */
  DATA_INSUFFICIENT: 'DATA_INSUFFICIENT',
  /** A required upstream metric was itself unavailable. */
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  /** Running against a data source known to be incomplete (satellite mirror). */
  SOURCE_NOT_AUTHORITATIVE: 'SOURCE_NOT_AUTHORITATIVE',
  /** Metric id not in the registry — a wiring bug, surfaced loudly. */
  UNKNOWN_METRIC: 'UNKNOWN_METRIC',
  /** Metric definitions form a cycle — a wiring bug, caught at startup. */
  CIRCULAR_DEPENDENCY: 'CIRCULAR_DEPENDENCY',
}

class AnalyticsError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AnalyticsError'
    this.code = code
    this.details = details
  }
}

function unsupportedDimension(dimension, reason) {
  return new AnalyticsError(
    CODES.UNSUPPORTED_DIMENSION,
    `Cannot report by ${dimension}: ${reason}`,
    { dimension }
  )
}

module.exports = { AnalyticsError, CODES, unsupportedDimension }
