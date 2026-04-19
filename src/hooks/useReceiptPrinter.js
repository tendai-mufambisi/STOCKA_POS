/**
 * useReceiptPrinter Hook
 * Handles receipt printing with error handling and loading states
 */

import { useState, useCallback } from 'react'
import { formatReceiptForPosPrinter, formatReceiptWithBarcode } from '../utils/posReceiptFormatter'

export const useReceiptPrinter = () => {
  const [isPrinting, setIsPrinting] = useState(false)
  const [printError, setPrintError] = useState(null)
  const [printSuccess, setPrintSuccess] = useState(false)

  /**
   * Print a receipt
   * @param {Object} receiptData - Receipt data with items, total, etc.
   * @param {Object} shopInfo - Shop information
   * @param {Object} options - Print options
   * @param {boolean} options.isDuplicate - Is this a reprint
   * @param {boolean} options.withBarcode - Include barcode in receipt
   * @param {string} options.printerName - Specific printer name (optional)
   * @returns {Promise<boolean>} Success status
   */
  const printReceipt = useCallback(
    async (receiptData, shopInfo = {}, options = {}) => {
      const {
        isDuplicate = false,
        withBarcode = true,
        printerName = ''
      } = options

      try {
        setIsPrinting(true)
        setPrintError(null)
        setPrintSuccess(false)

        // Validate receipt data
        if (!receiptData) {
          throw new Error('Receipt data is required')
        }

        if (receiptData.total === undefined && receiptData.total !== 0) {
          throw new Error('Receipt total is required')
        }

        // Ensure shopInfo is an object (fallback to empty object)
        const validShopInfo = shopInfo && typeof shopInfo === 'object' ? shopInfo : {}

        console.log('📋 Receipt data valid, formatting...')
        console.log('🏪 Shop info:', validShopInfo)

        // Format receipt
        let formattedReceipt
        if (withBarcode && receiptData.receipt_number) {
          formattedReceipt = formatReceiptWithBarcode(receiptData, validShopInfo, isDuplicate)
        } else {
          formattedReceipt = formatReceiptForPosPrinter(receiptData, validShopInfo, isDuplicate)
        }

        if (!Array.isArray(formattedReceipt)) {
          throw new Error('Receipt formatting failed - not an array')
        }

        console.log('📋 Formatted receipt:', formattedReceipt)

        // Check if Electron API is available
        if (typeof window === 'undefined' || !window.stocka) {
          throw new Error('Not running in Electron or stocka API not available')
        }

        if (!window.stocka.printer) {
          throw new Error('Printer API not available')
        }

        if (typeof window.stocka.printer.printReceipt !== 'function') {
          throw new Error('printReceipt function not available')
        }

        console.log('🖨️ Calling printer API...')

        // Call Electron API with proper error handling
        const result = await window.stocka.printer.printReceipt(formattedReceipt, printerName)

        console.log('📨 Printer response:', result)

        if (!result) {
          throw new Error('No response from printer API')
        }

        if (!result.success) {
          throw new Error(result.error || 'Print failed')
        }

        console.log('✅ Print successful:', result.message)
        setPrintSuccess(true)

        // Clear success message after 3 seconds
        setTimeout(() => setPrintSuccess(false), 3000)

        return true
      } catch (error) {
        const errorMessage = error.message || 'Failed to print receipt'
        console.error('❌ Print error:', errorMessage)
        console.error('   Full error:', error)
        setPrintError(errorMessage)

        // Clear error after 5 seconds
        setTimeout(() => setPrintError(null), 5000)

        return false
      } finally {
        setIsPrinting(false)
      }
    },
    []
  )

  /**
   * Print a test receipt
   * Useful for printer testing
   * @param {string} printerName - Specific printer name (optional)
   * @returns {Promise<boolean>} Success status
   */
  const printTestReceipt = useCallback(
    async (printerName = '') => {
      const testReceipt = {
        receipt_number: 'TEST-001',
        date: new Date().toLocaleString(),
        cashier: 'Test User',
        items: [
          { product_name: 'Test Item 1', quantity: 1, selling_price: 10.00 },
          { product_name: 'Test Item 2', quantity: 2, selling_price: 15.00 },
          { product_name: 'Test Item 3', quantity: 1, selling_price: 5.00 }
        ],
        subtotal: 45.00,
        tax: 0.00,
        total: 45.00,
        payment_method: 'Test Payment',
        cash_tendered: 50.00,
        change_given: 5.00
      }

      const testShop = {
        name: 'Test Store',
        address: '123 Test Street',
        phone: '555-1234'
      }

      return printReceipt(testReceipt, testShop, { printerName })
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
