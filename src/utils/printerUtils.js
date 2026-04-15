/**
 * Printer utilities for ESC/POS thermal receipt printing
 * Handles receipt formatting and ESC/POS command generation
 */

// ESC/POS command constants
const ESC = '\x1B'
const GS = '\x1D'

/**
 * Generate ESC/POS commands for a receipt
 * @param {Object} receipt - Receipt data object
 * @param {Object} shopInfo - Shop information
 * @param {boolean} isDuplicate - Whether this is a duplicate/reprint
 * @returns {Buffer} Buffer of ESC/POS commands
 */
export const generateReceiptCommands = (receipt, shopInfo, isDuplicate = false) => {
  let commands = []

  // Initialize printer
  commands.push(ESC + '@') // Reset printer

  // Select font and size
  commands.push(ESC + '!' + String.fromCharCode(0x08)) // Normal font, size

  // ═══════════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════════

  // Center alignment
  commands.push(ESC + 'a' + String.fromCharCode(1))

  // Shop name (large, bold)
  commands.push(ESC + 'E' + String.fromCharCode(1)) // Emphasized on
  commands.push(ESC + '!' + String.fromCharCode(0x38)) // Large font
  commands.push((shopInfo.name || 'STOCKA SHOP') + '\n')
  commands.push(ESC + 'E' + String.fromCharCode(0)) // Emphasized off
  commands.push(ESC + '!' + String.fromCharCode(0)) // Normal font

  // Shop address
  commands.push(shopInfo.address || 'Address not set')
  commands.push('\n')

  // Shop phone
  commands.push(shopInfo.phone || 'Phone not set')
  commands.push('\n')

  // Divider line
  commands.push('-' + Array(38).fill('-').join(''))
  commands.push('\n')

  // ═══════════════════════════════════════════
  // SALE INFO
  // ═══════════════════════════════════════════

  // Left alignment
  commands.push(ESC + 'a' + String.fromCharCode(0))

  // Date and Time
  const saleDate = new Date(receipt.created_at || new Date())
  const dateStr = formatDate(saleDate)
  const timeStr = formatTime(saleDate)
  commands.push(`Date: ${dateStr}  Time: ${timeStr}\n`)

  // Receipt number
  commands.push(`Receipt No: ${receipt.receipt_number || 'N/A'}\n`)

  // Cashier name
  commands.push(`Cashier: ${receipt.cashier || 'N/A'}\n`)

  // Reprint watermark
  if (isDuplicate) {
    commands.push(ESC + 'a' + String.fromCharCode(1)) // Center
    commands.push(ESC + 'E' + String.fromCharCode(1)) // Emphasized
    commands.push('** REPRINT **\n')
    commands.push(ESC + 'E' + String.fromCharCode(0)) // Emphasized off
    commands.push(ESC + 'a' + String.fromCharCode(0)) // Left align
  }

  // Divider line
  commands.push('-' + Array(38).fill('-').join(''))
  commands.push('\n')

  // ═══════════════════════════════════════════
  // ITEMS TABLE
  // ═══════════════════════════════════════════

  // Table header
  commands.push('Item              Qty  Price    Total\n')
  commands.push('-' + Array(38).fill('-').join(''))
  commands.push('\n')

  // Items
  if (receipt.items && receipt.items.length > 0) {
    receipt.items.forEach(item => {
      const itemName = truncateString(item.product_name || item.name, 16)
      const qty = (item.quantity || 0).toString().padStart(4, ' ')
      const price = formatMoney(item.selling_price || item.price)
      const total = formatMoney(item.subtotal || (item.quantity * item.selling_price))
      
      commands.push(`${itemName.padEnd(16)} ${qty} ${price.padStart(7)} ${total.padStart(7)}\n`)
    })
  }

  // Divider line
  commands.push('-' + Array(38).fill('-').join(''))
  commands.push('\n')

  // ═══════════════════════════════════════════
  // TOTALS
  // ═══════════════════════════════════════════

  // Center alignment
  commands.push(ESC + 'a' + String.fromCharCode(1))

  // Total (bold)
  commands.push(ESC + 'E' + String.fromCharCode(1)) // Emphasized on
  commands.push(`TOTAL: ${formatMoney(receipt.total || 0)}\n`)
  commands.push(ESC + 'E' + String.fromCharCode(0)) // Emphasized off

  // Payment method
  commands.push(`Payment: ${receipt.payment_method || 'USD Cash'}\n`)

  // Cash tendered and change
  if (receipt.cash_tendered !== undefined) {
    commands.push(`Cash Tendered: ${formatMoney(receipt.cash_tendered)}\n`)
  }

  if (receipt.change_given !== undefined) {
    commands.push(ESC + 'E' + String.fromCharCode(1)) // Emphasized
    commands.push(`CHANGE: ${formatMoney(receipt.change_given)}\n`)
    commands.push(ESC + 'E' + String.fromCharCode(0)) // Emphasized off
  }

  // ═══════════════════════════════════════════
  // FOOTER
  // ═════════════════════════════════════════════

  commands.push('\n')
  commands.push('-' + Array(38).fill('-').join(''))
  commands.push('\n')

  // Thank you message
  commands.push(`Thank you for shopping with ${shopInfo.name || 'STOCKA SHOP'}!\n`)

  // Powered by message (small text)
  commands.push(ESC + '!' + String.fromCharCode(0x00)) // Tiny font
  commands.push('Powered by Stocka\n')
  commands.push(ESC + '!' + String.fromCharCode(0)) // Normal font

  // Feed paper and cut
  commands.push('\n\n\n')
  commands.push(GS + 'V' + String.fromCharCode(66)) // Partial cut
  commands.push(ESC + '@') // Reset printer

  return Buffer.from(commands.join(''))
}

/**
 * Format date as DD/MM/YYYY
 */
const formatDate = (date) => {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Format time as HH:MM AM/PM
 */
const formatTime = (date) => {
  let hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  hours = hours ? hours : 12
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`
}

/**
 * Format number as currency
 */
const formatMoney = (amount) => {
  const num = parseFloat(amount || 0)
  return `$${num.toFixed(2)}`
}

/**
 * Truncate string to max length
 */
const truncateString = (str, maxLength) => {
  if (!str) return ''
  return str.length > maxLength ? str.substring(0, maxLength) : str
}

/**
 * Generate receipt number in format YYYYMMDD-XXXX
 * @param {number} dailyCounter - Counter for today (incremented number)
 * @returns {string} Receipt number
 */
export const generateReceiptNumber = (dailyCounter = 1) => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const counter = String(dailyCounter).padStart(4, '0')
  return `${year}${month}${day}-${counter}`
}

/**
 * Get receipt counter for today
 * Extracts the counter from the last receipt number if it's from today
 * @param {string} lastReceiptNumber - Last receipt number
 * @returns {number} Counter for next receipt (or 1 if new day)
 */
export const getNextReceiptCounter = (lastReceiptNumber) => {
  if (!lastReceiptNumber) return 1

  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const todayPrefix = `${year}${month}${day}`

  const parts = lastReceiptNumber.split('-')
  const prefix = parts[0]

  // If the prefix matches today's date, increment the counter
  if (prefix === todayPrefix && parts[1]) {
    const counter = parseInt(parts[1], 10)
    return counter + 1
  }

  // Otherwise start from 1 (new day)
  return 1
}
