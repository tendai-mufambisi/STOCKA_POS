/** @typedef {import('@serialport/bindings-interface').PortInfo} PortInfo */
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const nodePrinter = require('node-printer')
const { PosPrinter } = require('@plick/electron-pos-printer')
const logger = require('./logger')
const { verifyLicense, saveLicense, loadLicense } = require('./license')

// Set userData path before app is ready (must be first)
const userDataPath = path.join(process.env.APPDATA || process.env.HOME, 'Stocka')
app.setPath('userData', userDataPath)

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
    icon: path.join(__dirname, '..', 'src', 'assets', 'icon.png'),
    show: false
  })

  // Load Vite dev server in development, built files in production
  if (!app.isPackaged) {
    logger.info('🔧 Development mode - Loading from localhost:5173')
    mainWindow.loadURL('http://localhost:5173')
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

  // Show window when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    logger.info('✅ Window ready to show.....')
    mainWindow.show()
    
  })

  // Clean up on close
  mainWindow.on('closed', () => {
    logger.info('🔒 Window closed')
    mainWindow = null
  })
}

app.whenReady().then(() => {
  logger.info('⚡ App ready')
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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception', error)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Rejection', { reason, promise })
})

// ══════════════════════════════════════════════════════════
// PRINTER IPC HANDLERS - Using Windows Print API
// ══════════════════════════════════════════════════════════

/**
 * NEW: Clean single-path printer handler
 * Print receipt to Windows printer by name (not COM port)
 */
ipcMain.handle('printer:print-by-name', async (event, printerName, receiptData, shopInfo, isDuplicate = false) => {
  try {
    if (!printerName || typeof printerName !== 'string') {
      return { success: false, error: 'No printer name provided. Go to Settings → Printer, scan, and save a printer.' }
    }

    const escposCommands = generateReceiptCommands(receiptData, shopInfo || {}, isDuplicate)
    logger.info(`🖨️ [PRINT-BY-NAME] Printing to "${printerName}", buffer: ${escposCommands.length} bytes`)

    return await sendToWindowsPrinter(printerName, escposCommands)
  } catch (error) {
    logger.error('❌ [PRINT-BY-NAME] ' + error.message)
    return { success: false, error: error.message }
  }
})

/**
 * NEW: Test print by printer name
 */
ipcMain.handle('printer:test-by-name', async (event, printerName) => {
  if (!printerName) return { success: false, error: 'No printer name provided' }

  const testReceipt = {
    receipt_number: 'TEST-001',
    created_at: new Date().toISOString(),
    cashier: 'Test',
    items: [
      { product_name: 'Test Item 1', quantity: 1, selling_price: 5.00, subtotal: 5.00 },
      { product_name: 'Test Item 2', quantity: 2, selling_price: 10.00, subtotal: 20.00 }
    ],
    total: 25.00,
    payment_method: 'Test Print',
    cash_tendered: 30.00,
    change_given: 5.00
  }
  const testShop = { name: 'Test Shop', address: 'Test Address', phone: '000-000-0000' }

  return await sendToWindowsPrinter(printerName, generateReceiptCommands(testReceipt, testShop, false))
})

/**
 * Scan for available Windows printers (thermal receipt printers)
 * Uses node-printer (native binding) for reliable enumeration
 */
