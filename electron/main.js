/** @typedef {import('@serialport/bindings-interface').PortInfo} PortInfo */
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
// @plick/electron-pos-printer is incompatible with Electron 29 (sandbox defaults break its renderer IPC)
// We use Electron's native webContents.print() directly instead.
const logger = require('./logger')
const { verifyLicense, saveLicense, loadLicense, getRawKey } = require('./license')
const { initDb, saveDb, closeDb } = require('./database/index')
const { createTables, runMigrations, ensureIndexes } = require('./database/schema')
const { registerAll: registerDomainIpc } = require('./database/ipc')
const backupEngine = require('./database/backupEngine')
const externalBackup = require('./database/externalBackup')
const offsiteBackup = require('./database/offsiteBackup')
const { initLan } = require('./lan/index')
const backgroundServer = require('./backgroundServer')
const dayRollover = require('./dayRollover')
const btPrinter = require('./printer')

// Set userData path before app is ready (must be first)
const userDataPath = path.join(process.env.APPDATA || process.env.HOME, 'Stocka')
app.setPath('userData', userDataPath)

// Register stocka:// custom protocol so Google OAuth can redirect back into the app
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient('stocka', process.execPath, [path.resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient('stocka')
}

logger.info('🚀 Stocka Application Starting')
logger.info(`Node Environment: ${process.env.NODE_ENV || 'production'}`)
logger.info(`User Data Path: ${userDataPath}`)

// Import ReceiptPrinter for Bluetooth/COM port printing
let ReceiptPrinter = null
try {
  ReceiptPrinter = require(path.join(app.getAppPath(), 'src', 'utils', 'printerUtils.js'))
} catch (err) {
  logger.warn('⚠️ ReceiptPrinter not available: ' + err.message)
}

// Global to store reference to main window for IPC
let mainWindow = null

function createWindow() {
  logger.info('📦 Creating BrowserWindow')
  
  // Only the restore size — what the window returns to if somebody un-maximizes it.
  // The window itself always opens maximized (see ready-to-show below).
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    title: 'Stocka',
    icon: path.join(__dirname, '..', 'src', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false
  })

  // Load Vite dev server in development, built files in production
  if (!app.isPackaged) {
    logger.info('🔧 Development mode - Loading from localhost:5173')
    // Other local dev servers share the http://localhost:5173 origin, and a PWA one
    // can leave its service worker registered here — it would then serve its own
    // cached shell instead of Stocka. Wipe those before loading.
    mainWindow.webContents.session
      .clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
      .catch((err) => logger.warn('Could not clear dev service workers', err))
      .then(() => mainWindow.loadURL('http://localhost:5173'))
    mainWindow.webContents.openDevTools()
  } else {
    logger.info('📂 Production mode - Loading from dist/index.html')
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }

  // Handle load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logger.error('❌ Failed to load page', { errorCode, errorDescription })
  })

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logger.error('💥 Renderer process gone', details)
    dialog.showErrorBox(
      'Stocka - Application Error',
      'The application encountered an error and needs to restart.\n\nIf this keeps happening, please contact support.'
    )
    app.relaunch()
    app.quit()
  })

  // On the Main Computer, closing the window hides it instead of quitting so the
  // LAN server keeps serving satellites. No-op on satellite/standalone tills.
  backgroundServer.attachWindow(mainWindow)

  // Show window when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    logger.info('✅ Window ready to show.....')
    mainWindow.maximize()
    mainWindow.show()

  })

  // Clean up on close
  mainWindow.on('closed', () => {
    logger.info('🔒 Window closed')
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  logger.info('⚡ App ready')

  // Initialize database in main process
  const dbFilePath = path.join(userDataPath, 'stocka.db')
  try {
    const db = initDb(dbFilePath)
    createTables(db)
    runMigrations(db)
    // After the migrations, so an index can never reference a column that this
    // boot was responsible for adding. Has its own internal guard.
    ensureIndexes(db)
    saveDb()
    // initLan MUST run before registerDomainIpc so CLIENT mode can inject makeHandler
    const { lanHandlers, stopLan: _stopLan, makeHandler } = initLan(userDataPath, () => mainWindow)
    registerDomainIpc(ipcMain, userDataPath, makeHandler)
    lanHandlers.forEach(([ch, fn]) => ipcMain.handle(ch, (event, ...args) => fn(event, ...args)))
    app.on('before-quit', () => _stopLan())
    // Must run after initLan so the LAN mode on disk is settled — it decides
    // whether this machine gets the tray + sleep blocker.
    backgroundServer.init(userDataPath, () => mainWindow, createWindow)
    logger.info('✅ Database ready')
    logger.info('✅ LAN subsystem ready')

    // Roll any drawer left open from a previous day onto the current one: close it
    // for the day it belongs to, give any day it swallowed a shift of its own, and
    // open a continuation carrying the cash forward. Replaces a 30-minute interval
    // that never fired while the laptop was asleep, which is how whole days ended
    // up with no shift row and their takings filed under the previous date.
    dayRollover.init(userDataPath)
    app.on('before-quit', () => dayRollover.stop())

    // Backups only became automatic here. Until now db:backup was wired to a single
    // button in Settings, while the Settings copy told the owner "automatic backups
    // run daily" — this is what makes that sentence true.
    backupEngine.init(userDataPath)
    externalBackup.init(userDataPath)
    offsiteBackup.init(userDataPath)
    // One backup shortly after startup, so a shop that is opened and closed without
    // ringing up anything still has a recent verified copy.
    if (!_shuttingDown) backupEngine.requestBackup('startup')

    // Watch for the backup drive. Plugging it in is the whole interaction — there
    // is nothing to press. Satellites are excluded: the external copy is taken on
    // the machine that holds the authoritative ledger.
    //
    // Not when this instance is already on its way out. A second copy of Stocka
    // launched while one is running loses the single-instance lock and quits, but
    // it still gets this far first — and it has no business starting a copy onto
    // the shop's USB stick moments before its database closes underneath it.
    if (!_shuttingDown && !backupEngine.isSatellite()) {
      externalBackup.startWatching((event) => {
        const win = mainWindow
        if (win && !win.isDestroyed()) win.webContents.send('backup:external-changed', event)
      })
      app.on('before-quit', () => externalBackup.stopWatching())
    }

    logger.info('✅ Backup engine ready')
  } catch (err) {
    logger.error('❌ Database init failed: ' + err.message)
    dialog.showErrorBox('Stocka - Database Error', 'Failed to initialize database: ' + err.message)
    app.quit()
    return
  }

  createWindow()
  // Delay updater 10 s so startup is not slowed down
  setTimeout(setupAutoUpdater, 10000)

  app.on('activate', () => {
    logger.info('🔄 App activated')
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  logger.info('🚪 All windows closed')
  // As Main, the window normally hides rather than closes — but if one is ever
  // destroyed outright, closing the DB here would kill the LAN server the
  // satellites are still talking to. Stay up; the tray is the way back in.
  if (backgroundServer.isActive()) {
    logger.info('[Background] Main Computer still running — use the tray icon to reopen')
    return
  }
  if (process.platform !== 'darwin') {
    // Quit rather than closing the database here: before-quit owes the shop one
    // last verified backup, and it needs the database still open to take it.
    app.quit()
  } else {
    closeDb()
  }
})

// The last thing Stocka does before it goes away is make sure the day it just
// traded is on disk in a copy that has been read back and checked. A day's takings
// should never depend on the debounce timer having happened to fire before the
// owner shut the lid.
let _shuttingDown = false
app.on('before-quit', (event) => {
  if (_shuttingDown) return
  _shuttingDown = true
  event.preventDefault()

  // A backup that hangs must not leave the shop unable to close Stocka. If it has
  // not finished in fifteen seconds we go anyway — the previous verified backup is
  // still there, and the failure is in the log.
  const deadline = new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 15000))

  logger.info('[Backup] Taking a final backup before closing')

  Promise.race([backupEngine.runBackupNow('shutdown'), deadline])
    .then(result => {
      if (result && result.timedOut) logger.warn('[Backup] Shutdown backup did not finish in time')
      else if (result && result.skipped) logger.info('[Backup] Shutdown backup skipped: ' + result.error)
      else if (result && !result.success) logger.warn('[Backup] Shutdown backup did not succeed: ' + result.error)
    })
    .catch(err => logger.error('[Backup] Shutdown backup failed: ' + err.message))
    .finally(() => {
      backupEngine.stop()
      externalBackup.stopWatching()
      try { closeDb() } catch (_) {}
      app.quit()
    })
})

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception', error)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Rejection', { reason, promise })
})

