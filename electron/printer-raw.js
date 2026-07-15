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

function printReceipt(printerName, receipt, shopInfo, isDuplicate) {
  return new Promise((resolve) => {
    const bytes = buildReceiptBytes(receipt, shopInfo || {}, isDuplicate || false)
    try { fs.writeFileSync(TMP_FILE, bytes) } catch (e) {
      return resolve({ success: false, error: 'Failed to write temp file: ' + e.message })
    }
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_SCRIPT}" -FilePath "${TMP_FILE}" -PrinterName "${printerName}"`,
      { encoding: 'utf8', timeout: 20000 },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(TMP_FILE) } catch (_) {}
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

module.exports = { printReceipt, buildReceiptBytes }
