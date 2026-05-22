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
  },

  license: {
    check:    ()    => ipcRenderer.invoke('license:check'),
    activate: (key) => ipcRenderer.invoke('license:activate', key),
    getInfo:  ()    => ipcRenderer.invoke('license:get-info'),
  },

  updater: {
    onUpdateAvailable:  (cb) => ipcRenderer.on('updater:update-available',  (_, info) => cb(info)),
    onDownloadProgress: (cb) => ipcRenderer.on('updater:download-progress', (_, info) => cb(info)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('updater:update-downloaded', ()       => cb()),
    download:  () => ipcRenderer.invoke('updater:download'),
    install:   () => ipcRenderer.invoke('updater:install'),
    checkNow:  () => ipcRenderer.invoke('updater:check'),
  },

  db: {
    load:                    ()           => ipcRenderer.invoke('db:load'),
    save:                    (base64)     => ipcRenderer.invoke('db:save', base64),
    backup:                  ()           => ipcRenderer.invoke('db:backup'),
    listBackups:             ()           => ipcRenderer.invoke('db:list-backups'),
    restore:                 (filename)   => ipcRenderer.invoke('db:restore', filename),
    getPaths:                ()           => ipcRenderer.invoke('db:get-paths'),
    exportFile:              (destPath)   => ipcRenderer.invoke('db:export-file', destPath),
    migrateFromLocalStorage: (base64)     => ipcRenderer.invoke('db:migrate-from-localstorage', base64),
    getMeta:                 ()           => ipcRenderer.invoke('db:get-meta'),
    setMeta:                 (meta)       => ipcRenderer.invoke('db:set-meta', meta),
    loadBackup:              (filename)   => ipcRenderer.invoke('db:load-backup', filename),
  }
})