/** @typedef {import('@serialport/bindings-interface').PortInfo} PortInfo */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const printer = require('node-printer')
const { PosPrinter } = require('@plick/electron-pos-printer')

const isDev = process.env.NODE_ENV === 'development'

// Import ReceiptPrinter for Bluetooth/COM port printing
let ReceiptPrinter = null
try {
  ReceiptPrinter = require('../src/utils/printerUtils.js')
} catch (err) {
  console.warn('⚠️ ReceiptPrinter not available:', err.message)
}

// Global to store reference to main window for IPC
let mainWindow = null

function createWindow() {
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
    show: false
  })

  // Load Vite dev server in development, built files in production
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Show window when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Clean up on close
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ══════════════════════════════════════════════════════════
// PRINTER IPC HANDLERS - Using Windows Print API
// ══════════════════════════════════════════════════════════

/**
 * Scan for available Windows printers (thermal receipt printers)
 * SIMPLIFIED: Returns common printers and system default
 */
ipcMain.handle('printer:scan', async () => {
  try {
    console.log(`🖨️ [SCANNER] Scanning for available printers...`)

    const devices = [
      {
        name: 'Default Printer (Auto-detect)',
        port: 'default',
        type: 'default'
      }
    ]

    // Try to get list from node-printer with a timeout
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('⚠️ [SCANNER] Using default printer (scan timed out)')
        resolve({
          success: true,
          printers: devices,
          count: devices.length,
          message: 'Using default printer. If this is wrong, specify printer in Settings.'
        })
      }, 2000)

      try {
        printer.list((err, printers) => {
          clearTimeout(timeout)

          if (err || !printers || printers.length === 0) {
            console.log('ℹ️ [SCANNER] No additional printers detected')
            resolve({
              success: true,
              printers: devices,
              count: devices.length,
              message: 'Using default printer'
            })
            return
          }

          console.log(`✅ [SCANNER] Found ${printers.length} printer(s)`)
          
          // Add detected printers
          printers.forEach((name, idx) => {
            console.log(`   ${idx + 1}. ${name}`)
            devices.push({
              name: name,
              port: name,
              type: 'windows_printer'
            })
          })

          resolve({
            success: true,
            printers: devices,
            count: devices.length
          })
        })
      } catch (e) {
        clearTimeout(timeout)
        console.warn('⚠️ [SCANNER] Error listing printers:', e.message)
        resolve({
          success: true,
          printers: devices,
          count: devices.length,
          message: 'Using default printer'
        })
      }
    })
  } catch (error) {
    console.error('❌ [SCANNER] Fatal error:', error.message)
    return {
      success: false,
      error: error.message,
      printers: [],
      count: 0
    }
  }
})

/**
 * Scan for COM ports (alternative to Windows printer scan)
 * Useful for direct Bluetooth/Serial printers
 */
