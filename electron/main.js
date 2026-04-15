const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { SerialPort } = require('serialport')

const isDev = process.env.NODE_ENV === 'development'

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
// PRINTER IPC HANDLERS
// ══════════════════════════════════════════════════════════

/**
 * Scan for available COM ports where thermal printers may be connected
 * Uses SerialPort to list all available ports
 */
ipcMain.handle('printer:scan', async () => {
  try {
    const devices = []
    const { SerialPort } = require('serialport')

    console.log(`🖨️ [SCANNER] ========== COM PORT SCAN ==========`)
    console.log(`🖨️ [SCANNER] Scanning for available COM ports...`)

    try {
      const ports = await SerialPort.list()
      
      if (ports.length === 0) {
        console.log(`⚠️ [SCANNER] No COM ports found`)
      } else {
        console.log(`✅ [SCANNER] Found ${ports.length} COM port(s)`)
        
        ports.forEach((port, idx) => {
          console.log(`\n📍 [SCANNER] Port ${idx + 1}:`)
          console.log(`   Path: ${port.path}`)
          console.log(`   Manufacturer: ${port.manufacturer || 'Unknown'}`)
          console.log(`   SerialNumber: ${port.serialNumber || 'Unknown'}`)
          console.log(`   PnPId: ${port.pnpId || 'Unknown'}`)
          
          // Detect if this is likely a thermal printer
          const description = `${port.manufacturer || ''} ${port.pnpId || ''} ${port.path}`.toLowerCase()
          const isProbablyPrinter = description.includes('printer') || 
                                    description.includes('thermal') ||
                                    description.includes('usb') ||
                                    description.includes('bluetooth') ||
                                    port.path === 'COM3' // Your working port
          
          devices.push({
            name: `${port.path} - ${port.manufacturer || 'Unknown Device'}`,
            port: port.path,
            type: 'serial'
          })
          
          console.log(`   ${isProbablyPrinter ? '✅ Likely printer' : 'ℹ️ Unknown device'}`)
        })
      }

      // Add COM3 as fallback even if not detected (since that's what works for you)
      if (!devices.find(d => d.port === 'COM3')) {
        console.log(`\n📍 [SCANNER] Adding COM3 as fallback option (your working port)`)
        devices.push({
          name: 'COM3 (Manual)',
          port: 'COM3',
          type: 'serial'
        })
      }

    } catch (err) {
      console.error(`❌ [SCANNER] Port scan error: ${err.message}`)
      // Still offer COM3 as fallback
      devices.push({
        name: 'COM3 (Manual)',
        port: 'COM3',
        type: 'serial'
      })
    }

    console.log(`🖨️ [SCANNER] ========== SCAN COMPLETE ==========`)
    console.log(`✅ [SCANNER] Total ports found: ${devices.length}`)
    devices.forEach(d => {
      console.log(`   📠 ${d.name}`)
    })

    return {
      success: true,
      printers: devices,
      count: devices.length,
      diagnosticMessage: devices.length === 0 
        ? 'No COM ports found. Ensure printer is connected via USB/Bluetooth and powered on.'
        : undefined
    }
  } catch (error) {
    console.error('❌ [SCANNER] Fatal scan error:', error)
    return {
      success: false,
      error: 'Scan failed: ' + error.message,
      printers: [
        { name: 'COM3 (Manual)', port: 'COM3', type: 'serial' }
      ],
      count: 1
    }
  }
})

/**
 * Test print - send test receipt to printer
 */
ipcMain.handle('printer:test', async (event, printerPort) => {
  try {
    if (!printerPort) {
      return {
        success: false,
        error: 'No printer port specified'
      }
    }

    console.log(`🖨️ [TEST PRINT] Sending test receipt to ${printerPort}`)

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
    return await useWindowsPrintAPI(printerPort, generateReceiptCommands(testReceipt, testShopInfo, false))
  } catch (error) {
    console.error('Test print error:', error)
    return {
      success: false,
      error: error.message || 'Test print failed'
    }
  }
})

/**
 * Print receipt
 */
/**
 * Send receipt to thermal printer via Windows Print API
 * Uses the proper printer driver instead of direct COM port writes
 */
ipcMain.handle('printer:print-receipt', async (event, printerPort, receiptData, shopInfo, isDuplicate = false) => {
  try {
    if (!printerPort) {
      return {
        success: false,
        error: 'No printer port specified'
      }
    }

    // Generate ESC/POS commands for receipt
    const escposCommands = generateReceiptCommands(receiptData, shopInfo, isDuplicate)
    
    console.log(`🖨️ [PRINTER] Printing receipt "${receiptData.receipt_number}" to ${printerPort}`)
    console.log(`🖨️ [PRINTER] ESC/POS buffer size: ${escposCommands.length} bytes`)

    // Use Windows Print API via PowerShell - this uses the proper printer driver
    return await useWindowsPrintAPI(printerPort, escposCommands)

  } catch (error) {
    console.error('❌ [PRINTER] Critical error:', error)
    return {
      success: false,
      error: error.message || 'Failed to print receipt'
    }
  }
})

/**
 * Send raw ESC/POS bytes to thermal printer via SerialPort (COM port)
 * Direct, simple, and reliable method that works with Bluetooth 2-inch thermal printers
 */
async function useWindowsPrintAPI(printerPort, escposCommands) {
  return new Promise((resolve) => {
    try {
      console.log(`🖨️ [PRINTER] Opening SerialPort: ${printerPort}`)
      console.log(`📊 [PRINTER] Buffer size: ${escposCommands.length} bytes`)

      // Open connection to printer COM port
      const port = new SerialPort({
        path: printerPort,
        baudRate: 9600,
        timeout: 5000
      })

      port.on('open', () => {
        console.log(`✅ [PRINTER] Port ${printerPort} opened successfully`)
        
        // Write ESC/POS commands to printer
        port.write(escposCommands, (err) => {
          if (err) {
            console.error(`❌ [PRINTER] Write error: ${err.message}`)
            port.close()
            resolve({
              success: false,
              error: `Failed to write to ${printerPort}: ${err.message}`
            })
            return
          }

          console.log(`✅ [PRINTER] Sent ${escposCommands.length} bytes to printer`)
          
          // Close port after a short delay to ensure data is sent
          setTimeout(() => {
            port.close((closeErr) => {
              if (closeErr) {
                console.warn(`⚠️ [PRINTER] Close warning: ${closeErr.message}`)
              } else {
                console.log(`✅ [PRINTER] Port closed`)
              }
              
              resolve({
                success: true,
                message: 'Receipt printed successfully'
              })
            })
          }, 500)
        })
      })

      port.on('error', (err) => {
        console.error(`❌ [PRINTER] Port error: ${err.message}`)
        resolve({
          success: false,
          error: `Printer ${printerPort} error: ${err.message}`
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
 * Get saved printer settings from renderer process
 * The renderer will have the actual settings in localStorage/db
 */
ipcMain.handle('printer:get-settings', async () => {
  return {
    printer_name: null,
    printer_port: null,
    auto_print: true,
    print_duplicate: false
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