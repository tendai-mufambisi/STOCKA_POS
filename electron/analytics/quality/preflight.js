const { allChecks } = require('./checks')

// Runs every check before metrics are computed, and produces the QualityReport
// that gates the whole run.
//
// Confidence is deliberately NOT a vibe. It starts at 1.0 and each failing
// warning subtracts its measured exposure — so the number means something
// specific: roughly the share of the report's value that rests on data the
// engine can vouch for.

const THRESHOLDS = { high: 0.98, medium: 0.9 }

function runPreflight(ctx) {
  const results = []
  const byId = {}

  for (const check of allChecks()) {
    let outcome
    try {
      outcome = check.run(ctx)
    } catch (err) {
      // A check that cannot run is itself a quality signal — never a silent pass.
      outcome = {
        passed: false,
        count: 0,
        exposure: 0,
        weight: 0.05,
        message: `Data-quality check '${check.id}' could not run: ${err.message}`,
      }
    }

    const entry = {
      id: check.id,
      label: check.label,
      severity: check.severity,
      affects: check.affects,
      passed: !!outcome.passed,
      count: outcome.count || 0,
      exposure: outcome.exposure || 0,
      weight: outcome.weight || 0,
      message: outcome.message || null,
      detail: outcome.detail || null,
      drill: outcome.drill || null,
    }
    results.push(entry)
    byId[check.id] = entry
  }

  const failed = results.filter((r) => !r.passed)
  const blockers = failed.filter((r) => r.severity === 'blocker')
  const warnings = failed.filter((r) => r.severity === 'warning')
  const infos = failed.filter((r) => r.severity === 'info')

  // Blockers do not reduce the score. They set their affected metrics to
  // unavailable — and an absent figure is not a wrong figure, so scoring it as
  // if it were would double-punish the report for being honest.
  let score = 1
  for (const w of warnings) score -= w.weight

  score = Math.max(0, Math.min(1, score))
  const confidence = score >= THRESHOLDS.high ? 'high' : score >= THRESHOLDS.medium ? 'medium' : 'low'

  // Metric ids a blocker has made uncomputable. '*' means the whole run.
  const blockedMetrics = new Set()
  let blockedEverything = false
  for (const b of blockers) {
    if (b.affects.includes('*')) blockedEverything = true
    for (const m of b.affects) if (m !== '*') blockedMetrics.add(m)
  }

  return {
    score,
    confidence,
    checks: results,
    byId,
    blockers,
    warnings,
    infos,
    blockedMetrics,
    blockedEverything,
    isBlocked: (metricId) => blockedEverything || blockedMetrics.has(metricId),
    /** Serialisable form for the ReportDocument — drops the helper functions. */
    toJSON() {
      return {
        score: Number(score.toFixed(4)),
        confidence,
        blockers: blockers.map(strip),
        warnings: warnings.map(strip),
        notes: infos.map(strip),
      }
    },
  }
}

function strip(r) {
  return {
    id: r.id,
    label: r.label,
    severity: r.severity,
    count: r.count,
    exposure: r.exposure,
    message: r.message,
    drill: r.drill,
    detail: r.detail,
  }
}

module.exports = { runPreflight, THRESHOLDS }
