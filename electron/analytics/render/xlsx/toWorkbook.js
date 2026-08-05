// ReportDocument → a workbook SPEC: sheets of plain rows.
//
// The engine deliberately stops at the spec and does not write the .xlsx file.
// SheetJS lives in the renderer's dependency tree, and pulling it into the main
// process to serialise a few tables would put a large parser in the same
// process as the database for no benefit. The renderer turns this into a file;
// the engine decides what belongs in it.
//
// The values stay RAW — numbers as numbers, not "$1,234.50" — because a
// spreadsheet the owner cannot sum is a screenshot with extra steps. Units
// travel alongside so the renderer can apply number formats.

const NUMERIC_UNITS = ['currency', 'count', 'ratio', 'percent', 'days']

function toWorkbook(doc) {
  const sheets = []

  sheets.push(summarySheet(doc))

  // Every table and key/value block becomes its own sheet, so a category
  // breakdown can be sorted and pivoted rather than admired.
  for (const s of doc.sections || []) {
    if (s.type === 'table' && s.rows?.length) sheets.push(tableSheet(s, sheets))
    if (s.type === 'keyValue' && s.items?.length) sheets.push(keyValueSheet(s, sheets))
    if (s.type === 'statement' && s.lines?.length) sheets.push(statementSheet(s, sheets))
  }

  if (doc.insights?.length) sheets.push(insightsSheet(doc))

  return {
    filename: suggestFilename(doc),
    title: doc.title,
    sheets,
  }
}

function summarySheet(doc) {
  const rows = [
    ['Report', doc.title],
    ['Business', doc.shop?.name || ''],
    ['Period', doc.period?.label || ''],
    ['From', doc.period?.start || ''],
    ['To', doc.period?.end || ''],
    ['Scope', doc.scope?.label || 'All tills'],
    ['Generated', doc.generatedAt],
    ['Engine version', doc.engineVersion],
    [],
    // The confidence figure travels with the spreadsheet. A workbook that has
    // been emailed onward has lost the report's banner, and the caveat must
    // not be the thing that gets left behind.
    ['Data confidence', doc.quality?.confidence || 'unknown'],
    ['Confidence score', doc.quality?.score ?? null],
  ]

  const caveats = [
    ...(doc.quality?.blockers || []),
    ...(doc.quality?.warnings || []),
    ...(doc.quality?.notes || []),
  ].filter((c) => c.message)

  if (caveats.length) {
    rows.push([], ['Caveats'])
    for (const c of caveats) rows.push(['', c.message])
  }

  if (doc.narrative?.paragraphs?.length) {
    rows.push([], ['Executive summary'])
    for (const p of doc.narrative.paragraphs) rows.push(['', p])
  }

  return { name: 'Summary', rows, colWidths: [26, 90] }
}

function tableSheet(s, existing) {
  const header = s.columns.map((c) => c.label)
  const body = s.rows.map((r) => s.columns.map((c) => cell(r[c.key], c.unit)))
  const rows = [header, ...body]

  if (s.totals) {
    rows.push(s.columns.map((c) => (s.totals[c.key] === undefined ? '' : cell(s.totals[c.key], c.unit))))
  }

  return {
    name: sheetName(s.title || 'Table', existing),
    rows,
    units: s.columns.map((c) => c.unit || null),
    headerRow: true,
    colWidths: s.columns.map((c, i) => (i === 0 ? 32 : 14)),
  }
}

function keyValueSheet(s, existing) {
  return {
    name: sheetName(s.title || 'Details', existing),
    rows: [['Item', 'Value'], ...s.items.map((i) => [i.label, cell(i.value, i.unit)])],
    units: [null, null],
    headerRow: true,
    colWidths: [38, 18],
  }
}

function statementSheet(s, existing) {
  return {
    name: sheetName(s.title || 'Statement', existing),
    rows: [['Line', 'Amount'], ...s.lines.map((l) => [l.label, cell(l.value, l.unit)])],
    headerRow: true,
    colWidths: [38, 18],
  }
}

function insightsSheet(doc) {
  return {
    name: 'Insights',
    rows: [
      ['Severity', 'Finding', 'Detail', 'Recommended action'],
      ...doc.insights.map((i) => [
        i.severity,
        i.title,
        i.body || '',
        i.recommendedAction?.text || '',
      ]),
    ],
    headerRow: true,
    colWidths: [12, 46, 64, 46],
  }
}

/**
 * Raw values for numerics; null stays null.
 *
 * null must NOT become 0 here either. A spreadsheet is exactly where a
 * fabricated zero does the most damage, because the next thing that happens to
 * it is SUM().
 */
function cell(value, unit) {
  if (value == null) return null
  if (NUMERIC_UNITS.includes(unit) && typeof value === 'number') return value
  if (typeof value === 'object') return value.label ?? JSON.stringify(value)
  return value
}

// Excel sheet names: 31 chars max, no : \ / ? * [ ], and unique per workbook.
function sheetName(title, existing = []) {
  let base = String(title).replace(/[:\\/?*[\]]/g, '').trim().slice(0, 31) || 'Sheet'
  const taken = new Set(existing.map((s) => s.name))
  if (!taken.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 28)} ${i}`
    if (!taken.has(candidate)) return candidate
  }
  return base.slice(0, 28) + Math.floor(Math.random() * 900 + 100)
}

function suggestFilename(doc) {
  const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-')
  return `${safe(doc.shop?.name || 'Stocka')}-${safe(doc.period?.label || 'report')}.xlsx`
}

module.exports = { toWorkbook, NUMERIC_UNITS }