// Synchronous version query from preload
ipcMain.on('app:get-version', (event) => {
  event.returnValue = app.getVersion()
})

// ══════════════════════════════════════════════════════════
// PRINTER IPC HANDLERS - Using @plick/electron-pos-printer
// ══════════════════════════════════════════════════════════

const { printReceipt: rawPrintReceipt, printEodReport: rawPrintEodReport, buildEodReportBytes } = require('./printer-raw')

ipcMain.handle('printer:print-eod-by-name', async (event, printerName, report, shopInfo, isReprint = false) => {
  if (!printerName || typeof printerName !== 'string') {
    return { success: false, error: 'No printer configured. Go to Settings → Printer, scan and save a printer.' }
  }
  if (!report || typeof report !== 'object') {
    return { success: false, error: 'Invalid end of day report data.' }
  }
  logger.info(`🖨️ [PRINT-EOD] Printing ${report.date} report to "${printerName}"`)
  const result = await rawPrintEodReport(printerName, report, shopInfo, isReprint)
  if (result.success) logger.info('✅ [PRINT-EOD] Success')
  else logger.error('❌ [PRINT-EOD] ' + result.error)
  return result
})

ipcMain.handle('printer:print-by-name', async (event, printerName, receiptData, shopInfo, isDuplicate = false) => {
  if (!printerName || typeof printerName !== 'string') {
    return { success: false, error: 'No printer configured. Go to Settings → Printer, scan and save a printer.' }
  }
  logger.info(`🖨️ [PRINT-BY-NAME] Printing to "${printerName}"`)
  const result = await rawPrintReceipt(printerName, receiptData, shopInfo, isDuplicate)
  if (result.success) logger.info('✅ [PRINT-BY-NAME] Success')
  else logger.error('❌ [PRINT-BY-NAME] ' + result.error)
  return result
})

ipcMain.handle('printer:test-by-name', async (event, printerName) => {
  if (!printerName) return { success: false, error: 'No printer name provided' }
  const testReceipt = {
    receipt_number: 'TEST-001',
    created_at: new Date().toISOString(),
    cashier: 'Test Cashier',
    items: [
      { product_name: 'Test Item 1', quantity: 1, selling_price: 5.00, subtotal: 5.00 },
      { product_name: 'Test Item 2', quantity: 2, selling_price: 10.00, subtotal: 20.00 },
    ],
    total: 25.00, subtotal: 25.00,
    payment_method: 'Cash',
    cash_tendered: 30.00,
    change_given: 5.00,
  }
  const testShop = { name: 'Test Shop', address: '123 Test St', phone: '+263 000 000 000', currency: 'USD' }
  logger.info(`🖨️ [TEST-PRINT] Sending test receipt to "${printerName}"`)
  const result = rawPrintReceipt(printerName, testReceipt, testShop, false)
  if (result.success) logger.info('✅ [TEST-PRINT] Success')
  else logger.error('❌ [TEST-PRINT] ' + result.error)
  return result
})

/**
 * Scan for available Windows printers (thermal receipt printers)
 * Uses node-printer (native binding) for reliable enumeration
 */
// Windows virtual/software printers that are never physical receipt printers
const VIRTUAL_PRINTER_PATTERNS = [
  /microsoft print to pdf/i,
  /microsoft xps document writer/i,
  /xps/i,
  /fax/i,
  /onenote/i,
  /send to onenote/i,
  /adobe pdf/i,
  /adobe acrobat/i,
  /cutepdf/i,
  /dopdf/i,
  /bullzip/i,
  /pdf creator/i,
  /foxit/i,
  /nitro pdf/i,
  /pdf24/i,
  /primopdf/i,
  /snagit/i,
  /camtasia/i,
  /docuware/i,
  /imagewriter/i,
  /generic.*text/i,
  /print to file/i,
  /wps pdf/i,
  /sumatra/i,
  /\\\\[^\\]+\\\\/,  // UNC network printer \\server\printer
]

function isVirtualPrinter(name) {
  return VIRTUAL_PRINTER_PATTERNS.some(pattern => pattern.test(name))
}

// Detects Windows duplicate-install suffixes: "POS-58 (1)", "POS-58(copy of 3)"
const DUPLICATE_SUFFIX = /(\s*\(\d+\)|\s*\(copy of \d+\))$/i

function isDuplicatePrinter(name) {
  return DUPLICATE_SUFFIX.test(name)
}

function basePrinterName(name) {
  return name.replace(DUPLICATE_SUFFIX, '').trim()
}

function tagPrinters(names, extraProps, srcList) {
  // Track which base names already have a "primary" entry
  const seenBase = new Set()

  return names.map((name, i) => {
    const extra = srcList ? extraProps(srcList[i]) : extraProps()
    const isDuplicate = isDuplicatePrinter(name)
    const base = basePrinterName(name)
    let isDuplicateOf = null

    if (isDuplicate) {
      isDuplicateOf = base
    } else {
      seenBase.add(base)
    }

    return {
      name,
      port: name,
      type: 'windows_printer',
      isVirtual: isVirtualPrinter(name),
      isDuplicate,
      isDuplicateOf,
      ...extra
    }
  }).sort((a, b) => {
    // Order: physical originals → physical duplicates → virtual
    if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1
    if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? 1 : -1
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return 0
  })
}

