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

// ── Reports ──────────────────────────────────────────────────────────────────
export const listReports = () => w.listReports()
export const runReport = (id, period, scope, opts) => w.runReport(id, period, scope, opts)
export const getReportHtml = (id, period, scope, opts) => w.reportHtml(id, period, scope, opts)
export const saveReportSnapshot = (doc, by) => w.saveSnapshot(doc, by)
export const listReportSnapshots = (opts) => w.listSnapshots(opts)
export const getReportSnapshot = (id) => w.getSnapshot(id)

/**
 * Render a report to PDF and hand back a blob URL.
 *
 * The PDF crosses IPC as base64 because raw binary does not survive the hop —
 * nor the LAN JSON transport, which matters because a satellite legitimately
 * renders a PDF from a document the Main Computer computed.
 */
export async function getReportPdfUrl(id, period, scope, opts) {
  const { pdfBase64, title, contentHash } = await w.reportPdf(id, period, scope, opts)
  const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/pdf' })
  return { url: URL.createObjectURL(blob), blob, title, contentHash }
}
export const listMetrics = () => w.listMetrics()

/** True when a failure means "ask the Main Computer", not "something broke". */
export const isMainRequired = (err) => err?.code === 'ANALYTICS_MAIN_REQUIRED'
