const fs   = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const PS_SCRIPT = path.join(__dirname, '..', 'send-to-printer.ps1')
const TMP_FILE  = path.join(__dirname, '..', 'receipt_tmp.bin')

const ESC = 0x1B
const GS  = 0x1D
const cmd = (...b) => Buffer.from(b)
const txt = s => Buffer.from(String(s), 'latin1')

const W = 32
function padLine(left, right) {
  const r = String(right)
  const l = String(left).substring(0, W - r.length - 1)
  return l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r
}

function buildReceiptBytes(receipt, shopInfo, isDuplicate) {
  const shop     = (shopInfo?.name || 'STOCKA SHOP').trim()
  const currency = shopInfo?.currency || 'USD'
  const total    = Number(receipt.total    || 0)
  const sub      = Number(receipt.subtotal !== undefined ? receipt.subtotal : total)
  const tax      = Number(receipt.tax      || 0)
  const tendered = Number(receipt.cash_tendered || 0)
  const change   = Number(receipt.change_given  || 0)
  const dateStr  = receipt.created_at
    ? new Date(receipt.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
    : new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  const fmt = n => `${currency} ${Number(n).toFixed(2)}`

  const parts = []
  const push = (...b) => b.forEach(x => parts.push(x))

  // Init printer
  push(cmd(ESC, 0x40))

  // Shop name — centered, bold, double-height
  push(cmd(ESC, 0x61, 0x01))              // center align
  push(cmd(ESC, 0x45, 0x01))              // bold on
  push(cmd(GS,  0x21, 0x11))             // double width+height
  push(txt((isDuplicate ? shop + ' (REPRINT)' : shop) + '\n'))
  push(cmd(GS,  0x21, 0x00))             // normal size
  push(cmd(ESC, 0x45, 0x00))             // bold off

  if (shopInfo?.address) push(txt(shopInfo.address + '\n'))
  if (shopInfo?.phone)   push(txt(shopInfo.phone   + '\n'))

  push(txt('--------------------------------\n'))

  // Receipt header info — left aligned
  push(cmd(ESC, 0x61, 0x00))
  push(txt(`Receipt: ${receipt.receipt_number || 'N/A'}\n`))
  push(txt(`Date:    ${dateStr}\n`))
  if (receipt.cashier) push(txt(`Cashier: ${receipt.cashier}\n`))

  push(txt('--------------------------------\n'))

  // Item header
  push(cmd(ESC, 0x45, 0x01))
  push(txt(padLine('Item', 'Amount') + '\n'))
  push(cmd(ESC, 0x45, 0x00))
  push(txt('--------------------------------\n'))

  // Items
  for (const it of (receipt.items || [])) {
    const name     = (it.product_name || it.name || 'Item').substring(0, 20)
    const qty      = Number(it.quantity || 1)
    const lineAmt  = it.subtotal !== undefined
      ? Number(it.subtotal)
      : qty * Number(it.selling_price || it.price || 0)
    push(txt(padLine(`${qty}x ${name}`, fmt(lineAmt)) + '\n'))
  }

  push(txt('--------------------------------\n'))

  // Totals
  if (sub !== total) push(txt(padLine('Subtotal', fmt(sub)) + '\n'))
  if (tax > 0)       push(txt(padLine('Tax',      fmt(tax)) + '\n'))

  push(cmd(ESC, 0x45, 0x01))
  push(txt(padLine('TOTAL', fmt(total)) + '\n'))
  push(cmd(ESC, 0x45, 0x00))

  if (receipt.payment_method) push(txt(padLine('Payment', receipt.payment_method) + '\n'))
  if (tendered > 0) {
    push(txt(padLine('Tendered', fmt(tendered)) + '\n'))
    push(txt(padLine('Change',   fmt(change))   + '\n'))
  }

  push(txt('--------------------------------\n'))

  // Footer — centered
  push(cmd(ESC, 0x61, 0x01))
  push(txt('Thank you for your business!\n'))
  push(txt('Powered by Stocka\n'))
  push(txt('\n\n\n'))

  // Full cut
  push(cmd(GS, 0x56, 0x41, 0x03))

  return Buffer.concat(parts)
}

function printReceipt(printerName, receipt, shopInfo, isDuplicate) {
  const bytes = buildReceiptBytes(receipt, shopInfo || {}, isDuplicate || false)
  fs.writeFileSync(TMP_FILE, bytes)
  try {
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_SCRIPT}" -FilePath "${TMP_FILE}" -PrinterName "${printerName}"`,
      { encoding: 'utf8', timeout: 15000 }
    )
    if (!out.includes('PRINT_OK')) throw new Error(out.trim())
    return { success: true }
  } catch (e) {
    const msg = ((e.stdout || '') + (e.stderr || '') + (e.message || '')).trim()
    return { success: false, error: msg }
  } finally {
    try { fs.unlinkSync(TMP_FILE) } catch (_) {}
  }
}

module.exports = { printReceipt, buildReceiptBytes }
