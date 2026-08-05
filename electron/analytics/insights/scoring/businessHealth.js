// Business health score.
//
// A single number an owner can watch month to month. The risk with any such
// score is that it becomes astrology — a number with no stated basis that
// nobody can argue with. Two things prevent that here:
//
//   1. Every threshold is in this exported config, reviewable and tunable
//      without touching logic.
//   2. A pillar whose inputs are unavailable scores NOTHING and is excluded
//      from the weighting, rather than scoring zero. A shop with no cost data
//      is not "0% profitable" — its profitability is unknown, and the score
//      says so by reporting how much of itself it could actually compute.

const PILLARS = {
  profitability: {
    label: 'Profitability',
    weight: 0.3,
    metrics: ['profit.grossMargin', 'profit.netMargin'],
    // Requires trustworthy cost data; scoring margin over guesswork would make
    // the headline number a guess too.
    minConfidence: 'medium',
    score(m) {
      const gross = m.value('profit.grossMargin')
      if (gross == null) return null
      // 15% gross is thin for retail, 40% is strong.
      const g = band(gross, 0.1, 0.4)
      const net = m.value('profit.netMargin')
      return net == null ? g : g * 0.6 + band(net, 0, 0.2) * 0.4
    },
  },

  cashDiscipline: {
    label: 'Cash discipline',
    weight: 0.2,
    metrics: ['cash.variance', 'sales.net'],
    score(m) {
      const variance = m.value('cash.variance')
      const net = m.value('sales.net')
      if (variance == null || !net) return null
      // Variance as a share of turnover: 0 is perfect, 1% is poor.
      const rate = Math.abs(variance) / net
      let s = band(0.01 - rate, 0, 0.01)
      const unverified = m.value('cash.unverifiedShiftCount') || 0
      const shifts = m.value('cash.shiftCount') || 0
      // A drawer nobody counted is not evidence of good discipline.
      if (shifts > 0) s *= 1 - Math.min(1, unverified / shifts) * 0.5
      return s
    },
  },

  inventoryEfficiency: {
    label: 'Inventory efficiency',
    weight: 0.2,
    metrics: ['inventory.valueAtCost'],
    score(m) {
      const total = m.value('inventory.valueAtCost')
      if (!total) return null
      const dead = m.value('inventory.deadStockValue') || 0
      const deadShare = dead / total
      let s = band(0.4 - deadShare, 0, 0.4) // 0% dead = 1, 40%+ dead = 0

      const turnover = m.value('inventory.turnover')
      if (turnover != null) s = s * 0.6 + band(turnover, 0, 2) * 0.4

      const out = m.value('inventory.outOfStockCount') || 0
      if (out > 0) s *= Math.max(0.6, 1 - out / 50)
      return s
    },
  },

  growth: {
    label: 'Growth',
    weight: 0.2,
    metrics: ['sales.net'],
    score(m) {
      const d = m.delta('sales.net')
      // No prior period is not bad growth — it is no information.
      if (!d.comparable || d.percentChange == null) return null
      // -10% scores 0, +20% scores 1, flat sits mid-band.
      return band(d.percentChange, -0.1, 0.2)
    },
  },

  operationalHygiene: {
    label: 'Operational hygiene',
    weight: 0.1,
    metrics: ['sales.transactionCount'],
    score(m, ctx) {
      let s = 1
      const net = m.value('sales.net')
      const voided = m.value('sales.voidedValue') || 0
      if (net) s -= Math.min(0.4, (voided / net) * 4)
      // Days that were never signed off in End of Day.
      const missing = ctx.quality?.byId?.['eod.missingDays']
      if (missing && !missing.passed) {
        s -= Math.min(0.4, (missing.count / Math.max(1, ctx.period.lengthDays())) * 0.8)
      }
      const negative = m.value('inventory.negativeStockCount') || 0
      if (negative > 0) s -= 0.2
      return Math.max(0, s)
    },
  },
}

/** Clamp v into [lo,hi] and map onto 0..1. */
function band(v, lo, hi) {
  if (v == null) return 0
  if (hi === lo) return 0
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 }

/**
 * @returns { score, grade, pillars, coverage, computable }
 *          score is null when nothing could be scored — never 0, which would
 *          read as "this business is failing" rather than "we cannot tell".
 */
function businessHealth(bundle, ctx) {
  const results = []
  let weighted = 0
  let weightUsed = 0

  for (const [key, p] of Object.entries(PILLARS)) {
    let value = null
    const confOk =
      !p.minConfidence ||
      CONFIDENCE_RANK[ctx.quality?.confidence ?? 'high'] >= CONFIDENCE_RANK[p.minConfidence]

    if (confOk) {
      try { value = p.score(bundle, ctx) } catch { value = null }
    }

    const unavailableReason = !confOk
      ? 'needs more reliable cost data'
      : value == null
        ? 'not enough data for this period'
        : null

    results.push({
      key,
      label: p.label,
      weight: p.weight,
      score: value == null ? null : Math.max(0, Math.min(1, value)),
      unavailable: unavailableReason,
    })

    if (value != null) {
      weighted += Math.max(0, Math.min(1, value)) * p.weight
      weightUsed += p.weight
    }
  }

  // Re-weighted across the pillars that could actually be scored, so an
  // unmeasurable pillar does not silently drag the headline down.
  const score = weightUsed > 0 ? weighted / weightUsed : null

  return {
    score,
    grade: grade(score),
    pillars: results,
    // How much of the score is real. A 92% built from 20% of the pillars is
    // not a 92%, and the report says which it is.
    coverage: weightUsed,
    computable: weightUsed > 0,
  }
}

function grade(score) {
  if (score == null) return 'Unknown'
  if (score >= 0.85) return 'Excellent'
  if (score >= 0.7) return 'Good'
  if (score >= 0.5) return 'Fair'
  if (score >= 0.3) return 'Weak'
  return 'Poor'
}

module.exports = { businessHealth, PILLARS, grade }