// Windows virtual/software printers that are never physical receipt printers
const VIRTUAL_PRINTER_PATTERNS = [
  /microsoft print to pdf/i,
  /microsoft xps/i,
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
  /\\\\.*\\\\/,  // UNC network printer paths
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
    logger.info('🖨️ Scanning for available printers via node-printer')

    let printerList = []
    try {
      printerList = nodePrinter.getPrinters()
      logger.info(`✅ node-printer found ${printerList.length} printer(s) total`)
    } catch (err) {
      logger.warn('⚠️ node-printer.getPrinters() failed, falling back to PowerShell: ' + err.message)
    }

    if (printerList.length > 0) {
      const all = tagPrinters(printerList.map(p => p.name), p => ({ isDefault: !!p.isDefault }), printerList)
      return { success: true, printers: all, count: all.length }
    }

    // Fallback: PowerShell WMI
    const { execFile } = require('child_process')
    return new Promise((resolve) => {
      const psScript = `Get-WmiObject Win32_Printer | Select-Object Name | ForEach-Object { Write-Host $_.Name }`
      execFile('powershell.exe', ['-NoProfile', '-Command', psScript], { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          logger.warn('⚠️ PowerShell fallback also failed — no printers detected')
          resolve({ success: true, printers: [], count: 0, message: 'No printers found. Ensure your Bluetooth printer is paired in Windows Settings → Bluetooth, then added in Devices & Printers.' })
          return
        }

        const names = stdout.split('\n').map(l => l.trim()).filter(Boolean)
        const all = tagPrinters(names, () => ({}), null)
        logger.info(`✅ PowerShell fallback found ${all.length} printer(s)`)
        resolve({ success: true, printers: all, count: all.length })
      })
    })
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
            } else if (kind === 'notcom') {
              msg = `Printer "${printerName}" uses port "${rest}", not a COM port. ` +
                'Bluetooth printers must be paired via Bluetooth & devices and show a COM port. ' +
                'Check printer properties in Devices & Printers to see which port it uses.'
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

  // Sale info
  const date = new Date(receipt.created_at || new Date())
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
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    const runCheck = () => {
      autoUpdater.checkForUpdates().catch(err => logger.warn('Update check skipped: ' + err.message))
    }

    runCheck()
    setInterval(runCheck, 4 * 60 * 60 * 1000)

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

// ══════════════════════════════════════════════════════════
// DATABASE IPC HANDLERS - File-based persistence
// ══════════════════════════════════════════════════════════

const fs = require('fs')
const fsPromises = require('fs').promises

const dbFilePath = path.join(userDataPath, 'stocka.db')
const dbTmpPath  = path.join(userDataPath, 'stocka.db.tmp')
const backupsDirPath = path.join(userDataPath, 'backups')
const metaFilePath = path.join(userDataPath, 'stocka_meta.json')

const ensureBackupsDir = () => fsPromises.mkdir(backupsDirPath, { recursive: true }).catch(() => {})

ipcMain.handle('db:load', async () => {
  try {
    const data = await fsPromises.readFile(dbFilePath)
    return { success: true, data: data.toString('base64') }
  } catch (err) {
    if (err.code === 'ENOENT') return { success: true, data: null }
    logger.warn('db:load error: ' + err.message)
    return { success: true, data: null }
  }
})

ipcMain.handle('db:save', async (event, base64) => {
  try {
    const buf = Buffer.from(base64, 'base64')
    await fsPromises.writeFile(dbTmpPath, buf)
    await fsPromises.rename(dbTmpPath, dbFilePath)
    return { success: true }
  } catch (err) {
    logger.error('db:save error: ' + err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('db:backup', async () => {
  try {
    await ensureBackupsDir()
    await fsPromises.access(dbFilePath)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `stocka_${timestamp}.db`
    const destPath = path.join(backupsDirPath, filename)
    await fsPromises.copyFile(dbFilePath, destPath)
    // Keep only the 10 most recent backups
    const allFiles = await fsPromises.readdir(backupsDirPath)
    const dbFiles = allFiles
      .filter(f => f.startsWith('stocka_') && f.endsWith('.db'))
      .sort()
      .reverse()
    if (dbFiles.length > 10) {
      for (const old of dbFiles.slice(10)) {
        try { await fsPromises.unlink(path.join(backupsDirPath, old)) } catch (_) {}
      }
    }
    return { success: true, filename }
  } catch (err) {
    if (err.code === 'ENOENT') return { success: false, error: 'No database file to backup' }
    logger.error('db:backup error: ' + err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('db:list-backups', async () => {
  try {
    await ensureBackupsDir()
    const files = await fsPromises.readdir(backupsDirPath)
    const dbFiles = files.filter(f => f.startsWith('stocka_') && f.endsWith('.db'))
    const backups = []
    for (const filename of dbFiles) {
      const filePath = path.join(backupsDirPath, filename)
      const stat = await fsPromises.stat(filePath)
      backups.push({ filename, path: filePath, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size })
    }
    backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return { success: true, backups }
  } catch (err) {
    logger.error('db:list-backups error: ' + err.message)
    return { success: false, error: err.message, backups: [] }
  }
})

ipcMain.handle('db:restore', async (event, filename) => {
  try {
    if (!/^[\w\-\.]+\.db$/.test(filename)) return { success: false, error: 'Invalid backup filename' }
    const srcPath = path.join(backupsDirPath, filename)
    await fsPromises.access(srcPath)
    await fsPromises.copyFile(srcPath, dbFilePath)
    return { success: true }
  } catch (err) {
    logger.error('db:restore error: ' + err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('db:get-paths', async () => {
  return { success: true, dbPath: dbFilePath, backupsPath: backupsDirPath, userDataPath }
})

ipcMain.handle('db:export-file', async (event, destPath) => {
  try {
    if (!path.isAbsolute(destPath)) return { success: false, error: 'Destination path must be absolute' }
    await fsPromises.access(dbFilePath)
    await fsPromises.copyFile(dbFilePath, destPath)
    return { success: true }
  } catch (err) {
    logger.error('db:export-file error: ' + err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('db:migrate-from-localstorage', async (event, base64) => {
  try {
    // Only write if stocka.db does not already exist
    try {
      await fsPromises.access(dbFilePath)
      return { success: true, migrated: false, reason: 'db file already exists' }
    } catch (_) {}
    const buf = Buffer.from(base64, 'base64')
    await fsPromises.writeFile(dbTmpPath, buf)
    await fsPromises.rename(dbTmpPath, dbFilePath)
    return { success: true, migrated: true }
  } catch (err) {
    logger.error('db:migrate-from-localstorage error: ' + err.message)
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

ipcMain.handle('db:load-backup', async (event, filename) => {
  try {
    if (!/^[\w\-\.]+\.db$/.test(filename)) return { success: false, error: 'Invalid filename' }
    const filePath = path.join(backupsDirPath, filename)
    const data = await fsPromises.readFile(filePath)
    return { success: true, data: data.toString('base64') }
  } catch (err) {
    logger.error('db:load-backup error: ' + err.message)
    return { success: false, error: err.message }
  }
})