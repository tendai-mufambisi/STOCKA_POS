/**
 * useReceiptPrinter Hook
 * Handles receipt printing via Bluetooth/COM (ESC/POS serial) with error handling and loading states
 */

import { useState, useCallback } from 'react'

/** Default serial port for Bluetooth thermal printers (e.g. BT-58L). */
export const DEFAULT_BLUETOOTH_COM_PORT = 'COM3'

/**
 * Map app receipt + shop info to the shape expected by electron/main → printerUtils ReceiptPrinter
 * @param {Object} receiptData
 * @param {Object} shopInfo
 * @param {{ isDuplicate?: boolean }} options
 */
export function mapReceiptToBluetoothPayload(receiptData, shopInfo = {}, options = {}) {
  const { isDuplicate = false } = options
  const storeName = (shopInfo.name || 'STOCKA SHOP').trim() || 'STOCKA SHOP'

  const dateStr =
    receiptData.date ||
    (receiptData.created_at ? new Date(receiptData.created_at).toLocaleString() : new Date().toLocaleString())

  const items = receiptData.items || []
  const mappedItems = items.map((item) => {
    const name = (item.product_name || item.name || 'Item').toString()
    const lineTotal =
      item.subtotal !== undefined && item.subtotal !== null
        ? Number(item.subtotal)
        : Number(item.quantity || 1) * Number(item.selling_price ?? item.price ?? 0)
    return { name, price: lineTotal }
  })

  const computedSubtotal = mappedItems.reduce((sum, row) => sum + (Number.isFinite(row.price) ? row.price : 0), 0)
  const subtotal =
    receiptData.subtotal !== undefined && receiptData.subtotal !== null
      ? Number(receiptData.subtotal)
      : computedSubtotal

  const tax = receiptData.tax !== undefined && receiptData.tax !== null ? Number(receiptData.tax) : 0
  const total = receiptData.total !== undefined && receiptData.total !== null ? Number(receiptData.total) : subtotal + tax

  let header = storeName
  if (isDuplicate) {
    header = `${storeName} (REPRINT)`
  }

  return {
    storeName: header,
    items: mappedItems.length > 0 ? mappedItems : [{ name: 'No items', price: 0 }],
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    tax: Number.isFinite(tax) ? tax : 0,
    total: Number.isFinite(total) ? total : 0,
    cashier: (receiptData.cashier || 'N/A').toString(),
    date: isDuplicate ? `REPRINT — ${dateStr}` : dateStr
  }
}

export const useReceiptPrinter = () => {
  const [isPrinting, setIsPrinting] = useState(false)
  const [printError, setPrintError] = useState(null)
  const [printSuccess, setPrintSuccess] = useState(false)

  /**
   * Print a receipt over serial (ESC/POS)
   * @param {Object} receiptData - Receipt data with items, total, etc.
   * @param {Object} shopInfo - Shop information
   * @param {Object} options
   * @param {boolean} options.isDuplicate - Reprint
   * @param {string} options.portPath - COM port (default COM3)
   */
  const printReceipt = useCallback(async (receiptData, shopInfo = {}, options = {}) => {
    const { isDuplicate = false, portPath = DEFAULT_BLUETOOTH_COM_PORT } = options

    try {
      setIsPrinting(true)
      setPrintError(null)
      setPrintSuccess(false)

      if (!receiptData) {
        throw new Error('Receipt data is required')
      }

      if (receiptData.total === undefined || receiptData.total === null) {
        throw new Error('Receipt total is required')
      }

      const validShopInfo = shopInfo && typeof shopInfo === 'object' ? shopInfo : {}

      const payload = mapReceiptToBluetoothPayload(receiptData, validShopInfo, { isDuplicate })

      if (typeof window === 'undefined' || !window.stocka) {
        throw new Error('Not running in Electron or stocka API not available')
      }

      if (!window.stocka.printer) {
        throw new Error('Printer API not available')
      }

      if (typeof window.stocka.printer.printBluetooth !== 'function') {
        throw new Error('printBluetooth is not available')
      }

      const path = (portPath && String(portPath).trim()) || DEFAULT_BLUETOOTH_COM_PORT

      const result = await window.stocka.printer.printBluetooth(path, payload)

      if (!result) {
        throw new Error('No response from printer API')
      }

      if (!result.success) {
        throw new Error(result.error || 'Print failed')
      }

      setPrintSuccess(true)
      setTimeout(() => setPrintSuccess(false), 3000)

      return true
    } catch (error) {
      const errorMessage = error.message || 'Failed to print receipt'
      console.error('Print error:', errorMessage, error)
      setPrintError(errorMessage)
      setTimeout(() => setPrintError(null), 5000)
      return false
    } finally {
      setIsPrinting(false)
    }
  }, [])

  /**
   * Print a test receipt (Bluetooth/COM)
   * @param {string} portPath - COM port (default COM3)
   */
  const printTestReceipt = useCallback(
    async (portPath = DEFAULT_BLUETOOTH_COM_PORT) => {
      const testReceipt = {
        receipt_number: 'TEST-001',
        date: new Date().toLocaleString(),
        cashier: 'Test User',
        items: [
          { product_name: 'Test Item 1', quantity: 1, selling_price: 10.0, subtotal: 10.0 },
          { product_name: 'Test Item 2', quantity: 2, selling_price: 15.0, subtotal: 30.0 },
          { product_name: 'Test Item 3', quantity: 1, selling_price: 5.0, subtotal: 5.0 }
        ],
        subtotal: 45.0,
        tax: 0.0,
        total: 45.0,
        payment_method: 'Test Payment',
        cash_tendered: 50.0,
        change_given: 5.0
      }

      const testShop = {
        name: 'Test Store',
        address: '123 Test Street',
        phone: '555-1234'
      }

      return printReceipt(testReceipt, testShop, { portPath, isDuplicate: false })
    },
    [printReceipt]
  )

  return {
    printReceipt,
    printTestReceipt,
    isPrinting,
    printError,
    printSuccess
  }
}
