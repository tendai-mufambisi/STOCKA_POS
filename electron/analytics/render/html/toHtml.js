const { theme } = require('./theme.css.js')

// ReportDocument → a single self-contained HTML string.
//
// Pure: document in, string out. No Electron, no DOM, no filesystem — so it
// snapshot-tests in plain Node, and the same function serves the on-screen
// preview, the PDF, and an emailed report. What you preview is byte-for-byte
// what gets printed.
//
// EVERY value that reaches the output goes through esc(). Product names,
// expense descriptions, cashier names and shop details all flow into reports
// and all originate from user input. Combined with the PDF window running with
// javascript disabled, that makes injection structurally impossible rather than
// merely unlikely.

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

// ── Value formatting ─────────────────────────────────────────────────────────

/**
 * The single place a figure becomes text.
 *
 * null renders as an em dash, never as 0 or "N/A". The engine distinguishes
 * "nothing happened" from "we cannot say", and that distinction has to survive
 * all the way to the paper or the whole exercise is pointless.
 */
function fmt(value, unit, currency = '$') {
  if (value == null) return '—'
  switch (unit) {
    case 'currency':
      return (
        (value < 0 ? '-' : '') +
        currency +
        Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      )
    case 'percent':
    case 'ratio':
      return `${(value * 100).toFixed(1)}%`
    case 'count':
      return Number(value).toLocaleString('en-US')
    case 'days':
      return `${Math.round(value)} day${Math.round(value) === 1 ? '' : 's'}`
    case 'text':
      return typeof value === 'object' ? esc(value.label ?? '') : esc(String(value))
    default:
      return typeof value === 'number'
        ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : esc(String(value))
  }
}

function fmtDelta(delta) {
  if (!delta || delta.percentChange == null || !delta.comparable) return ''
  const pct = delta.percentChange
  const dir = pct > 0.001 ? 'up' : pct < -0.001 ? 'down' : 'flat'
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'
  return `<div class="kpi-delta ${dir}">${arrow} ${Math.abs(pct * 100).toFixed(1)}% vs ${esc(
    delta.comparisonPeriod?.label || 'previous'
  )}</div>`
}

// ── Section renderers ────────────────────────────────────────────────────────

function renderKpiGrid(s, cur) {
  const cards = s.items
    .map((k) => {
      const na = k.value == null
      return (
        `<div class="kpi">` +
        `<div class="kpi-label">${esc(k.label)}</div>` +
        `<div class="kpi-value${na ? ' na' : ''}">${fmt(k.value, k.unit, cur)}</div>` +
        fmtDelta(k.delta) +
        (k.hint ? `<div class="kpi-hint">${esc(k.hint)}</div>` : '') +
        // An unavailable figure explains itself on the card rather than leaving
        // a bare dash the reader has to interpret.
        (na && k.unavailable ? `<div class="kpi-hint">${esc(k.unavailable.reason)}</div>` : '') +
        `</div>`
      )
    })
    .join('')
  const cols = Math.min(4, Math.max(2, s.columns || 4))
  return sectionWrap(s.title, `<div class="kpis c${cols}">${cards}</div>`)
}

function renderTable(s, cur) {
  if (!s.rows.length) return sectionWrap(s.title, `<p class="empty">${esc(s.emptyMessage)}</p>`)

  const head = s.columns
    .map((c) => `<th class="${c.align === 'right' || isNumeric(c.unit) ? 'num' : ''}">${esc(c.label)}</th>`)
    .join('')

  const body = s.rows
    .map(
      (r) =>
        '<tr>' +
        s.columns
          .map((c) => {
            const v = r[c.key]
            const numeric = c.align === 'right' || isNumeric(c.unit)
            const cls = [numeric ? 'num' : '', v == null ? 'na' : '', typeof v === 'number' && v < 0 ? 'neg' : '']
              .filter(Boolean)
              .join(' ')
            return `<td class="${cls}">${c.unit ? fmt(v, c.unit, cur) : esc(v ?? '—')}</td>`
          })
          .join('') +
        '</tr>'
    )
    .join('')

  const foot = s.totals
    ? '<tfoot><tr>' +
      s.columns
        .map((c) => {
          const v = s.totals[c.key]
          const numeric = c.align === 'right' || isNumeric(c.unit)
          return `<td class="${numeric ? 'num' : ''}">${
            v === undefined ? '' : c.unit ? fmt(v, c.unit, cur) : esc(v)
          }</td>`
        })
        .join('') +
      '</tr></tfoot>'
    : ''

  return sectionWrap(
    s.title,
    `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>` +
      (s.note ? `<p class="note">${esc(s.note)}</p>` : '')
  )
}

