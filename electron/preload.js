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
     * Print a receipt using PosPrinter (PRIMARY METHOD)
     * @param {Array} receiptData - Array of print objects
     * @param {string} printerName - Printer name (optional, auto-detects if not provided)
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    printReceipt: (receiptData, printerName = '') =>
      ipcRenderer.invoke('printer:print-pos', printerName || '', receiptData),

    /**
     * Scan for available Windows printers
     * @returns {Promise<{success: boolean, printers: Array, error?: string}>}
     */
    scan: () => ipcRenderer.invoke('printer:scan'),

    /**
     * Scan for available COM ports (for Bluetooth/Serial printers)
     * @returns {Promise<{success: boolean, ports: Array, count: number}>}
     */
    scanComPorts: () => ipcRenderer.invoke('printer:scan-com'),

    /**
     * Test print to verify connection
     * @param {string} printerPort - The printer port to test
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    test: (printerPort) => ipcRenderer.invoke('printer:test', printerPort),

    /**
     * Print a receipt (legacy Windows printer method)
     * @param {string} printerPort - The printer port
     * @param {Object} receiptData - Receipt information
     * @param {Object} shopInfo - Shop information
     * @param {boolean} isDuplicate - Whether this is a reprint
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    printLegacy: (printerPort, receiptData, shopInfo, isDuplicate = false) =>
      ipcRenderer.invoke('printer:print-receipt', printerPort, receiptData, shopInfo, isDuplicate),

    /**
     * Print via Bluetooth/COM port using SerialPort (legacy)
     * @param {string} portPath - COM port path (e.g., 'COM3')
     * @param {Object} receiptData - Receipt data with storeName, items, subtotal, tax, total, cashier, date
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    printBluetooth: (portPath, receiptData) =>
      ipcRenderer.invoke('printer:print-bluetooth', portPath, receiptData),

    /**
     * Get saved printer settings
     * @returns {Promise<{printer_name: string, printer_port: string, auto_print: boolean, print_duplicate: boolean}>}
     */
    getSettings: () => ipcRenderer.invoke('printer:get-settings')
  }
})