ipcMain.handle('printer:scan', async () => {
  try {
    logger.info('🖨️ Scanning for available printers via Electron getPrintersAsync')
    if (!mainWindow) return { success: false, error: 'App window not ready', printers: [], count: 0 }

    const list = await mainWindow.webContents.getPrintersAsync()
    logger.info(`✅ Electron found ${list.length} printer(s): ${list.map(p => p.name).join(', ')}`)

    const all = list.map(p => ({
      name: p.name,
      port: p.name,
      type: 'windows_printer',
      isDefault: p.isDefault || false,
      isVirtual: isVirtualPrinter(p.name),
      isDuplicate: isDuplicatePrinter(p.name),
      status: p.status,
    })).sort((a, b) => {
      if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1
      if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? 1 : -1
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return 0
    })

    return { success: true, printers: all, count: all.length }
  } catch (error) {
    logger.error('❌ Printer scan fatal error: ' + error.message)
    return { success: false, error: error.message, printers: [], count: 0 }
  }
})

/**
 * Scan for COM ports (alternative to Windows printer scan)
 * Useful for direct Bluetooth/Serial printers
 */
ipcMain.handle('printer:scan-com', async () => {
  try {
    logger.info('🖨️ [COM SCAN] Scanning for available COM ports')
    
    // Try to use SerialPort to list available ports
    let ports = []
    
    try {
      if (ReceiptPrinter && typeof ReceiptPrinter === 'function') {
        // If SerialPort is available, use it
        const { SerialPort } = require('serialport')
        ports = await SerialPort.list()
      }
    } catch (err) {
      logger.warn('⚠️ SerialPort not available')
    }
    
    // If no ports found, return error instead of fake ports
    if (ports.length === 0) {
      logger.warn('🚩 No COM ports detected')
      return {
        success: false,
        error: 'SerialPort is not available. Cannot scan COM ports. Please configure your printer manually in Settings.',
        ports: [],
        count: 0
      }
    }
    
    logger.info(`✅ Found ${ports.length} COM port(s)`)
    
    return {
      success: true,
      ports: ports.map(p => ({
        path: p.path,
        name: `${p.path} (${p.manufacturer || 'Unknown'})`,
        type: 'com_port'
      })),
      count: ports.length
    }
  } catch (error) {
    logger.error('❌ COM port scan error: ' + error.message)
    return {
      success: false,
      error: error.message,
      ports: [],
      count: 0
    }
  }
})

/**
 * Test print - send test receipt to printer
 */
ipcMain.handle('printer:test', async (event, printerName) => {
  try {
    if (!printerName) {
      return {
        success: false,
        error: 'No printer specified. Please select a printer or scan for printers.'
      }
    }

    logger.info(`🞨 [TEST PRINT] Sending test receipt to ${printerName}`)

    // Generate a simple test receipt
    const testReceipt = {
      receipt_number: 'TEST-001',
      created_at: new Date().toISOString(),
      items: [
        { product_name: 'Test Item 1', quantity: 1, selling_price: 10.00 },
        { product_name: 'Test Item 2', quantity: 2, selling_price: 15.00 }
      ],
      total: 40.00,
      payment_method: 'Test Print',
      cash_tendered: 50.00,
      change_given: 10.00
    }

    const testShopInfo = {
      name: 'Test Shop',
      address: '123 Test Street',
      phone: '+1-234-567-8900'
    }

    // Use the same print mechanism as regular receipts
    return await sendToWindowsPrinter(printerName, generateReceiptCommands(testReceipt, testShopInfo, false))
  } catch (error) {
    logger.error('[TEST PRINT] Test print error: ' + error.message)
    return {
      success: false,
      error: error.message || 'Test print failed'
    }
  }
})

/**
 * Send receipt to thermal printer via Windows Print API
 * Uses printer name (Windows printer) instead of COM port
 */
