/**
 * useReceiptPrinter Hook
 * Prints receipts via Windows printer name → node-printer → raw ESC/POS
 * Works with any Bluetooth thermal printer paired and installed on Windows
 */
import { useState, useCallback } from 'react'
import { parseDbDate } from '../utils/salesDay'

export const DEFAULT_PRINTER_NAME = '' // Empty = user must configure in Settings

/**
 * @deprecated Only used by legacy COM port path. New code uses printByName directly.
 */
export function mapReceiptToBluetoothPayload(receiptData, shopInfo = {}, options = {}) {
  const { isDuplicate = false } = options
  const storeName = (shopInfo?.name || 'STOCKA SHOP').trim()
  const dateStr = receiptData.date ||
    (receiptData.created_at ? parseDbDate(receiptData.created_at).toLocaleString() : new Date().toLocaleString())

  const items = (receiptData.items || []).map((item) => ({
    name: (item.product_name || item.name || 'Item').toString(),
    price: item.subtotal !== undefined ? Number(item.subtotal) : Number(item.quantity || 1) * Number(item.selling_price ?? item.price ?? 0)
  }))

  const subtotal = receiptData.subtotal !== undefined ? Number(receiptData.subtotal)
    : items.reduce((sum, i) => sum + i.price, 0)
  const tax = Number(receiptData.tax ?? 0)
  const total = Number(receiptData.total ?? (subtotal + tax))

  return {
    storeName: isDuplicate ? `${storeName} (REPRINT)` : storeName,
    items: items.length > 0 ? items : [{ name: 'No items', price: 0 }],
    subtotal, tax, total,
    cashier: String(receiptData.cashier || 'N/A'),
    date: isDuplicate ? `REPRINT — ${dateStr}` : dateStr
  }
}

export const useReceiptPrinter = () => {
  const [isPrinting, setIsPrinting] = useState(false)
  const [printError, setPrintError] = useState(null)
  const [printSuccess, setPrintSuccess] = useState(false)

  const _setError = (msg) => {
    setPrintError(msg)
    setTimeout(() => setPrintError(null), 5000)
  }

  const _setSuccess = () => {
    setPrintSuccess(true)
    setTimeout(() => setPrintSuccess(false), 3000)
  }

  /**
   * Print receipt to Windows printer by name
   * @param {Object} receiptData
   * @param {Object} shopInfo
   * @param {Object} options
   * @param {string} options.printerName - Windows printer name e.g. "BT-58L"
   * @param {boolean} options.isDuplicate
   */
  const printReceipt = useCallback(async (receiptData, shopInfo = {}, options = {}) => {
    const { isDuplicate = false, printerName, portPath } = options

    if (!receiptData || receiptData.total === undefined) {
      _setError('Invalid receipt data')
      return false
    }

    const name = (printerName || '').trim()
    const port = (portPath || '').trim()

    // Bluetooth serial direct path: port set but no Windows printer name
    if (!name && port && window?.stocka?.btPrinter?.print) {
      try {
        setIsPrinting(true)
        setPrintError(null)
        setPrintSuccess(false)
        const result = await window.stocka.btPrinter.print(port, receiptData, shopInfo || {}, isDuplicate)
        if (!result?.success) throw new Error(result?.error || 'Bluetooth print failed')
        _setSuccess()
        return true
      } catch (error) {
        _setError(error.message || 'Bluetooth print failed')
        return false
      } finally {
        setIsPrinting(false)
      }
    }

    // Windows printer by name (WinSpool) path
    if (!name) {
      _setError('No printer configured. Go to Settings → Printer Settings, scan for printers, select yours, and save.')
      return false
    }

    if (!window?.stocka?.printer?.printByName) {
      _setError('Printer API not available')
      return false
    }

    try {
      setIsPrinting(true)
      setPrintError(null)
      setPrintSuccess(false)

      const result = await window.stocka.printer.printByName(name, receiptData, shopInfo || {}, isDuplicate)

      if (!result?.success) {
        throw new Error(result?.error || 'Print failed with no error message')
      }

      _setSuccess()
      return true
    } catch (error) {
      _setError(error.message || 'Failed to print receipt')
      return false
    } finally {
      setIsPrinting(false)
    }
  }, [])

  /**
   * Print test receipt
   * @param {string} printerName - Windows printer name e.g. "BT-58L"
   */
  const printTestReceipt = useCallback(async (printerName = '') => {
    if (!printerName.trim()) {
      _setError('No printer name provided for test print')
      return false
    }
    if (!window?.stocka?.printer?.testByName) {
      _setError('testByName API not available')
      return false
    }
    try {
      setIsPrinting(true)
      const result = await window.stocka.printer.testByName(printerName)
      if (!result?.success) throw new Error(result?.error || 'Test print failed')
      _setSuccess()
      return true
    } catch (error) {
      _setError(error.message || 'Test print failed')
      return false
    } finally {
      setIsPrinting(false)
    }
  }, [])

  return { printReceipt, printTestReceipt, isPrinting, printError, printSuccess }
}
