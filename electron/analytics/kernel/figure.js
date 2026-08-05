const { CODES } = require('./errors')

// Every metric returns a Figure — never a bare number.
//
// The bare number is what makes reports untrustworthy. `18450` on a page cannot
// tell you whether it is complete, which rows it came from, or whether three of
// them had no cost price. A Figure carries that with it, so the report can print
// a confidence note and `analytics:explain` can answer "where did this come
// from?" without re-deriving anything.
//
// A Figure is either available (value set, unavailable null) or not (value null,
// unavailable set). Never both, and never a value of 0 standing in for "unknown"
// — that is the distinction the whole engine exists to preserve.

const UNITS = ['currency', 'count', 'ratio', 'percent', 'days', 'text']

function figure(value, unit, provenance) {
  return Object.freeze({
    value,
    unit,
    unavailable: null,
    provenance: provenance || null,
  })
}

/**
 * A figure that could not be computed. Renders as '—' with the reason attached;
 * a caller that treats this as 0 is a bug the report will show.
 */
function unavailable(code, reason, provenance) {
  return Object.freeze({
    value: null,
    unit: provenance?.unit || null,
    unavailable: Object.freeze({ code, reason }),
    provenance: provenance || null,
  })
}

/** A figure that failed because something it depends on failed. */
function dependencyUnavailable(metricId, failedDep, provenance) {
  return unavailable(
    CODES.DEPENDENCY_UNAVAILABLE,
    `${metricId} needs ${failedDep}, which is unavailable`,
    provenance
  )
}

function isAvailable(fig) {
  return !!fig && fig.unavailable == null && fig.value != null
}

/** Numeric value, or null. Deliberately never coerces an unavailable figure to 0. */
function valueOf(fig) {
  return isAvailable(fig) ? fig.value : null
}

module.exports = { figure, unavailable, dependencyUnavailable, isAvailable, valueOf, UNITS }
