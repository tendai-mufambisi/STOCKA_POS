const crypto = require('crypto')
const { ENGINE_VERSION, DOCUMENT_SCHEMA_VERSION } = require('../version')

// The ReportDocument — the boundary of the whole engine.
//
// Everything upstream computes; everything downstream formats. A document is
// plain serialisable JSON: no fonts, no colours, no column widths, no DOM. That
// is what lets one document serve a PDF, an HTML page, a spreadsheet, a thermal
// printer and an interactive dashboard without any of them re-deriving a figure.
//
// The pattern is already proven here. end_of_day.report_snapshot freezes the
// printed day summary as JSON precisely so a reprint months later shows the
// figures the cash was counted against, rather than whatever the shift rows say
// today. This generalises that to every report.
//
// contentHash covers everything EXCEPT generatedAt, so two runs over unchanged
// data are provably identical — which is what makes determinism testable rather
// than asserted.

const SECTION_TYPES = [
  'kpiGrid',
  'table',
  'chart',
  'narrative',
  'insightList',
  'keyValue',
  'statement',
  'divider',
  'pageBreak',
]

function createDocument({
  id,
  title,
  subtitle = null,
  shop = {},
  period,
  comparisonPeriod = null,
  scope = null,
  quality = null,
  sections = [],
  insights = [],
  narrative = null,
  provenance = {},
  footnotes = [],
}) {
  const doc = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id,
    title,
    subtitle,
    generatedAt: new Date().toISOString(),
    shop: {
      name: shop.name || 'This Business',
      address: shop.address || null,
      phone: shop.phone || null,
      currency: shop.currency || 'USD',
      vatRate: shop.vat_rate ?? 0,
    },
    period,
    comparisonPeriod,
    scope,
    quality,
    sections: sections.filter(Boolean),
    insights,
    narrative,
    provenance,
    footnotes,
  }
  doc.contentHash = contentHash(doc)
  return doc
}

/**
 * Stable hash of the document's content, excluding the timestamp.
 *
 * Keys are sorted so that two structurally identical documents hash the same
 * regardless of the order the builders happened to assemble them in.
 */
function contentHash(doc) {
  const { generatedAt, contentHash: _ignored, ...rest } = doc
  return 'sha256:' + crypto.createHash('sha256').update(stableStringify(rest)).digest('hex')
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

/**
 * Structural validation. Returns a list of problems rather than throwing, so a
 * malformed template shows all of its mistakes at once.
 */
function validate(doc) {
  const problems = []
  if (!doc) return ['document is null']
  if (!doc.id) problems.push('missing id')
  if (!doc.title) problems.push('missing title')
  if (!doc.period?.start || !doc.period?.end) problems.push('missing period')
  if (!Array.isArray(doc.sections)) problems.push('sections must be an array')

  ;(doc.sections || []).forEach((s, i) => {
    if (!s.type) problems.push(`section[${i}]: missing type`)
    else if (!SECTION_TYPES.includes(s.type)) problems.push(`section[${i}]: unknown type '${s.type}'`)

    if (s.type === 'table') {
      if (!Array.isArray(s.columns)) problems.push(`section[${i}] (${s.title}): table needs columns`)
      if (!Array.isArray(s.rows)) problems.push(`section[${i}] (${s.title}): table needs rows`)
    }
    if (s.type === 'chart') {
      if (!s.chart) problems.push(`section[${i}]: chart needs a chart kind`)
      // A chart carries BOTH raw series and (optionally) pre-rendered SVG. The
      // series is what the interactive dashboard binds to; the SVG is what the
      // PDF prints. Losing the series would force the dashboard to recompute.
      if (!Array.isArray(s.series)) problems.push(`section[${i}]: chart needs series`)
    }
    if (s.type === 'kpiGrid' && !Array.isArray(s.items)) {
      problems.push(`section[${i}]: kpiGrid needs items`)
    }
  })

  return problems
}

function assertValid(doc) {
  const problems = validate(doc)
  if (problems.length) {
    throw new Error(`Invalid ReportDocument '${doc?.id}':\n  ${problems.join('\n  ')}`)
  }
  return doc
}

module.exports = {
  createDocument,
  contentHash,
  validate,
  assertValid,
  stableStringify,
  SECTION_TYPES,
}
