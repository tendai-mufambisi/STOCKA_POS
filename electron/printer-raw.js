const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { exec } = require('child_process')

// In a packaged app __dirname is inside the read-only app.asar, so we must
// resolve the PS1 script from the unpacked resources and write the temp
// binary to the OS temp directory instead.
const isPackaged = __dirname.includes('app.asar')
const PS_SCRIPT = isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'send-to-printer.ps1')
  : path.join(__dirname, '..', 'send-to-printer.ps1')
const TMP_FILE = path.join(os.tmpdir(), 'stocka_receipt_tmp.bin')
// A separate temp file so printing the day summary can never clobber a receipt
// that is spooling at the same moment.
const TMP_FILE_EOD = path.join(os.tmpdir(), 'stocka_eod_tmp.bin')

const ESC = 0x1B
const GS  = 0x1D
const cmd = (...b) => Buffer.from(b)
const txt = s => Buffer.from(String(s), 'latin1')

// 58mm paper = 32 chars, 80mm paper = 42 chars
function getWidth(shopInfo) {
  return shopInfo?.receipt_width_mm === 80 ? 42 : 32
}

// DB timestamps ('YYYY-MM-DD HH:MM:SS') are UTC without a zone marker — new Date()
// would read the digits as local time and print reprints 2h in the past. Force UTC.
function parseDbDate(value) {
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z')
  return new Date(s)
}

function padLine(left, right, W) {
  const r = String(right)
  const l = String(left).substring(0, W - r.length - 1)
  return l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r
}

// Greedy word wrap for free text (day notes) — a thermal printer will happily
// run a long line off the edge of the paper rather than wrap it itself.
function wrapText(text, W) {
  const out = []
  for (const paragraph of String(text).split('\n')) {
    let line = ''
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (!line) line = word.substring(0, W)
      else if (line.length + 1 + word.length <= W) line += ' ' + word
      else { out.push(line); line = word.substring(0, W) }
    }
    out.push(line)
  }
  return out
}

