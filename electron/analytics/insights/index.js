const { delta } = require('../metrics/comparison')
const { resolveMetric } = require('../kernel/resolver')
const { isAvailable } = require('../kernel/figure')

// The insights engine.
//
// A rule turns figures into a sentence a shop owner can act on. The contract
// that keeps it honest: a rule receives a resolved MetricBundle and NEVER the
// database. It cannot issue SQL, so it cannot become a second, slightly
// different implementation of a metric it happens to need.
//
// That also makes every rule a pure unit test: feed it values, assert the
// insight. No fixtures, no database.
//
// Severity is about what the reader should do, not how bad it sounds:
//   critical    — money is being lost now
//   warning     — a trend that will cost money if ignored
//   opportunity — money available for the taking
//   info        — worth knowing, no action implied

const rules = new Map()

function defineRule(def) {
  if (rules.has(def.id)) throw new Error(`defineRule: duplicate rule id '${def.id}'`)
  rules.set(def.id, {
    minConfidence: 'low',
    appliesTo: {},
    ...def,
  })
  return def.id
}

const allRules = () => [...rules.values()]
const allRuleIds = () => [...rules.keys()]

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 }

/**
 * The read API a rule sees. Deliberately narrow — value, comparison,
 * confidence. No connection, no period arithmetic, no query builder.
 */
function makeBundle(ctx) {
  const cache = new Map()
  const get = (id) => {
    if (!cache.has(id)) cache.set(id, resolveMetric(ctx, id))
    return cache.get(id)
  }
  return {
    ctx,
    period: ctx.period,
    get,
    value: (id) => (isAvailable(get(id)) ? get(id).value : null),
    has: (id) => isAvailable(get(id)),
    confidenceOf: (id) => get(id)?.provenance?.confidence ?? null,
    delta: (id, shift = 'previous') => delta(ctx, id, shift),
  }
}

/**
 * Run every applicable rule.
 *
 * A rule is skipped — not failed — when the period is the wrong granularity,
 * a required metric is unavailable, or the data is not confident enough to
 * support the claim. An insight asserted over data the engine has just flagged
 * as unreliable is worse than no insight: it launders a caveat into advice.
 */
function runInsights(ctx, { ruleIds = null } = {}) {
  const bundle = makeBundle(ctx)
  const quality = ctx.quality
  const out = []
  const skipped = []

  const chosen = ruleIds ? allRules().filter((r) => ruleIds.includes(r.id)) : allRules()

  for (const rule of chosen) {
    const a = rule.appliesTo || {}

    if (a.granularities && !a.granularities.includes(ctx.period.granularity)) {
      skipped.push({ id: rule.id, reason: 'granularity' })
      continue
    }
    if (a.requires && !a.requires.every((m) => bundle.has(m))) {
      skipped.push({ id: rule.id, reason: 'metric unavailable' })
      continue
    }
    if (quality && CONFIDENCE_RANK[quality.confidence] < CONFIDENCE_RANK[rule.minConfidence]) {
      skipped.push({ id: rule.id, reason: `needs ${rule.minConfidence} confidence` })
      continue
    }

    let result
    try {
      result = rule.evaluate(bundle, ctx)
    } catch (err) {
      // One broken rule must not take the report down; the rest of the page is
      // still worth printing.
      skipped.push({ id: rule.id, reason: `error: ${err.message}` })
      continue
    }
    if (!result) continue

    for (const ins of [].concat(result)) {
      out.push({
        id: ins.id || rule.id,
        ruleId: rule.id,
        severity: ins.severity || 'info',
        title: ins.title,
        body: ins.body || null,
        evidence: ins.evidence || [],
        recommendedAction: ins.recommendedAction || null,
        confidence: ins.confidence ?? null,
        tags: ins.tags || [],
      })
    }
  }

  const ORDER = { critical: 0, warning: 1, opportunity: 2, info: 3 }
  out.sort((x, y) => (ORDER[x.severity] ?? 9) - (ORDER[y.severity] ?? 9))
  return { insights: out, skipped }
}

/** Test-only. */
function _reset() { rules.clear() }

module.exports = { defineRule, runInsights, makeBundle, allRules, allRuleIds, _reset }