ipcMain.handle('printer:print-receipt', async (event, printerName, receiptData, shopInfo, isDuplicate = false) => {
  try {
    // Input validation
    if (typeof printerName !== 'string' || printerName.length > 200) {
      return { success: false, error: 'Invalid printer name.' }
    }
    if (!receiptData || typeof receiptData !== 'object') {
      return { success: false, error: 'Invalid receipt data.' }
    }

    if (!printerName) {
      return {
        success: false,
        error: 'No printer configured. Please set up printer in Settings, then try again.'
      }
    }

    // Generate ESC/POS commands for receipt
    const escposCommands = generateReceiptCommands(receiptData, shopInfo, isDuplicate)
    
    logger.info(`🖨️ [PRINTER] Printing receipt "${receiptData.receipt_number}" to ${printerName}`)
    logger.info(`📊 [PRINTER] ESC/POS buffer size: ${escposCommands.length} bytes`)

    // Try to print with up to 2 retries if busy
    let lastError = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await sendToWindowsPrinter(printerName, escposCommands)
        if (result.success) {
          logger.info(`✅ [PRINTER] Print succeeded on attempt ${attempt}`)
          return result
        } else {
          lastError = result.error
          if (attempt < 2) {
            logger.warn(`⚠️ [PRINTER] Attempt ${attempt} failed, retrying...`)
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        }
      } catch (err) {
        lastError = err.message
        if (attempt < 2) {
          logger.warn(`⚠️ [PRINTER] Attempt ${attempt} error, retrying...`)
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    }

    logger.error(`❌ [PRINTER] Failed after 2 attempts: ${lastError}`)
    return {
      success: false,
      error: lastError || 'Failed to print after multiple attempts'
    }

  } catch (error) {
    logger.error('❌ [PRINTER] Critical error: ' + (error.message || String(error)))
    return {
      success: false,
      error: error.message || 'Failed to print receipt'
    }
  }
})

/**
 * Send raw ESC/POS bytes to a Windows printer.
 *
 * Strategy:
 *  1. Look up the printer's port via WMI.
 *  2. COM port (Bluetooth SPP) → write directly with System.IO.Ports.SerialPort.
 *     No Add-Type / C# compilation needed; SerialPort is part of .NET Framework.
 *  3. USB / other port → use WinSpool P/Invoke (Add-Type) with the corrected
 *     DOCINFO as a struct + ref, which avoids the "startdoc:1905" issue.
 */
async function sendToWindowsPrinter(printerName, escposCommands) {
  const { execFile } = require('child_process')
  const fsSync = require('fs')
  const os = require('os')
  const p = require('path')

  return new Promise((resolve) => {
    const stamp = Date.now()
    const dataFile   = p.join(os.tmpdir(), `receipt-${stamp}.prn`)
    const scriptFile = p.join(os.tmpdir(), `rawprint-${stamp}.ps1`)

    const cleanup = () => {
      try { fsSync.unlinkSync(dataFile)   } catch (_) {}
      try { fsSync.unlinkSync(scriptFile) } catch (_) {}
    }

    // No here-strings, no Add-Type, no quote escaping — just plain PowerShell.
    // For Bluetooth printers Windows assigns a COM port; we write to it directly
    // via System.IO.Ports.SerialPort (built into .NET Framework, always available).
    const scriptLines = [
      'param([string]$PrinterName, [string]$DataFile)',
      '$prn = Get-WmiObject Win32_Printer | Where-Object { $_.Name -eq $PrinterName } | Select-Object -First 1',
      'if (-not $prn) { Write-Host "ERROR:notfound:Printer not found in Windows"; exit 1 }',
      '$port = ($prn.PortName -replace ":", "").Trim()',
      'Write-Host "INFO:port:$port"',
      '$bytes = [IO.File]::ReadAllBytes($DataFile)',
      'if ($port -match "^COM[0-9]+$") {',
      '    try {',
      '        $sp = New-Object System.IO.Ports.SerialPort $port, 9600',
      '        $sp.WriteTimeout = 12000',
      '        $sp.Open()',
      '        $sp.Write($bytes, 0, $bytes.Length)',
      '        Start-Sleep -Milliseconds 1000',
      '        $sp.Close()',
      '        Write-Host "SUCCESS:$($bytes.Length)"',
      '    } catch {',
      '        Write-Host "ERROR:com:$($_.Exception.Message)"',
      '        exit 1',
      '    }',
      '} else {',
      '    Write-Host "ERROR:notcom:$port"',
      '    exit 1',
      '}',
    ]
    const script = scriptLines.join('\r\n')

    logger.info(`🖨️ [PRINTER] → "${printerName}" (${escposCommands.length} bytes)`)

    fsSync.writeFile(dataFile, escposCommands, (e1) => {
      if (e1) return resolve({ success: false, error: 'Write data file: ' + e1.message })

      fsSync.writeFile(scriptFile, script, 'utf8', (e2) => {
        if (e2) { cleanup(); return resolve({ success: false, error: 'Write script: ' + e2.message }) }

        execFile('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', scriptFile,
          '-PrinterName', printerName,
          '-DataFile', dataFile
        ], { timeout: 20000 }, (err, stdout, stderr) => {
          cleanup()

          const lines = (stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
          const se    = (stderr || '').trim()

          const portLine    = lines.find(l => l.startsWith('INFO:port:'))
          const successLine = lines.find(l => l.startsWith('SUCCESS'))
          const errorLine   = lines.find(l => l.startsWith('ERROR:'))

          if (portLine) logger.info(`🖨️ [PRINTER] Port: ${portLine.replace('INFO:port:', '')}`)
          lines.filter(l => l.startsWith('INFO:')).forEach(l => logger.info(`🖨️ [PRINTER] ${l}`))
          logger.info(`🖨️ [PRINTER] stdout lines: ${JSON.stringify(lines)}`)
          if (se) logger.warn(`⚠️ [PRINTER] stderr: ${se}`)

          if (successLine) {
            return resolve({ success: true, message: 'Receipt printed successfully' })
          }

          if (errorLine) {
            const parts = errorLine.split(':')
            const kind  = parts[1]
            const rest  = parts.slice(2).join(':')
            let msg = errorLine
            if (kind === 'notfound') {
              msg = `Printer "${printerName}" not found. Check the name in Settings matches exactly what appears in Devices & Printers.`
            } else if (kind === 'com') {
              msg = `COM port error: ${rest}. The printer may be off, out of Bluetooth range, or the port is in use by another app.`
            } else if (kind === 'winspool') {
              msg = `Raw print failed for "${printerName}": ${rest}`
            } else if (kind === 'notcom') {
              msg = `Printer "${printerName}" uses port "${rest}", not a COM port. ` +
                'Bluetooth printers must be paired and show a COM port in Devices & Printers.'
            }
            logger.error(`❌ [PRINTER] ${errorLine}`)
            return resolve({ success: false, error: msg })
          }

          // Script crashed entirely — no recognisable output
          const detail = se || (err ? err.message : '') || 'No output'
          logger.error(`❌ [PRINTER] Script crashed: ${detail}`)
          resolve({ success: false, error: 'Print script error: ' + detail })
        })
      })
    })
  })
}

/**
 * Get saved printer settings
 */
ipcMain.handle('printer:get-settings', async () => {
  return {
    printer_name: null,
    auto_print: true,
    print_duplicate: false
  }
})

/**
 * Print using @plick/electron-pos-printer (PRIMARY METHOD)
 * Robust, reliable printing to any system printer including Bluetooth
 * @param {string} printerName - Name of the printer (auto-detects if not provided)
 * @param {Array} receiptData - Array of print objects (text, table, barCode, etc.)
 */
ipcMain.handle('printer:print-pos', async (event, printerName, receiptData) => {
  try {
    // Input validation
    if (!Array.isArray(receiptData) || receiptData.length === 0) {
      return { success: false, error: 'Receipt data must be a non-empty array.' }
    }

    if (!receiptData || !Array.isArray(receiptData)) {
      logger.warn('Invalid receipt data - expected array')
      return {
        success: false,
        error: 'Invalid receipt data. Expected array of print objects.'
      }
    }

    if (receiptData.length === 0) {
      logger.warn('Receipt data is empty')
      return {
        success: false,
        error: 'Receipt is empty. Nothing to print.'
      }
    }

    logger.info('🖨️ Printing receipt', {
      printer: printerName || 'Default (auto-detect)',
      items: receiptData.length
    })

    // Configure printer options
    const printOptions = {
      preview: false,
      silent: true,
      width: 58, // 2-inch printer width (58mm = ~22 characters)
      margin: '0 0 0 0'
    }

    // Add printer name if specified and non-empty
    if (printerName && typeof printerName === 'string' && printerName.trim()) {
      printOptions.printerName = printerName.trim()
    }

    // Execute print with timeout to prevent hanging
    const printPromise = PosPrinter.print(receiptData, printOptions)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Print operation timed out after 10 seconds')), 10000)
    )

    await Promise.race([printPromise, timeoutPromise])

    logger.info('✅ Receipt printed successfully')
    return {
      success: true,
      message: 'Receipt printed successfully'
    }
  } catch (error) {
    const errorMessage = error?.message || String(error) || 'Unknown error'
    logger.error('Print error', errorMessage)
    
    // Provide helpful error messages
    let userMessage = errorMessage
    
    // Detect specific errors and provide guidance
    if (errorMessage.includes('Convert undefined or null')) {
      userMessage = 'No printer configured. Please go to Settings and configure your printer name, or ensure at least one printer is installed on your system.'
    } else if (errorMessage.includes('Printer not found')) {
      userMessage = 'Printer not found. Please check the printer name in Settings and verify the printer is installed.'
    } else if (errorMessage.includes('timeout')) {
      userMessage = 'Printing timed out. Please check printer connection and try again.'
    } else if (errorMessage.includes('access') || errorMessage.includes('permission')) {
      userMessage = 'Permission denied. Please check printer access or try running the app as administrator.'
    } else if (errorMessage.includes('not installed') || errorMessage.includes('not available')) {
      userMessage = 'Printer driver may not be installed properly. Please reinstall your printer driver.'
    }

    return {
      success: false,
      error: userMessage,
      details: errorMessage
    }
  }
})

/**
 * Print via Bluetooth/COM port using SerialPort
 * Alternative method for 2-inch Bluetooth thermal printers
 */
ipcMain.handle('printer:print-bluetooth', async (event, portPath, receiptData) => {
  try {
    if (!ReceiptPrinter) {
      return {
        success: false,
        error: 'ReceiptPrinter not available. SerialPort may not be installed.'
      }
    }

    if (!portPath) {
      return {
        success: false,
        error: 'No COM port specified'
      }
    }

    console.log(`🖨️ [BLUETOOTH] Printing to ${portPath}`)

    const printerDevice = new ReceiptPrinter(portPath, 9600)
    await printerDevice.printReceipt(receiptData)
    printerDevice.disconnect()

    return {
      success: true,
      message: 'Receipt printed successfully via Bluetooth'
    }
  } catch (error) {
    logger.error('[BLUETOOTH] Print error: ' + (error.message || String(error)))
    return {
      success: false,
      error: error.message || 'Failed to print via Bluetooth'
    }
  }
})

