/**
 * POS Receipt Formatter
 * Converts receipt data to @plick/electron-pos-printer format
 * Supports text, tables, barcodes, and images
 */

/**
 * Format receipt data for PosPrinter
 * @param {Object} receiptData - Receipt information
 * @param {Object} shopInfo - Shop information (name, address, phone)
 * @param {boolean} isDuplicate - Whether this is a reprint
 * @returns {Array} Array of print objects for PosPrinter
 */
export const formatReceiptForPosPrinter = (receiptData, shopInfo = {}, isDuplicate = false) => {
  const receipt = [
    // ═════════════════════════════════════════════
    // HEADER
    // ═════════════════════════════════════════════
    {
      type: 'text',
      value: shopInfo.name || 'STOCKA SHOP',
      options: {
        align: 'center',
        width: 2, // Double width (bold effect)
        bold: true,
        fontSize: 16
      }
    },
    {
      type: 'text',
      value: shopInfo.address || 'Address not set',
      options: { align: 'center' }
    },
    {
      type: 'text',
      value: shopInfo.phone || 'Phone not set',
      options: { align: 'center' }
    },
    {
      type: 'divider',
      options: { char: '-', width: 1 }
    },

    // ═════════════════════════════════════════════
    // RECEIPT INFO
    // ═════════════════════════════════════════════
    {
      type: 'text',
      value: `Date: ${receiptData.date || new Date().toLocaleString()}`,
      options: { align: 'left' }
    },
    {
      type: 'text',
      value: `Receipt No: ${receiptData.receipt_number || 'N/A'}`,
      options: { align: 'left' }
    },
    {
      type: 'text',
      value: `Cashier: ${receiptData.cashier || 'N/A'}`,
      options: { align: 'left' }
    },

    // Reprint watermark
    ...(isDuplicate
      ? [
          {
            type: 'text',
            value: '** REPRINT **',
            options: { align: 'center', bold: true }
          }
        ]
      : []),

    {
      type: 'divider',
      options: { char: '-', width: 1 }
    },

    // ═════════════════════════════════════════════
    // ITEMS TABLE
    // ═════════════════════════════════════════════
    {
      type: 'table',
      options: {
        border: false,
        align: 'left',
        width: 1,
        columnWidth: [30, 12] // Adjust based on 58mm width (22 chars)
      },
      tableOptions: [
        { align: 'left', width: 0.5 },
        { align: 'right', width: 0.5 }
      ],
      rows: [
        ['Item', 'Price'],
        ...((receiptData.items || []).map(item => [
          truncateString(item.product_name || item.name || '', 22),
          `$${((item.subtotal || item.quantity * item.selling_price || item.price) || 0).toFixed(2)}`
        ]))
      ]
    },

    {
      type: 'divider',
      options: { char: '-', width: 1 }
    },

    // ═════════════════════════════════════════════
    // TOTALS
    // ═════════════════════════════════════════════
    {
      type: 'text',
      value: `Subtotal: $${(receiptData.subtotal || 0).toFixed(2)}`,
      options: { align: 'right' }
    },

    ...(receiptData.tax && receiptData.tax > 0
      ? [
          {
            type: 'text',
            value: `Tax: $${receiptData.tax.toFixed(2)}`,
            options: { align: 'right' }
          }
        ]
      : []),

    {
      type: 'text',
      value: `TOTAL: $${(receiptData.total || 0).toFixed(2)}`,
      options: {
        align: 'right',
        bold: true,
        fontSize: 14
      }
    },

    {
      type: 'text',
      value: `Payment: ${receiptData.payment_method || 'USD Cash'}`,
      options: { align: 'center' }
    },

    ...(receiptData.cash_tendered !== undefined
      ? [
          {
            type: 'text',
            value: `Cash Tendered: $${receiptData.cash_tendered.toFixed(2)}`,
            options: { align: 'right' }
          }
        ]
      : []),

    ...(receiptData.change_given !== undefined
      ? [
          {
            type: 'text',
            value: `CHANGE: $${receiptData.change_given.toFixed(2)}`,
            options: {
              align: 'right',
              bold: true
            }
          }
        ]
      : []),

    {
      type: 'divider',
      options: { char: '-', width: 1 }
    },

    // ═════════════════════════════════════════════
    // FOOTER
    // ═════════════════════════════════════════════
    {
      type: 'text',
      value: `Thank you for shopping with ${shopInfo.name || 'STOCKA SHOP'}!`,
      options: { align: 'center' }
    },
    {
      type: 'text',
      value: 'Powered by Stocka',
      options: { align: 'center', fontSize: 10 }
    },

    // Paper feed and cut
    {
      type: 'text',
      value: '\n\n\n',
      options: { align: 'center' }
    }
  ]

  return receipt
}

/**
 * Format receipt data with barcode support
 * Adds a barcode to the receipt if receipt_number is provided
 * @param {Object} receiptData - Receipt data
 * @param {Object} shopInfo - Shop info
 * @param {boolean} isDuplicate - Is reprint
 * @returns {Array} Receipt with barcode
 */
export const formatReceiptWithBarcode = (receiptData, shopInfo = {}, isDuplicate = false) => {
  const baseReceipt = formatReceiptForPosPrinter(receiptData, shopInfo, isDuplicate)

  // Insert barcode after receipt number
  const insertIndex = baseReceipt.findIndex(item => item.value?.includes('Receipt No'))
  if (insertIndex !== -1 && receiptData.receipt_number) {
    baseReceipt.splice(insertIndex + 1, 0, {
      type: 'barCode',
      value: receiptData.receipt_number.replace(/[^0-9]/g, ''), // Remove non-numeric chars
      options: {
        format: 'CODE128',
        width: 2,
        height: 60,
        displayValue: true
      }
    })
  }

  return baseReceipt
}

/**
 * Truncate string to max length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
const truncateString = (str, maxLength) => {
  if (!str) return ''
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 3) + '...'
}

/**
 * Format item for receipt (helper)
 * @param {Object} item - Item object
 * @returns {Array} Formatted row for table
 */
export const formatItemRow = (item) => {
  const name = truncateString(item.product_name || item.name || '', 16)
  const quantity = item.quantity || 1
  const price = item.selling_price || item.price || 0
  const total = item.subtotal || quantity * price

  return [
    `${name} x${quantity}`,
    `$${total.toFixed(2)}`
  ]
}