ipcMain.handle('printer:scan-com', async () => {
  try {
    console.log(`🖨️ [COM SCAN] Scanning for available COM ports...`)
    
    // Try to use SerialPort to list available ports
    let ports = []
    
    try {
      if (ReceiptPrinter && typeof ReceiptPrinter === 'function') {
        // If SerialPort is available, use it
        const { SerialPort } = require('serialport')
        ports = await SerialPort.list()
      }
    } catch (err) {
      console.warn('⚠️ SerialPort not available, using fallback list')
    }
    
    // If no ports found, provide common COM ports
    if (ports.length === 0) {
      console.log('📍 No ports detected, offering common COM ports as options')
      ports = [
        { path: 'COM1', manufacturer: 'Unknown' },
        { path: 'COM3', manufacturer: 'Unknown (Common Bluetooth)' },
        { path: 'COM4', manufacturer: 'Unknown' },
        { path: 'COM5', manufacturer: 'Unknown' },
        { path: 'COM6', manufacturer: 'Unknown' }
      ]
    }
    
    console.log(`✅ Found ${ports.length} COM port(s)`)
    ports.forEach((port, idx) => {
      console.log(`   ${idx + 1}. ${port.path} - ${port.manufacturer || 'Unknown'}`)
    })
    
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
    console.error('❌ COM port scan error:', error)
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

    console.log(`🖨️ [TEST PRINT] Sending test receipt to ${printerName}`)

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
    console.error('Test print error:', error)
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
    if (!printerName) {
      return {
        success: false,
        error: 'No printer configured. Please set up printer in Settings, then try again.'
      }
    }

    // Generate ESC/POS commands for receipt
    const escposCommands = generateReceiptCommands(receiptData, shopInfo, isDuplicate)
    
    console.log(`🖨️ [PRINTER] Printing receipt "${receiptData.receipt_number}" to ${printerName}`)
    console.log(`📊 [PRINTER] ESC/POS buffer size: ${escposCommands.length} bytes`)

    // Try to print with up to 2 retries if busy
    let lastError = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await sendToWindowsPrinter(printerName, escposCommands)
        if (result.success) {
          console.log(`✅ [PRINTER] Print succeeded on attempt ${attempt}`)
          return result
        } else {
          lastError = result.error
          if (attempt < 2) {
            console.log(`⚠️ [PRINTER] Attempt ${attempt} failed, retrying...`)
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        }
      } catch (err) {
        lastError = err.message
        if (attempt < 2) {
          console.log(`⚠️ [PRINTER] Attempt ${attempt} error, retrying...`)
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    }

    console.error(`❌ [PRINTER] Failed after 2 attempts: ${lastError}`)
    return {
      success: false,
      error: lastError || 'Failed to print after multiple attempts'
    }

  } catch (error) {
    console.error('❌ [PRINTER] Critical error:', error)
    return {
      success: false,
      error: error.message || 'Failed to print receipt'
    }
  }
})

/**
 * Send raw ESC/POS bytes to thermal printer via Windows Print API
 * Uses node-printer to send data to any Windows printer (including Bluetooth)
 * @param {string} printerName - Name of the Windows printer
 * @param {Buffer} escposCommands - ESC/POS binary commands
 * @returns {Promise} Result object with success status
 */
async function sendToWindowsPrinter(printerName, escposCommands) {
  return new Promise((resolve) => {
    try {
      console.log(`🖨️ [PRINTER] Sending to Windows printer: ${printerName}`)
      console.log(`📊 [PRINTER] Buffer size: ${escposCommands.length} bytes`)

      // Prepare print job configuration
      const printOptions = {
        printer: printerName,
        type: 'RAW', // Send raw ESC/POS data
        data: escposCommands
      }

      // Send to printer
      printer.printDirect(printOptions, (err, res) => {
        if (err) {
          console.error(`❌ [PRINTER] Print error: ${err.message}`)
          resolve({
            success: false,
            error: `Failed to print: ${err.message}`
          })
          return
        }

        console.log(`✅ [PRINTER] Sent ${escposCommands.length} bytes to printer`)
        resolve({
          success: true,
          message: 'Receipt printed successfully'
        })
      })

    } catch (err) {
      console.error(`❌ [PRINTER] Critical error: ${err.message}`)
      resolve({
        success: false,
        error: 'Print operation failed: ' + err.message
      })
    }
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
    if (!receiptData || !Array.isArray(receiptData)) {
      return {
        success: false,
        error: 'Invalid receipt data. Expected array of print objects.'
      }
    }

    if (receiptData.length === 0) {
      return {
        success: false,
        error: 'Receipt is empty. Nothing to print.'
      }
    }

    console.log(`🖨️ [POS PRINTER] Printing receipt...`)
    console.log(`📍 Printer: ${printerName || 'Default (auto-detect)'}`)
    console.log(`📊 Items: ${receiptData.length} print objects`)

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

    console.log(`✅ [POS PRINTER] Receipt printed successfully`)
    return {
      success: true,
      message: 'Receipt printed successfully'
    }
  } catch (error) {
    console.error(`❌ [POS PRINTER] Print error:`, error)
    
    // Safely get error message (handle cases where error is not a standard Error object)
    const errorMessage = error?.message || String(error) || 'Unknown error'
    
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

    const printer = new ReceiptPrinter(portPath, 9600)
    await printer.printReceipt(receiptData)
    printer.disconnect()

    return {
      success: true,
      message: 'Receipt printed successfully via Bluetooth'
    }
  } catch (error) {
    console.error('❌ [BLUETOOTH] Print error:', error)
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
  commands.push('-' + Array(38).fill('-').join('') + '\n')

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
  commands.push('-' + Array(38).fill('-').join('') + '\n')

  // Items table
  commands.push('Item              Qty  Price    Total\n')
  commands.push('-' + Array(38).fill('-').join('') + '\n')

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
  commands.push('-' + Array(38).fill('-').join('') + '\n')

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
  commands.push('\n-' + Array(38).fill('-').join('') + '\n')
  commands.push(`Thank you for shopping with ${shopInfo.name || 'STOCKA SHOP'}!\n`)

  // Powered by (small text)
  commands.push(ESC + '!' + String.fromCharCode(0x00))
  commands.push('Powered by Stocka\n')
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