function buildReceiptBytes(receipt, shopInfo, isDuplicate) {
  const W        = getWidth(shopInfo)
  const divider  = '-'.repeat(W)
  const shop     = (shopInfo?.name || 'STOCKA SHOP').trim()
  const currency = shopInfo?.currency || 'USD'
  const total    = Number(receipt.total    || 0)
  const sub      = Number(receipt.subtotal !== undefined ? receipt.subtotal : total)
  const vatRate  = Number(shopInfo?.vat_rate || 0)
  // If the receipt already carries a tax value use it; otherwise derive from VAT rate (tax-inclusive)
  const tax      = receipt.tax !== undefined
    ? Number(receipt.tax)
    : (vatRate > 0 ? total - total / (1 + vatRate / 100) : 0)
  const tendered = Number(receipt.cash_tendered || 0)
  const change   = Number(receipt.change_given  || 0)
  const dateStr  = receipt.created_at
    ? parseDbDate(receipt.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
    : new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  const fmt = n => `${currency} ${Number(n).toFixed(2)}`

  const parts = []
  const push = (...b) => b.forEach(x => parts.push(x))

  // Init printer
  push(cmd(ESC, 0x40))

  // Shop name — centered, bold, with size chosen by setting or auto-fit
  // 'large'  → double width+height if name fits (≤ W/2 chars), else double-height only
  // 'medium' → double height only (fits any name ≤ W chars)
  // 'normal' → bold, normal size (always fits)
  const nameSize = shopInfo?.receipt_name_size || 'large'
  let nameSizeCmd = null
  if (nameSize === 'normal') {
    nameSizeCmd = null // bold only
  } else if (nameSize === 'medium') {
    nameSizeCmd = cmd(GS, 0x21, 0x01) // double height only
  } else {
    // 'large' with auto-fit: drop to medium when name won't fit at double-width
    nameSizeCmd = shop.length <= Math.floor(W / 2)
      ? cmd(GS, 0x21, 0x11)  // double width+height
      : cmd(GS, 0x21, 0x01)  // double height only
  }
  push(cmd(ESC, 0x61, 0x01))              // center align
  push(cmd(ESC, 0x45, 0x01))              // bold on
  if (nameSizeCmd) push(nameSizeCmd)
  push(txt((isDuplicate ? shop + ' (REPRINT)' : shop) + '\n'))
  push(cmd(GS,  0x21, 0x00))             // normal size
  push(cmd(ESC, 0x45, 0x00))             // bold off

  if (shopInfo?.address) push(txt(shopInfo.address + '\n'))
  if (shopInfo?.phone)   push(txt(shopInfo.phone   + '\n'))

  push(txt(divider + '\n'))

  // Receipt header info — left aligned
  push(cmd(ESC, 0x61, 0x00))
  push(txt(`Receipt: ${receipt.receipt_number || 'N/A'}\n`))
  push(txt(`Date:    ${dateStr}\n`))
  if (receipt.cashier) push(txt(`Cashier: ${receipt.cashier}\n`))

  push(txt(divider + '\n'))

  // Item header
  push(cmd(ESC, 0x45, 0x01))
  push(txt(padLine('Item', 'Amount', W) + '\n'))
  push(cmd(ESC, 0x45, 0x00))
  push(txt(divider + '\n'))

  // Items
  for (const it of (receipt.items || [])) {
    const name     = (it.product_name || it.name || 'Item').substring(0, W - 12)
    const qty      = Number(it.quantity || 1)
    const lineAmt  = it.subtotal !== undefined
      ? Number(it.subtotal)
      : qty * Number(it.selling_price || it.price || 0)
    push(txt(padLine(`${qty}x ${name}`, fmt(lineAmt), W) + '\n'))
  }

  push(txt(divider + '\n'))

  // Totals
  if (sub !== total) push(txt(padLine('Subtotal', fmt(sub), W) + '\n'))
  if (tax > 0)       push(txt(padLine(`VAT (${vatRate}%)`, fmt(tax), W) + '\n'))

  push(cmd(ESC, 0x45, 0x01))
  push(txt(padLine('TOTAL', fmt(total), W) + '\n'))
  push(cmd(ESC, 0x45, 0x00))

  if (receipt.payment_method) push(txt(padLine('Payment', receipt.payment_method, W) + '\n'))
  if (tendered > 0) {
    push(txt(padLine('Tendered', fmt(tendered), W) + '\n'))
    push(txt(padLine('Change',   fmt(change),   W) + '\n'))
  }

  push(txt(divider + '\n'))

  // Footer — centered, configurable
  const footer = (shopInfo?.receipt_footer || 'Thank you for your business!').trim()
  push(cmd(ESC, 0x61, 0x01))
  push(txt(footer + '\n'))
  push(txt('Powered by Stocka\n'))
  push(txt('\n\n\n'))

  // Full cut
  push(cmd(GS, 0x56, 0x41, 0x03))

  return Buffer.concat(parts)
}

// ── End of Day report ─────────────────────────────────────────────────────────
// Deliberately not a receipt: this is the document the day's cash is signed off
// against, so it ends in blank signature lines and carries the reconciliation
// arithmetic — not just the answer — for whoever counts the money.
//
// `report` is the same shape that gets frozen into end_of_day.report_snapshot at
// close time, which is why a reprint months later can reproduce the original
// paper exactly. See buildEodReport() in the renderer.
function buildEodReportBytes(report, shopInfo, isReprint) {
  const W        = getWidth(shopInfo)
  const divider  = '-'.repeat(W)
  const currency = shopInfo?.currency || 'USD'
  const money    = n => `${currency} ${Number(n || 0).toFixed(2)}`
  const num      = n => String(Number(n || 0))

  const parts = []
  const push = (...b) => b.forEach(x => parts.push(x))
  const line     = s => push(txt(s + '\n'))
  const row      = (l, r) => line(padLine(l, r, W))
  const indented = (l, r) => line('  ' + padLine(l, r, W - 2))
  const bold     = on => push(cmd(ESC, 0x45, on ? 0x01 : 0x00))
  const center   = on => push(cmd(ESC, 0x61, on ? 0x01 : 0x00))
  const section  = (title) => { line(divider); bold(true); line(title); bold(false) }

  // A day is only 'balanced' when cash AND transfers reconcile, so the word next
  // to a figure is derived from that figure — never from the day's stored status.
  const varianceWord = v => Math.abs(Number(v || 0)) < 0.01 ? 'OK' : (v > 0 ? 'OVER' : 'SHORT')

  const timeOf = v => {
    const d = v ? parseDbDate(v) : null
    return d && !isNaN(d) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '--:--'
  }
  const stampOf = v => {
    const d = v ? parseDbDate(v) : new Date()
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  }
  // report.date is a local calendar day ('YYYY-MM-DD'). Building the Date from its
  // parts keeps it local — new Date('2026-07-30') is UTC midnight and can print
  // the previous day west of Greenwich.
  const dayLabel = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(report?.date || ''))
    if (!m) return String(report?.date || '')
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  })()

  push(cmd(ESC, 0x40))

  // ── Header ──
  center(true)
  bold(true)
  const shop = (shopInfo?.name || 'STOCKA SHOP').trim()
  push(shop.length <= Math.floor(W / 2) ? cmd(GS, 0x21, 0x11) : cmd(GS, 0x21, 0x01))
  line(shop)
  push(cmd(GS, 0x21, 0x00))
  bold(false)
  if (shopInfo?.address) line(shopInfo.address)
  if (shopInfo?.phone)   line(shopInfo.phone)
  line(divider)
  bold(true)
  line('END OF DAY REPORT')
  bold(false)
  line(dayLabel)
  // Anyone holding two copies of the same day must be able to tell which is the
  // original — the same reason receipts shout (REPRINT).
  if (isReprint) { bold(true); line('*** REPRINT ***'); bold(false) }
  center(false)

  line(divider)
  bold(true)
  row('STATUS', String(report?.status || '').toUpperCase() || 'UNKNOWN')
  bold(false)
  if (report?.closed_by) row('Closed by', String(report.closed_by))
  if (report?.closed_at) row('Closed at', stampOf(report.closed_at))

  // ── Trading ──
  section('TRADING SUMMARY')
  row('Gross sales', money(report?.total_sales))
  if (report?.sales_count != null) row('Sales count', num(report.sales_count))
  row('Expenses', money(report?.total_expenses))
  bold(true)
  row('NET', money(Number(report?.total_sales || 0) - Number(report?.total_expenses || 0)))
  bold(false)

  // ── Payment mix ──
  if (report?.cash_sales != null || report?.transfer_sales != null) {
    section('PAYMENT MIX')
    row('Cash sales', money(report?.cash_sales))
    row('Transfer sales', money(report?.transfer_sales))
  }

  // ── Cash ──
  section('CASH RECONCILIATION')
  if (report?.opening_floats != null) row('Opening floats', money(report.opening_floats))
  if (report?.cash_sales != null)     row('+ Cash sales', money(report.cash_sales))
  if (report?.cash_expenses != null)  row('- Cash expenses', money(report.cash_expenses))
  bold(true)
  row('EXPECTED CASH', money(report?.expected_cash))
  bold(false)
  row('Cash collected', money(report?.actual_cash))
  bold(true)
  row('VARIANCE', `${money(report?.difference)} ${varianceWord(report?.difference)}`)
  bold(false)

  // ── Transfers ──
  // Printed only when the day actually took transfer/EcoCash money. A cash-only
  // shop should never have to read past a block of zeros to find its figures.
  if (Number(report?.expected_transfer || 0) > 0 || Number(report?.actual_transfer || 0) > 0) {
    section('TRANSFER RECONCILIATION')
    bold(true)
    row('EXPECTED TRANSFER', money(report?.expected_transfer))
    bold(false)
    row('Transfer received', money(report?.actual_transfer))
    bold(true)
    row('VARIANCE', `${money(report?.transfer_difference)} ${varianceWord(report?.transfer_difference)}`)
    bold(false)
  }

  // ── Per cashier ──
  section('CASHIER BREAKDOWN')
  const cashiers = Array.isArray(report?.cashiers) ? report.cashiers : []
  if (cashiers.length === 0) {
    // Pre-snapshot records genuinely have no per-cashier detail. Saying so is
    // better than printing a blank section that reads like "nobody worked".
    line('Per-cashier detail was not')
    line('recorded for this day.')
  }
  for (const c of cashiers) {
    bold(true)
    line(String(c?.name || 'Unknown').substring(0, W))
    bold(false)
    line(`  ${timeOf(c?.started_at)} - ${c?.closed_at ? timeOf(c.closed_at) : 'open'}`)
    // A drawer that was never counted, or was closed while its till was
    // unreachable, prints a variance of 0.00 — which reads as "balanced" to
    // anyone holding the paper. Say plainly that it isn't.
    if (c?.verified === false) {
      bold(true)
      line('  !! NOT VERIFIED')
      bold(false)
      for (const l of wrapText(c?.status_note || 'This drawer was not verified against a physical count.', W - 2)) {
        line('  ' + l)
      }
    }
    // No 'OK' next to an unverified drawer's zero — that word is a verdict, and
    // there was nothing to compare these figures against.
    const verdict = v => c?.verified === false ? '' : ` ${varianceWord(v)}`
    indented('Sales', money(c?.sales))
    indented('Expected cash', money(c?.expected_cash))
    indented('Collected', money(c?.collected_cash))
    indented('Variance', `${money(c?.cash_variance)}${verdict(c?.cash_variance)}`)
    if (Number(c?.expected_transfer || 0) > 0 || c?.collected_transfer != null) {
      indented('Expected transfer', money(c?.expected_transfer))
      // null means nobody counted the transfers — printing 0.00 would claim they did.
      indented('Transfer received', c?.collected_transfer == null ? 'not counted' : money(c.collected_transfer))
      if (c?.transfer_variance != null) {
        // 'Transfer variance' + 'USD -50.00 SHORT' overruns 58mm paper and gets
        // chopped mid-word; the short label fits both widths.
        indented('Transfer var', `${money(c.transfer_variance)}${verdict(c.transfer_variance)}`)
      }
    }
  }

  // ── Notes ──
  if (report?.notes && String(report.notes).trim()) {
    section('DAY NOTES')
    for (const l of wrapText(String(report.notes).trim(), W)) line(l)
  }

  // ── Sign-off ──
  line(divider)
  line('Counted by:')
  line('_'.repeat(W))
  line('')
  line('Received by:')
  line('_'.repeat(W))
  line(divider)

  center(true)
  line(`Printed ${stampOf(null)}`)
  if (report?.printed_by) line(`by ${report.printed_by}`)
  line('Powered by Stocka')
  line('\n\n')
  push(cmd(GS, 0x56, 0x41, 0x03))

  return Buffer.concat(parts)
}

