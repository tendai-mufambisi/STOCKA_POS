const w = window.stocka.analytics

// Thin shim. Deliberately no logic here — the whole point of the analytics
// engine is that no business calculation lives on the renderer side.
//
// Period specs are plain objects so they survive the IPC hop:
//   { type: 'day',   date: '2026-07-31' }
//   { type: 'month', year: 2026, month: 7 }
//   { type: 'range', start: '2026-07-01', end: '2026-07-15' }

export const getMetrics = (ids, period, scope, opts) => w.metrics(ids, period, scope, opts)
export const compareMetrics = (ids, period, scope, opts) => w.compare(ids, period, scope, opts)
export const getQuality = (period, scope, opts) => w.quality(period, scope, opts)
export const explainMetric = (id, period, scope, opts) => w.explain(id, period, scope, opts)
export const getMetricTrend = (id, period, scope, opts) => w.trend(id, period, scope, opts)
export const listMetrics = () => w.listMetrics()

/** True when a failure means "ask the Main Computer", not "something broke". */
export const isMainRequired = (err) => err?.code === 'ANALYTICS_MAIN_REQUIRED'
