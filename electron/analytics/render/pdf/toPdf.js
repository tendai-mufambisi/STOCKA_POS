const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { toHtml } = require('../html/toHtml')

// ReportDocument → PDF, with no PDF library.
//
// Electron already ships Chromium, which is a better print engine than any
// npm PDF package. A hidden BrowserWindow loads the self-contained HTML and
// webContents.printToPDF renders it.
//
// Why not a React route in the app window:
//
//   - Scheduled reports must render at 03:00 with nobody logged in. A React
//     route needs a live, authenticated, routed renderer.
//   - toHtml() is a pure function, so it snapshot-tests without Electron. Only
//     the rasterisation needs a browser, and that step has no logic to test.
//   - A route means localhost:5173 in dev and file:// in production — two code
//     paths for output that must be byte-identical.
//   - Report layout would drift back into src/, where it accretes logic.
//
// Security: the page is fully static, so the window runs with javascript
// DISABLED. Combined with the escaping in toHtml, a product named
// `<script>…</script>` cannot execute — which matters, because product and
// expense names are user input and they reach these pages.

let queue = Promise.resolve()

/**
 * Render a document to a PDF buffer.
 *
 * Jobs are serialised: a scheduled batch of twelve monthly reports must not
 * open twelve Chromium windows at once on a shop PC.
 */
function documentToPdf(doc, opts = {}) {
  queue = queue.then(
    () => renderOne(doc, opts),
    () => renderOne(doc, opts) // a failed job must not poison the queue
  )
  return queue
}

async function renderOne(doc, opts) {
  // Required lazily so that requiring the analytics engine in a test or a
  // plain-Node script does not drag in Electron.
  const { BrowserWindow } = require('electron')

  const html = toHtml(doc, { cover: opts.cover !== false })

  // A temp FILE rather than a data: URL. Chromium caps data-URL navigations,
  // and a 40-page report with a dozen inline SVGs exceeds that limit — which
  // fails as a blank page rather than an error.
  const tmp = path.join(os.tmpdir(), `stocka-report-${crypto.randomUUID()}.html`)
  fs.writeFileSync(tmp, html, 'utf8')

  let win = null
  try {
    win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1600,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false, // the page is static; nothing needs to run
        webSecurity: true,
        images: true,
      },
    })

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Report page timed out while loading')), 30000)
      win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        clearTimeout(timer)
        reject(new Error(`Report page failed to load (${code}): ${desc}`))
      })
      win.loadFile(tmp).catch(reject)
    })

    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      // The @page rule in the stylesheet owns margins and size, so the print
      // layout is defined in one place with the rest of the design.
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildFooterTemplate(doc),
      ...(opts.printOptions || {}),
    })
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    try { fs.unlinkSync(tmp) } catch { /* temp file already gone */ }
  }
}

/** Write a PDF to disk and return the path. */
async function documentToPdfFile(doc, filePath, opts = {}) {
  const buffer = await documentToPdf(doc, opts)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
  return filePath
}

/**
 * The footer repeated on EVERY page of the PDF.
 *
 * Chromium renders header/footer templates in a separate document from the page
 * body: the report's stylesheet does not apply, so every style is inline, and
 * external resources never load — which is why the Stocka mark is a base64
 * data URI rather than inline SVG or a file reference.
 *
 * Chromium also forces its own default font size on this document, so the
 * explicit font-size on the outer div is required, not decorative.
 *
 * pageNumber / totalPages are substituted by Chromium at print time.
 */
function buildFooterTemplate(doc) {
  const { BRAND, stockaMarkDataUri } = require('../html/brand')
  const shop = escapeForTemplate(doc.shop?.name)
  const period = escapeForTemplate(doc.period?.label)

  return (
    `<div style="width:100%;font-size:7pt;font-family:Helvetica,Arial,sans-serif;` +
    `color:#6b7280;padding:0 14mm;display:flex;align-items:center;` +
    `justify-content:space-between;border-top:0.5pt solid #d9dee3;padding-top:2mm;">` +
      `<span style="display:flex;align-items:center;gap:1.5mm;">` +
        `<img src="${stockaMarkDataUri(9)}" style="width:9px;height:9px;display:block;"/>` +
        `<span>Generated by <b style="color:${BRAND.green};">${BRAND.name}</b> ${BRAND.system}</span>` +
      `</span>` +
      `<span style="text-align:center;flex:1;">${shop} — ${period}</span>` +
      `<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>` +
    `</div>`
  )
}

// The footer template is injected into Chromium's own print chrome, which is a
// separate document from the report body — so it needs its own escaping.
function escapeForTemplate(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// buildFooterTemplate is exported so the repeated page footer can be tested
// without launching Chromium — it is the one piece of the PDF path that carries
// content rather than mechanics.
module.exports = { documentToPdf, documentToPdfFile, buildFooterTemplate }