/**
 * Generate ESC/POS commands for receipt
 * This creates the binary commands needed for thermal receipt printers
 */
function generateReceiptCommands(receipt, shopInfo, isDuplicate = false) {
  const ESC = '\x1B'
  const GS = '\x1D'
  const DIVIDER = '-'.repeat(32) + '\n'
  const commands = []

  // Initialize printer
  commands.push(ESC + '@')

  // Select font
  commands.push(ESC + '!' + String.fromCharCode(0x08))

  // Center alignment
  commands.push(ESC + 'a' + String.fromCharCode(1))

  // Shop name - Large, emphasized
  commands.push(ESC + 'E' + String.fromCharCode(1))
  commands.push(ESC + '!' + String.fromCharCode(0x38))
  commands.push((shopInfo.name || 'STOCKA SHOP') + '\n')
  commands.push(ESC + 'E' + String.fromCharCode(0))
  commands.push(ESC + '!' + String.fromCharCode(0))

  // Shop address
  commands.push((shopInfo.address || 'Address not set') + '\n')
  
  // Shop phone
  commands.push((shopInfo.phone || 'Phone not set') + '\n')

  // Divider line
  commands.push(DIVIDER)

  // Left align for details
  commands.push(ESC + 'a' + String.fromCharCode(0))

  // Sale info — DB timestamps are UTC without a zone marker; force UTC so the
  // printed time is Zimbabwe local, not two hours in the past
  const rawDate = String(receipt.created_at || '')
  const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(rawDate)
    ? new Date(rawDate.replace(' ', 'T') + 'Z')
    : new Date(receipt.created_at || new Date())
  commands.push(`Date: ${formatDate(date)}  Time: ${formatTime(date)}\n`)
  commands.push(`Receipt No: ${receipt.receipt_number || 'N/A'}\n`)
  commands.push(`Cashier: ${receipt.cashier || 'N/A'}\n`)

  // Reprint watermark
  if (isDuplicate) {
    commands.push(ESC + 'a' + String.fromCharCode(1)) // Center
    commands.push(ESC + 'E' + String.fromCharCode(1)) // Emphasized
    commands.push('** REPRINT **\n')
    commands.push(ESC + 'E' + String.fromCharCode(0))
    commands.push(ESC + 'a' + String.fromCharCode(0)) // Left
  }

  // Divider
  commands.push(DIVIDER)

  // Items table
  commands.push('Item         Qty Price  Tot\n')
  commands.push(DIVIDER)

  if (receipt.items && receipt.items.length > 0) {
    receipt.items.forEach(item => {
      const name = (item.product_name || item.name || '').substring(0, 16).padEnd(16)
      const qty = (item.quantity || 0).toString().padStart(4)
      const price = formatMoney(item.selling_price || item.price).padStart(7)
      const total = formatMoney(item.subtotal || (item.quantity * item.selling_price)).padStart(7)
      commands.push(`${name} ${qty} ${price} ${total}\n`)
    })
  }

  // Totals divider
  commands.push(DIVIDER)

  // Center, emphasized totals
  commands.push(ESC + 'a' + String.fromCharCode(1))
  commands.push(ESC + 'E' + String.fromCharCode(1))
  commands.push(`TOTAL: ${formatMoney(receipt.total || 0)}\n`)
  commands.push(ESC + 'E' + String.fromCharCode(0))

  // Payment details
  commands.push(`Payment: ${receipt.payment_method || 'USD Cash'}\n`)

  if (receipt.cash_tendered !== undefined) {
    commands.push(`Cash Tendered: ${formatMoney(receipt.cash_tendered)}\n`)
  }

  if (receipt.change_given !== undefined) {
    commands.push(ESC + 'E' + String.fromCharCode(1))
    commands.push(`CHANGE: ${formatMoney(receipt.change_given)}\n`)
    commands.push(ESC + 'E' + String.fromCharCode(0))
  }

  // Footer
  commands.push('\n' + DIVIDER)
  commands.push(`Thank you for shopping with ${shopInfo.name || 'STOCKA SHOP'}!\n`)

  // Powered by (small text)
  commands.push(ESC + '!' + String.fromCharCode(0x00))
  commands.push(`Powered by Stocka v${app.getVersion()}\n`)
  commands.push(ESC + '!' + String.fromCharCode(0))

  // Paper feed and cut
  commands.push('\n\n\n')
  commands.push(GS + 'V' + String.fromCharCode(66)) // Partial cut
  commands.push(ESC + '@') // Reset

  return Buffer.from(commands.join(''))
}

// Helper functions
function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

