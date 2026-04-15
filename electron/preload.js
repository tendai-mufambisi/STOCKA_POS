const { contextBridge, ipcRenderer } = require('electron')

// Expose safe APIs to React via window.stocka
contextBridge.exposeInMainWorld('stocka', {
  version: '1.0.0',
  platform: process.platform,

  // ══════════════════════════════════════════════════════════
  // PRINTER APIs
  // ══════════════════════════════════════════════════════════
  printer: {
    /**
     * Scan for available printers
     * @returns {Promise<{success: boolean, printers: Array, error?: string}>}
     */
    scan: () => ipcRenderer.invoke('printer:scan'),

    /**
     * Test print to verify connection
     * @param {string} printerPort - The printer port to test
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    test: (printerPort) => ipcRenderer.invoke('printer:test', printerPort),

    /**
     * Print a receipt
     * @param {string} printerPort - The printer port
     * @param {Object} receiptData - Receipt information
     * @param {Object} shopInfo - Shop information
     * @param {boolean} isDuplicate - Whether this is a reprint
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    printReceipt: (printerPort, receiptData, shopInfo, isDuplicate = false) =>
      ipcRenderer.invoke('printer:print-receipt', printerPort, receiptData, shopInfo, isDuplicate),

    /**
     * Get saved printer settings
     * @returns {Promise<{printer_name: string, printer_port: string, auto_print: boolean, print_duplicate: boolean}>}
     */
    getSettings: () => ipcRenderer.invoke('printer:get-settings')
  }
})