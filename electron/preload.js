const { contextBridge, ipcRenderer } = require('electron')

// Expose safe APIs to React via window.stocka
contextBridge.exposeInMainWorld('stocka', {
  version: '1.0.0',
  platform: process.platform,

  printer: {
    // PRIMARY: Print receipt by Windows printer name (robust, works with any paired BT printer)
    printByName: (printerName, receiptData, shopInfo, isDuplicate = false) =>
      ipcRenderer.invoke('printer:print-by-name', printerName, receiptData, shopInfo, isDuplicate),

    // PRIMARY: Test print by Windows printer name
    testByName: (printerName) =>
      ipcRenderer.invoke('printer:test-by-name', printerName),

    // Scan Windows printers (use this to find "BT-58L")
    scan: () => ipcRenderer.invoke('printer:scan'),

    // Legacy - keep for backward compat but don't use in new code
    printBluetooth: (portPath, receiptData) =>
      ipcRenderer.invoke('printer:print-bluetooth', portPath, receiptData),
    scanComPorts: () => ipcRenderer.invoke('printer:scan-com'),
    scanCom: () => ipcRenderer.invoke('printer:scan-com'),
    test: (printerPort) => ipcRenderer.invoke('printer:test', printerPort),
    printLegacy: (printerPort, receiptData, shopInfo, isDuplicate = false) =>
      ipcRenderer.invoke('printer:print-receipt', printerPort, receiptData, shopInfo, isDuplicate),
    getSettings: () => ipcRenderer.invoke('printer:get-settings')
  }
})