const { PALETTE } = require('./palette')

// The report stylesheet, as a JS string.
//
// A string rather than a .css file because electron-builder's `files` array
// ships whole directories but the renderer must be able to inline this into a
// single self-contained HTML document — no external stylesheet can load under
// the PDF window's file:// origin, and a scheduled report has no dev server.
//
// Print-first: page size, margins and break rules are the primary design, and
// the on-screen preview inherits them. Designing for screen and patching print
// afterwards produces reports with headings orphaned at page bottoms.

const theme = () => `
@page { size: A4; margin: 16mm 14mm 18mm; }

* { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0;
  background: ${PALETTE.paper};
  color: ${PALETTE.ink};
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page { max-width: 190mm; margin: 0 auto; padding: 0 0 12mm; }

/* ── Cover ─────────────────────────────────────────────────────────────── */
.cover { min-height: 240mm; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.cover-brand { font-size: 26pt; font-weight: 800; letter-spacing: 0.16em; margin-bottom: 4mm; }
.cover-title { font-size: 17pt; font-weight: 600; margin-bottom: 14mm; color: ${PALETTE.accent}; }
.cover-rule { width: 30mm; height: 2px; background: ${PALETTE.accent}; margin: 0 auto 14mm; }
.cover-field { margin-bottom: 8mm; }
.cover-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.12em; color: ${PALETTE.inkFaint}; }
.cover-value { font-size: 13pt; font-weight: 600; }
.cover-period { font-size: 15pt; font-weight: 600; margin: 2mm 0; }

/* ── Structure ─────────────────────────────────────────────────────────── */
h2.section {
  font-size: 13pt; font-weight: 700; margin: 9mm 0 3mm;
  padding-bottom: 1.5mm; border-bottom: 1.5px solid ${PALETTE.ink};
  /* A heading alone at the foot of a page is the classic print failure. */
  break-after: avoid; page-break-after: avoid;
}
h3.sub { font-size: 10.5pt; font-weight: 700; margin: 5mm 0 2mm; color: ${PALETTE.inkMuted}; }
.pagebreak { break-before: page; page-break-before: always; }
.divider { height: 1px; background: ${PALETTE.ruleFaint}; margin: 6mm 0; }
section { break-inside: avoid-page; }

/* ── KPI grid ──────────────────────────────────────────────────────────── */
.kpis { display: grid; gap: 3mm; margin: 3mm 0 5mm; }
.kpis.c4 { grid-template-columns: repeat(4, 1fr); }
.kpis.c3 { grid-template-columns: repeat(3, 1fr); }
.kpis.c2 { grid-template-columns: repeat(2, 1fr); }

.kpi { border: 1px solid ${PALETTE.rule}; border-radius: 3px; padding: 3mm 3.5mm; background: ${PALETTE.panel}; }
.kpi-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.07em; color: ${PALETTE.inkFaint}; }
.kpi-value { font-size: 15pt; font-weight: 700; line-height: 1.15; margin-top: 1mm; }
.kpi-value.na { color: ${PALETTE.inkFaint}; font-weight: 500; }
.kpi-delta { font-size: 8.5pt; font-weight: 600; margin-top: 0.5mm; }
.kpi-delta.up { color: ${PALETTE.positive}; }
.kpi-delta.down { color: ${PALETTE.negative}; }
.kpi-delta.flat { color: ${PALETTE.inkFaint}; }
.kpi-hint { font-size: 7.5pt; color: ${PALETTE.inkFaint}; margin-top: 0.5mm; }

/* ── Tables ────────────────────────────────────────────────────────────── */
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 2mm 0 4mm; }
thead { display: table-header-group; } /* repeat headers across page breaks */
th {
  text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em;
  color: ${PALETTE.inkFaint}; padding: 1.5mm 2mm; border-bottom: 1px solid ${PALETTE.ink};
}
td { padding: 1.5mm 2mm; border-bottom: 1px solid ${PALETTE.ruleFaint}; }
tr { break-inside: avoid; page-break-inside: avoid; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 700; border-top: 1.5px solid ${PALETTE.ink}; border-bottom: none; }
.na { color: ${PALETTE.inkFaint}; }
.neg { color: ${PALETTE.negative}; }

/* ── Statement ─────────────────────────────────────────────────────────── */
.statement { margin: 2mm 0 4mm; font-size: 10pt; }
.stmt-line { display: flex; justify-content: space-between; padding: 1.4mm 0; border-bottom: 1px solid ${PALETTE.ruleFaint}; }
.stmt-line .v { font-variant-numeric: tabular-nums; font-weight: 500; }
.stmt-line.deduction .l, .stmt-line.deduction .v { color: ${PALETTE.inkMuted}; }
.stmt-line.subtotal { border-top: 1px solid ${PALETTE.ink}; border-bottom: none; font-weight: 700; margin-top: 1mm; }
.stmt-line.total {
  border-top: 1.5px solid ${PALETTE.ink}; border-bottom: 3px double ${PALETTE.ink};
  font-weight: 800; font-size: 11pt; margin-top: 1mm;
}

/* ── Narrative & insights ──────────────────────────────────────────────── */
.narrative p { margin: 0 0 2.5mm; }
.narrative ul { margin: 0 0 3mm; padding-left: 5mm; }
.narrative li { margin-bottom: 1.2mm; }

.insight { border-left: 2.5px solid ${PALETTE.rule}; padding: 2mm 0 2mm 3.5mm; margin-bottom: 3.5mm; break-inside: avoid; }
.insight.critical, .insight.warning { border-left-color: ${PALETTE.negative}; }
.insight.opportunity { border-left-color: ${PALETTE.positive}; }
.insight.info { border-left-color: ${PALETTE.accent}; }
.insight-title { font-weight: 700; font-size: 10pt; }
.insight-body { color: ${PALETTE.inkMuted}; margin-top: 0.5mm; }
.insight-evidence { font-size: 8.5pt; color: ${PALETTE.inkFaint}; margin-top: 1mm; }
.insight-action { font-size: 9pt; margin-top: 1.2mm; font-weight: 600; }

/* ── Key/value ─────────────────────────────────────────────────────────── */
.kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5mm 6mm; margin: 2mm 0 4mm; }
.kv-row { display: flex; justify-content: space-between; border-bottom: 1px solid ${PALETTE.ruleFaint}; padding: 1.2mm 0; }
.kv-label { color: ${PALETTE.inkMuted}; }
.kv-value { font-weight: 600; font-variant-numeric: tabular-nums; }

/* ── Confidence banner ─────────────────────────────────────────────────── */
.confidence { border: 1px solid ${PALETTE.rule}; border-radius: 3px; padding: 3mm 3.5mm; margin: 3mm 0 5mm; background: ${PALETTE.panel}; }
.confidence.low { border-color: ${PALETTE.negative}; background: #fdf5f5; }
.confidence.medium { border-color: ${PALETTE.caution}; background: #fffaf0; }
.confidence-title { font-weight: 700; margin-bottom: 1mm; }
.confidence ul { margin: 1.5mm 0 0; padding-left: 5mm; font-size: 9pt; color: ${PALETTE.inkMuted}; }

/* ── Charts & footer ───────────────────────────────────────────────────── */
.chart-wrap { margin: 2mm 0 4mm; break-inside: avoid; }
svg.chart { display: block; max-width: 100%; }
.note { font-size: 8.5pt; color: ${PALETTE.inkFaint}; margin-top: 1mm; font-style: italic; }
.empty { font-size: 9.5pt; color: ${PALETTE.inkFaint}; font-style: italic; padding: 3mm 0; }

.footnotes { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid ${PALETTE.rule}; font-size: 8pt; color: ${PALETTE.inkFaint}; }
.footnotes li { margin-bottom: 1mm; }
.doc-footer { margin-top: 6mm; padding-top: 2.5mm; border-top: 1px solid ${PALETTE.rule}; font-size: 7.5pt; color: ${PALETTE.inkFaint}; display: flex; justify-content: space-between; }

@media screen {
  body { background: #e9edf1; padding: 8mm 0; }
  .page { background: ${PALETTE.paper}; padding: 14mm; box-shadow: 0 1px 4px rgba(0,0,0,0.12); border-radius: 2px; }
}
`

module.exports = { theme }