function renderChart(s) {
  // The pre-rendered SVG is emitted verbatim — it is produced by the engine's
  // own chart module from escaped labels, never supplied by a caller.
  const body = s.svg
    ? `<div class="chart-wrap">${s.svg}</div>`
    : `<p class="empty">Chart unavailable.</p>`
  return sectionWrap(s.title, body + (s.note ? `<p class="note">${esc(s.note)}</p>` : ''))
}

function renderNarrative(s) {
  const body = (s.blocks || [])
    .map((b) =>
      b.kind === 'bullets'
        ? `<ul>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
        : `<p>${esc(b.text)}</p>`
    )
    .join('')
  return sectionWrap(s.title, `<div class="narrative">${body}</div>`)
}

function renderInsightList(s, doc, cur) {
  const byId = new Map((doc.insights || []).map((i) => [i.id, i]))
  const chosen = (s.insightIds || []).map((id) => byId.get(id)).filter(Boolean)
  if (!chosen.length) return sectionWrap(s.title, `<p class="empty">${esc(s.emptyMessage)}</p>`)

  const body = chosen
    .map((ins) => {
      const evidence = (ins.evidence || [])
        .map((e) => `${esc(e.label)}: ${fmt(e.value, e.unit, cur)}`)
        .join(' · ')
      return (
        `<div class="insight ${esc(ins.severity)}">` +
        `<div class="insight-title">${esc(ins.title)}</div>` +
        (ins.body ? `<div class="insight-body">${esc(ins.body)}</div>` : '') +
        (evidence ? `<div class="insight-evidence">${evidence}</div>` : '') +
        (ins.recommendedAction?.text
          ? `<div class="insight-action">→ ${esc(ins.recommendedAction.text)}</div>`
          : '') +
        `</div>`
      )
    })
    .join('')
  return sectionWrap(s.title, body)
}

function renderKeyValue(s, cur) {
  const body = s.items
    .map(
      (i) =>
        `<div class="kv-row"><span class="kv-label">${esc(i.label)}</span>` +
        `<span class="kv-value${i.value == null ? ' na' : ''}">${fmt(i.value, i.unit, cur)}</span></div>`
    )
    .join('')
  return sectionWrap(s.title, `<div class="kv">${body}</div>`)
}

function renderStatement(s, cur) {
  const body = s.lines
    .map(
      (l) =>
        `<div class="stmt-line ${esc(l.kind)}">` +
        `<span class="l">${esc(l.label)}</span>` +
        `<span class="v${l.value == null ? ' na' : ''}">${fmt(l.value, l.unit, cur)}</span>` +
        `</div>`
    )
    .join('')
  return sectionWrap(
    s.title,
    `<div class="statement">${body}</div>` + (s.note ? `<p class="note">${esc(s.note)}</p>` : '')
  )
}

function sectionWrap(title, inner) {
  return `<section>${title ? `<h2 class="section">${esc(title)}</h2>` : ''}${inner}</section>`
}

const isNumeric = (unit) => ['currency', 'count', 'percent', 'ratio', 'days'].includes(unit)

// ── Document assembly ────────────────────────────────────────────────────────

function renderCover(doc) {
  return (
    `<div class="cover">` +
    `<div class="cover-brand">STOCKA</div>` +
    `<div class="cover-title">${esc(doc.title)}</div>` +
    `<div class="cover-rule"></div>` +
    `<div class="cover-field"><div class="cover-label">Business</div>` +
    `<div class="cover-value">${esc(doc.shop.name)}</div></div>` +
    (doc.scope?.label
      ? `<div class="cover-field"><div class="cover-label">Scope</div>` +
        `<div class="cover-value">${esc(doc.scope.label)}</div></div>`
      : '') +
    `<div class="cover-field"><div class="cover-label">Reporting Period</div>` +
    `<div class="cover-period">${esc(doc.period.label)}</div>` +
    `<div class="cover-label">${esc(doc.period.start)} to ${esc(doc.period.end)}</div></div>` +
    `<div class="cover-field"><div class="cover-label">Generated</div>` +
    `<div class="cover-value">${esc(new Date(doc.generatedAt).toLocaleDateString('en-ZA', {
      day: '2-digit', month: 'long', year: 'numeric',
    }))}</div></div>` +
    `</div><div class="pagebreak"></div>`
  )
}

/**
 * How far the figures can be trusted, printed WITH the figures.
 *
 * A caveat filed elsewhere is a caveat nobody reads, and the owner's stated
 * priority was a smaller report with reliable numbers over a large one with
 * questionable ones. This is that promise made visible on paper.
 */
function renderConfidence(q) {
  if (!q) return ''
  const issues = [...(q.blockers || []), ...(q.warnings || [])]
  const pct = Math.round((q.score ?? 1) * 100)

  if (q.confidence === 'high' && issues.length === 0) {
    return (
      `<div class="confidence"><div class="confidence-title">Figures verified</div>` +
      `<div>Every figure in this report was computed from complete data (${pct}% confidence).</div></div>`
    )
  }

  const list = [...issues, ...(q.notes || [])]
    .filter((i) => i.message)
    .map((i) => `<li>${esc(i.message)}</li>`)
    .join('')

  return (
    `<div class="confidence ${esc(q.confidence)}">` +
    `<div class="confidence-title">${
      q.confidence === 'low' ? 'These figures are missing information' : 'Read these figures with care'
    } — ${pct}% confidence</div>` +
    `<div>${
      q.confidence === 'low'
        ? 'Some numbers below rest on data the system cannot verify. The specifics are listed here rather than hidden.'
        : 'The report is usable, with the following caveats.'
    }</div>` +
    (list ? `<ul>${list}</ul>` : '') +
    `</div>`
  )
}

function renderSection(s, doc, cur) {
  switch (s.type) {
    case 'kpiGrid': return renderKpiGrid(s, cur)
    case 'table': return renderTable(s, cur)
    case 'chart': return renderChart(s)
    case 'narrative': return renderNarrative(s)
    case 'insightList': return renderInsightList(s, doc, cur)
    case 'keyValue': return renderKeyValue(s, cur)
    case 'statement': return renderStatement(s, cur)
    case 'divider': return '<div class="divider"></div>'
    case 'pageBreak': return '<div class="pagebreak"></div>'
    default: return ''
  }
}

/**
 * @param opts.cover      include the cover page (default true)
 * @param opts.fragment   body only, no <html> wrapper — for embedding in the app
 */
function toHtml(doc, opts = {}) {
  const cur = doc.shop?.currency === 'USD' ? '$' : `${doc.shop?.currency || ''} `
  const body =
    (opts.cover === false ? '' : renderCover(doc)) +
    renderConfidence(doc.quality) +
    doc.sections.map((s) => renderSection(s, doc, cur)).join('') +
    (doc.footnotes?.length
      ? `<div class="footnotes"><ul>${doc.footnotes.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`
      : '') +
    `<div class="doc-footer">` +
    `<span>${esc(doc.shop.name)} · ${esc(doc.period.label)}</span>` +
    `<span>Stocka ${esc(doc.engineVersion)}` +
    (doc.provenance?.tillCode ? ` · till ${esc(doc.provenance.tillCode)}` : '') +
    (doc.quality?.confidence ? ` · ${esc(doc.quality.confidence)} confidence` : '') +
    `</span></div>`

  if (opts.fragment) return `<div class="page">${body}</div>`

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(doc.title)} — ${esc(doc.shop.name)}</title>` +
    `<style>${theme()}</style></head><body><div class="page">${body}</div></body></html>`
  )
}

module.exports = { toHtml, fmt, esc }