// Shared spool step: write the bytes to a temp file and hand it to the PS1 helper,
// which is the only thing that talks to WinSpool.
function sendToPrinter(printerName, bytes, tmpFile) {
  return new Promise((resolve) => {
    try { fs.writeFileSync(tmpFile, bytes) } catch (e) {
      return resolve({ success: false, error: 'Failed to write temp file: ' + e.message })
    }
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_SCRIPT}" -FilePath "${tmpFile}" -PrinterName "${printerName}"`,
      { encoding: 'utf8', timeout: 20000 },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile) } catch (_) {}
        if (err) {
          const msg = ((stdout || '') + (stderr || '') + (err.message || '')).trim()
          return resolve({ success: false, error: msg })
        }
        if (!stdout.includes('PRINT_OK')) {
          return resolve({ success: false, error: stdout.trim() || 'Unknown print error' })
        }
        resolve({ success: true })
      }
    )
  })
}

function printReceipt(printerName, receipt, shopInfo, isDuplicate) {
  return sendToPrinter(printerName, buildReceiptBytes(receipt, shopInfo || {}, isDuplicate || false), TMP_FILE)
}

function printEodReport(printerName, report, shopInfo, isReprint) {
  return sendToPrinter(printerName, buildEodReportBytes(report, shopInfo || {}, isReprint || false), TMP_FILE_EOD)
}

module.exports = { printReceipt, buildReceiptBytes, printEodReport, buildEodReportBytes }