function formatTime(date) {
  let hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  hours = hours ? hours : 12
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`
}

function formatMoney(amount) {
  const num = parseFloat(amount || 0)
  return `$${num.toFixed(2)}`
}

// ══════════════════════════════════════════════════════════
// AUTO-UPDATER
// ══════════════════════════════════════════════════════════


function setupAutoUpdater() {
  try {
    const { autoUpdater } = require('electron-updater')
    // For dev testing: set to false to test with real GitHub releases
    // Set to true only if you have dev-app-update.yml fully configured for offline use
    autoUpdater.forceDevUpdateConfig = false
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    const runCheck = () => {
      autoUpdater.checkForUpdates().catch(err => logger.warn('Update check skipped: ' + err.message))
    }

    runCheck()
    setInterval(runCheck, 15 * 60 * 1000)

    autoUpdater.on('update-available', (info) => {
      // releaseNotes is an array when the user is multiple versions behind
      const releaseCount = Array.isArray(info.releaseNotes) ? info.releaseNotes.length : 1
      logger.info(`Update available: v${info.version} (${releaseCount} release(s) behind)`)
      if (mainWindow) mainWindow.webContents.send('updater:update-available', {
        version: info.version,
        releaseCount
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      if (mainWindow) mainWindow.webContents.send('updater:download-progress', { percent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', () => {
      logger.info('Update downloaded, ready to install')
      if (mainWindow) mainWindow.webContents.send('updater:update-downloaded')
    })

    autoUpdater.on('error', err => {
      logger.error('Auto-update error: ' + err.message)
    })

    ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())
    ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall())
    // Called by the renderer when it detects the device came back online
    ipcMain.handle('updater:check', () => runCheck())

    logger.info('✅ Auto-updater active (manual mode)')
  } catch (err) {
    logger.warn('Auto-updater unavailable: ' + err.message)
  }
}

// ══════════════════════════════════════════════════════════
// LICENSE IPC HANDLERS
// ══════════════════════════════════════════════════════════

ipcMain.handle('license:check', async () => {
  const data = loadLicense()
  return { valid: !!data, data: data || null }
})

ipcMain.handle('license:activate', async (event, licenseString) => {
  try {
    if (typeof licenseString !== 'string' || licenseString.length > 4096) {
      return { success: false, error: 'Invalid license key format.' }
    }
    const data = verifyLicense(licenseString)
    if (!data) {
      return { success: false, error: 'Invalid license key. Please check the key and contact support if the problem persists.' }
    }
    saveLicense(licenseString)
    logger.info(`✅ License activated for: ${data.customer}`)
    return { success: true, data }
  } catch (err) {
    logger.error('License activation error: ' + err.message)
    return { success: false, error: 'Activation failed. Please try again.' }
  }
})

ipcMain.handle('license:get-info', async () => {
  const data = loadLicense()
  return { data: data || null }
})

ipcMain.handle('license:get-raw', async (event, { username, pin } = {}) => {
  try {
    if (!username || !pin) return { success: false, error: 'Missing credentials' }
    const { getUserByUsername, validateUserPassword } = require('./database/domains/users')
    const user = getUserByUsername(username)
    if (!user || !validateUserPassword(user, String(pin))) {
      return { success: false, error: 'Incorrect PIN' }
    }
    const key = getRawKey()
    if (!key) return { success: false, error: 'No license found on this machine' }
    return { success: true, key }
  } catch (err) {
    return { success: false, error: 'Failed to retrieve license key' }
  }
})

// ══════════════════════════════════════════════════════════
// DATABASE FILE OPERATIONS (backup/restore handled here)
// ══════════════════════════════════════════════════════════

const fsPromises = require('fs').promises

const dbFilePath = path.join(userDataPath, 'stocka.db')
const backupsDirPath = path.join(userDataPath, 'backups')
const metaFilePath = path.join(userDataPath, 'stocka_meta.json')

// Creating, verifying and rotating backups lives in backupEngine — this handler is
// only the renderer's way in. The old implementation here copied stocka.db with
// fs.copyFile, which is not safe against a live WAL database; see backupEngine.js.
ipcMain.handle('db:backup', async () => backupEngine.runBackupNow('manual'))

// What the dashboard and the Backups screen read to answer "are we protected?".
ipcMain.handle('db:backup-state', async () => ({
  success: true,
  state: {
    ...backupEngine.getState(),
    external: externalBackup.getExternalState(),
    offsite: offsiteBackup.getOffsiteState(),
  },
}))

// ── EXTERNAL BACKUP DRIVE ─────────────────────────────────────────────────────
//
// Setting up a drive is a one-time act, and it is a choice between drives rather
// than a walk through the filesystem. Asking a shopkeeper to navigate to a folder
// is how you end up with backups written to the desktop.
ipcMain.handle('backup:list-drives', async () => {
  try {
    return { success: true, drives: await externalBackup.listRemovableDrives() }
  } catch (err) {
    logger.error('backup:list-drives error: ' + err.message)
    return { success: false, error: err.message, drives: [] }
  }
})

ipcMain.handle('backup:set-drive', async (event, letter, label) => {
  try {
    const { getLanConfig, LAN_MODES } = require('./lan/lanConfig')
    if (getLanConfig(userDataPath).mode === LAN_MODES.CLIENT) {
      return { success: false, error: 'This till mirrors the Main computer. Set the backup drive up there.' }
    }

    await externalBackup.adoptDrive(letter)
    if (label) backupEngine.writeStateSection('external', {
      ...backupEngine.readStateSection('external'),
      driveLabel: label,
    })

    // Back up straight away, so setup ends with a verified copy on the drive
    // rather than a promise that one will appear later.
    const result = await externalBackup.backupToDrive('drive-set-up')
    return { success: true, backup: result, state: externalBackup.getExternalState() }
  } catch (err) {
    logger.error('backup:set-drive error: ' + err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('backup:forget-drive', async () => {
  try {
    externalBackup.forgetDrive()
    return { success: true, state: externalBackup.getExternalState() }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('backup:external-now', async () => externalBackup.backupToDrive('manual'))

// ── OFF-SITE COPY ─────────────────────────────────────────────────────────────
//
// Stocka writes a file and the shop decides where it goes. Nothing is uploaded and
// no account is connected, so the promise that the records stay in the building
// holds unless somebody deliberately sends them somewhere.
ipcMain.handle('backup:export-offsite', async () => {
  try {
    const { getLanConfig, LAN_MODES } = require('./lan/lanConfig')
    if (getLanConfig(userDataPath).mode === LAN_MODES.CLIENT) {
      return { success: false, error: 'This till mirrors the Main computer. Export from the Main computer instead.' }
    }

    let shopName = null
    try { shopName = require('./database/domains/shop').getShop()?.name || null } catch (_) {}

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save a copy to keep outside the shop',
      defaultPath: offsiteBackup.suggestedFilename(shopName),
      filters: [{ name: 'Stocka backup', extensions: ['stockabackup'] }],
    })
    if (canceled || !filePath) return { success: false, canceled: true }

    return await offsiteBackup.exportTo(filePath)
  } catch (err) {
    logger.error('backup:export-offsite error: ' + err.message)
    return { success: false, error: err.message }
  }
})

// The owner saying they have put a copy somewhere safe. Recorded as testimony —
// Stocka has no way to look inside their Drive and will never claim otherwise.
ipcMain.handle('backup:record-offsite', async (event, details) => {
  try {
    return { success: true, state: offsiteBackup.recordCopy(details || {}) }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('backup:forget-offsite', async () => {
  try {
    return { success: true, state: offsiteBackup.forgetRecord() }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// An exported file is only worth having if it can come back. Restoring from one
// goes through the same safety net as any other restore: validate the file first,
// keep a copy of the current ledger, clear the stale WAL sidecars, migrate forward.
ipcMain.handle('backup:restore-from-file', async () => {
  let safetyCopy = null
  try {
    const { getLanConfig, LAN_MODES } = require('./lan/lanConfig')
    if (getLanConfig(userDataPath).mode === LAN_MODES.CLIENT) {
      return { success: false, error: 'This till mirrors the Main computer. Restore on the Main computer instead.' }
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a Stocka backup file',
      properties: ['openFile'],
      filters: [
        { name: 'Stocka backup', extensions: ['stockabackup', 'db'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (canceled || !filePaths?.length) return { success: false, canceled: true }

    const chosen = filePaths[0]
    const verdict = backupEngine.verifyBackupFile(chosen)
    if (!verdict.ok) return { success: false, error: `That file cannot be restored: ${verdict.error}` }

    backupEngine.stop()
    externalBackup.stopWatching()
    safetyCopy = await backupEngine.createSafetyCopy('pre-restore')

    closeDb()
    for (const sidecar of ['-wal', '-shm']) {
      try { await fsPromises.unlink(dbFilePath + sidecar) } catch (_) { /* absent is fine */ }
    }
    await fsPromises.copyFile(chosen, dbFilePath)

    const { reopenDb } = require('./database/index')
    const restoredDb = reopenDb()
    createTables(restoredDb)
    runMigrations(restoredDb)
    ensureIndexes(restoredDb)

    backupEngine.init(userDataPath)
    externalBackup.init(userDataPath)
    if (!backupEngine.isSatellite()) externalBackup.startWatching(() => {})

    logger.info(`[Backup] Restored from file ${path.basename(chosen)} (previous ledger kept as ${safetyCopy.filename})`)
    return { success: true, restored: path.basename(chosen), safetyCopy: safetyCopy.filename }
  } catch (err) {
    logger.error('backup:restore-from-file error: ' + err.message)
    try { require('./database/index').reopenDb() } catch (_) {}
    backupEngine.init(userDataPath)
    return { success: false, error: err.message, safetyCopy: safetyCopy ? safetyCopy.filename : null }
  }
})

ipcMain.handle('db:list-backups', async () => {
  try {
    return { success: true, backups: await backupEngine.listBackups() }
  } catch (err) {
    logger.error('db:list-backups error: ' + err.message)
    return { success: false, error: err.message, backups: [] }
  }
})

// Restore is the most destructive thing Stocka can do to itself, and the previous
// implementation did it with no safety net whatsoever: no check that the chosen
// file was a usable database, no copy of what was about to be overwritten, and —
// the part that could actually corrupt data — it left the outgoing database's
// stocka.db-wal and stocka.db-shm sitting beside the newly copied file. On the next
// open SQLite would find a write-ahead log belonging to a different database and
// try to recover it against the restored one.
//
// Order matters here and every step earns its place:
//   1. validate the source before anything is touched
//   2. take a verified safety copy of the current ledger, while the DB is still open
//   3. close the database, then remove its WAL sidecars
//   4. copy, reopen, verify the result is live
// If step 4 goes wrong the shop still has step 2, and the filename is returned so
// it can be named in the UI rather than hunted for.
ipcMain.handle('db:restore', async (event, filename) => {
  let safetyCopy = null
  try {
    if (!/^[\w\-.]+\.db$/.test(filename) || filename.includes('..')) {
      return { success: false, error: 'Invalid backup filename' }
    }
    const srcPath = path.join(backupsDirPath, filename)
    await fsPromises.access(srcPath)

    // A satellite restoring its own partial mirror over itself would look like it
    // worked and then be overwritten by the next delta from Main anyway.
    const { getLanConfig, LAN_MODES } = require('./lan/lanConfig')
    if (getLanConfig(userDataPath).mode === LAN_MODES.CLIENT) {
      return { success: false, error: 'This till mirrors the Main computer. Restore on the Main computer instead.' }
    }

    const verdict = backupEngine.verifyBackupFile(srcPath)
    if (!verdict.ok) {
      return { success: false, error: `This backup cannot be restored: ${verdict.error}` }
    }

    // Stop the debounce firing a backup into the middle of the swap.
    backupEngine.stop()

    safetyCopy = await backupEngine.createSafetyCopy('pre-restore')

    closeDb()
    for (const sidecar of ['-wal', '-shm']) {
      try { await fsPromises.unlink(dbFilePath + sidecar) } catch (_) { /* absent is fine */ }
    }

    await fsPromises.copyFile(srcPath, dbFilePath)

    const { reopenDb } = require('./database/index')
    const restoredDb = reopenDb()

    // Bring the restored ledger up to the schema this build expects. A backup is
    // a snapshot of whatever Stocka looked like on the day it was taken, so an
    // older one can be missing tables, columns and indexes that today's code reads
    // without checking. Boot does exactly this for the live database; a restore is
    // the one other moment a database arrives from outside, and skipping it left
    // the app running against an unmigrated schema until somebody happened to
    // restart it.
    createTables(restoredDb)
    runMigrations(restoredDb)
    ensureIndexes(restoredDb)

    backupEngine.init(userDataPath)
    externalBackup.init(userDataPath)

    logger.info(`[Backup] Restored ${filename} (previous ledger kept as ${safetyCopy.filename})`)
    return { success: true, restored: filename, safetyCopy: safetyCopy.filename }
  } catch (err) {
    logger.error('db:restore error: ' + err.message)
    // Make sure the app is not left with a closed database whatever went wrong.
    try { require('./database/index').reopenDb() } catch (_) {}
    backupEngine.init(userDataPath)
    externalBackup.init(userDataPath)
    return {
      success: false,
      error: err.message,
      safetyCopy: safetyCopy ? safetyCopy.filename : null,
    }
  }
})

ipcMain.handle('db:get-paths', async () => {
  return { success: true, dbPath: dbFilePath, backupsPath: backupsDirPath, userDataPath }
})

// ══════════════════════════════════════════════════════════
// TILL IDENTITY — local-only per-machine code + label used to scope receipt
// numbering (no cross-machine collisions) and to tag which till rang up a sale.
// ══════════════════════════════════════════════════════════

const tillIdentity = require('./lan/tillIdentity')

ipcMain.handle('till:get-identity', () => tillIdentity.getTillIdentity(userDataPath) || { code: 'M', label: 'Main' })

ipcMain.handle('till:set-label', (event, label) => {
  if (typeof label !== 'string' || !label.trim() || label.length > 40) {
    return { success: false, error: 'Label must be 1-40 characters.' }
  }
  return { success: true, identity: tillIdentity.setTillLabel(userDataPath, label.trim()) }
})

ipcMain.handle('till:next-receipt-number', () => {
  const identity = tillIdentity.getTillIdentity(userDataPath) || { code: 'M' }
  const { getDb } = require('./database/index')
  return tillIdentity.nextReceiptNumber(userDataPath, identity.code, getDb)
})

// Test-data reset: wipe transactional history (sales, shifts, stock/expense/audit
// history) while keeping products, stock levels, users, suppliers, branches and
// shop settings. Admin PIN required; an automatic .db backup is taken first.
ipcMain.handle('maintenance:reset-transactions', async (event, { username, pin } = {}) => {
  try {
    // Only the authoritative DB may be reset — a satellite mirrors Main's data
    const { getLanConfig, LAN_MODES } = require('./lan/lanConfig')
    if (getLanConfig(userDataPath).mode === LAN_MODES.CLIENT) {
      return { success: false, error: 'This till mirrors the Main computer. Run the reset on the Main computer instead.' }
    }

    if (!username || !pin) return { success: false, error: 'Missing credentials' }
    const { getUserByUsername, validateUserPassword } = require('./database/domains/users')
    const user = getUserByUsername(username)
    if (!user || user.role !== 'Admin' || !validateUserPassword(user, String(pin))) {
      return { success: false, error: 'Incorrect admin PIN' }
    }

    // Safety net before anything is deleted. Goes through the backup engine so the
    // copy is WAL-consistent and read back before the reset is allowed to proceed —
    // an unverified safety net is not one.
    const { filename: backupFilename } = await backupEngine.createSafetyCopy('pre-reset')

    const { resetTransactionalData } = require('./database/domains/maintenance')
    const result = resetTransactionalData()

    logger.info(`🧹 Test-data reset by ${username} (backup: ${backupFilename})`)

    // Satellites can't delete rows via delta sync — tell them to re-mirror
    try { require('./lan/lanServer').broadcastResyncRequired() } catch (_) {}

    return { ...result, backupFilename }
  } catch (err) {
    logger.error('maintenance:reset-transactions failed: ' + err.message)
    return { success: false, error: err.message }
  }
})

// Writes a copy of the ledger to somewhere outside Stocka's own folder. Same
// correction as db:backup: a plain copy of stocka.db can miss whatever is still in
// the write-ahead log, and an export handed to somebody to keep safe is the worst
// possible place for that to happen. Verified before we call it a success, because
// the whole point of an exported copy is that nobody will find out it was bad until
// the day they need it.
ipcMain.handle('db:export-file', async (event, destPath) => {
  try {
    if (!path.isAbsolute(destPath)) return { success: false, error: 'Destination path must be absolute' }

    const { getDb } = require('./database/index')
    await getDb().backup(destPath)

    const verdict = backupEngine.verifyBackupFile(destPath)
    if (!verdict.ok) {
      try { await fsPromises.unlink(destPath) } catch (_) {}
      return { success: false, error: `The exported copy could not be verified: ${verdict.error}` }
    }

    return { success: true, sizeBytes: verdict.sizeBytes, verified: true }
  } catch (err) {
    logger.error('db:export-file error: ' + err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('db:get-meta', async () => {
  try {
    const data = await fsPromises.readFile(metaFilePath, 'utf8')
    return { success: true, meta: JSON.parse(data) }
  } catch (_) {
    return { success: true, meta: {} }
  }
})

ipcMain.handle('db:set-meta', async (event, meta) => {
  try {
    await fsPromises.writeFile(metaFilePath, JSON.stringify(meta), 'utf8')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ══════════════════════════════════════════════════════════
// BLUETOOTH SERIAL PRINTER — cross-platform via serialport
// ══════════════════════════════════════════════════════════

ipcMain.handle('bt:scan', async () => {
  try {
    const ports = await btPrinter.scanPrinters()
    logger.info(`🔵 [BT] Found ${ports.length} port(s): ${ports.map(p => p.path).join(', ')}`)
    return { success: true, ports }
  } catch (err) {
    logger.error('🔵 [BT] Scan error: ' + err.message)
    return { success: false, error: err.message, ports: [] }
  }
})

ipcMain.handle('bt:print-test', async (event, portPath, shopName) => {
  if (!portPath || typeof portPath !== 'string' || portPath.length > 100) {
    return { success: false, error: 'Invalid port path.' }
  }
  try {
    const data = btPrinter.buildTestPage(portPath, shopName || '')
    logger.info(`🔵 [BT] Test print → ${portPath} (${data.length} bytes)`)
    await btPrinter.printRaw(portPath, data)
    logger.info('🔵 [BT] Test print succeeded')
    return { success: true }
  } catch (err) {
    logger.error(`🔵 [BT] Test print failed: ${err.message}`)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('bt:print-receipt', async (event, portPath, receiptData, shopInfo, isDuplicate) => {
  if (!portPath || typeof portPath !== 'string' || portPath.length > 100) {
    return { success: false, error: 'No serial port configured. Go to Settings → Printer.' }
  }
  if (!receiptData || typeof receiptData !== 'object') {
    return { success: false, error: 'Invalid receipt data.' }
  }
  try {
    const data = generateReceiptCommands(receiptData, shopInfo || {}, isDuplicate || false)
    logger.info(`🔵 [BT] Receipt print → ${portPath} (${data.length} bytes)`)
    await btPrinter.printRaw(portPath, data)
    logger.info('🔵 [BT] Receipt print succeeded')
    return { success: true }
  } catch (err) {
    logger.error(`🔵 [BT] Receipt print failed: ${err.message}`)
    return { success: false, error: err.message }
  }
})

// Same report bytes as the Windows-printer path, written straight down the serial
// port instead — so a shop on a COM-port Bluetooth printer gets the identical
// document without configuring anything new.
ipcMain.handle('bt:print-eod', async (event, portPath, report, shopInfo, isReprint) => {
  if (!portPath || typeof portPath !== 'string' || portPath.length > 100) {
    return { success: false, error: 'No serial port configured. Go to Settings → Printer.' }
  }
  if (!report || typeof report !== 'object') {
    return { success: false, error: 'Invalid end of day report data.' }
  }
  try {
    const data = buildEodReportBytes(report, shopInfo || {}, isReprint || false)
    logger.info(`🔵 [BT] EOD report print → ${portPath} (${data.length} bytes)`)
    await btPrinter.printRaw(portPath, data)
    logger.info('🔵 [BT] EOD report print succeeded')
    return { success: true }
  } catch (err) {
    logger.error(`🔵 [BT] EOD report print failed: ${err.message}`)
    return { success: false, error: err.message }
  }
})

// ══════════════════════════════════════════════════════════
// CLOUD IPC HANDLERS — safeStorage token management + OAuth
// ══════════════════════════════════════════════════════════

const TOKEN_PATH = path.join(userDataPath, 'cloud_token.dat')

ipcMain.handle('cloud:save-token', (event, payload) => {
  try {
    const json = JSON.stringify(payload)
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json)
      fs.writeFileSync(TOKEN_PATH, encrypted)
    } else {
      // Fallback: plain JSON (dev machines without keychain)
      fs.writeFileSync(TOKEN_PATH, json, 'utf8')
    }
    return { success: true }
  } catch (err) {
    logger.error('cloud:save-token failed: ' + err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('cloud:load-token', () => {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return null
    const raw = fs.readFileSync(TOKEN_PATH)
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
})

ipcMain.handle('cloud:clear-token', () => {
  try {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Open a popup BrowserWindow for Google OAuth.
// The API redirects back to stocka://auth?access_token=...&refresh_token=...
// which triggers the open-url event below and sends the token to the renderer.
ipcMain.handle('cloud:open-google-auth', async () => {
  const API_URL = process.env.STOCKA_API_URL || 'http://localhost:3001'
  const authWin = new BrowserWindow({
    width: 500,
    height: 650,
    parent: mainWindow,
    modal: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    title: 'Sign in with Google',
  })

  authWin.loadURL(`${API_URL}/auth/google-start`)
  authWin.once('closed', () => {
    if (mainWindow) mainWindow.webContents.send('cloud:auth-cancelled')
  })
})

// On Windows, the stocka:// redirect comes in as a second instance.
// Extract the token from the URL and send it to the renderer.
const handleStockaUrl = (url) => {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'auth') {
      const access_token   = parsed.searchParams.get('access_token')
      const refresh_token  = parsed.searchParams.get('refresh_token')
      const error          = parsed.searchParams.get('error')
      if (mainWindow) {
        if (error) {
          mainWindow.webContents.send('cloud:auth-error', error)
        } else {
          mainWindow.webContents.send('cloud:auth-complete', { access_token, refresh_token })
        }
        // Close the OAuth popup if it's still open
        BrowserWindow.getAllWindows()
          .filter(w => w !== mainWindow && w.getTitle() === 'Sign in with Google')
          .forEach(w => w.destroy())
      }
    }
  } catch (err) {
    logger.error('handleStockaUrl error: ' + err.message)
  }
}

// macOS / Linux: the URL is delivered to the running instance via open-url
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleStockaUrl(url)
})

// Windows: the URL is delivered as a CLI arg to a second instance
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    const url = argv.find(arg => arg.startsWith('stocka://'))
    if (url) handleStockaUrl(url)
    // In background mode the window may be hidden, not just minimised — relaunching
    // from the desktop icon has to bring it back, or it looks like nothing happened.
    backgroundServer.showWindow()
  })
}