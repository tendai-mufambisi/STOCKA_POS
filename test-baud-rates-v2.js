#!/usr/bin/env node

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const logFile = path.join(__dirname, 'printer-diagnostic.log')

function log(msg) {
  const timestamp = new Date().toLocaleTimeString()
  const line = `[${timestamp}] ${msg}`
  console.log(line)
  fs.appendFileSync(logFile, line + '\n')
}

async function testBaudRate(port, baudRate) {
  log(`\n=== Testing ${port} at ${baudRate} baud ===`)
  
  try {
    const psCommand = `
      $logFile = "${logFile}"
      function LogMsg([string]\\$msg) {
        $msg | Out-File -FilePath \\$logFile -Append
        Write-Host \\$msg
      }
      
      try {
        LogMsg "Opening ${port}..."
        \\$port = New-Object System.IO.Ports.SerialPort "${port}", ${baudRate}, None, 8, One
        \\$port.Handshake = [System.IO.Ports.Handshake]::None
        \\$port.ReadTimeout = 1000
        \\$port.WriteTimeout = 2000
        
        \\$port.Open()
        LogMsg "✓ Port opened at ${baudRate} baud"
        
        # Send ESC @ (reset)
        [byte[]]\\$bytes = @(0x1B, 0x40)
        \\$port.Write(\\$bytes, 0, \\$bytes.Length)
        LogMsg "✓ Sent reset command"
        
        # Send test
        [string]\\$text = "TEST\\r\\nBaud:${baudRate}\\r\\n"
        [byte[]]\\$tbytes = [System.Text.Encoding]::ASCII.GetBytes(\\$text)
        \\$port.Write(\\$tbytes, 0, \\$tbytes.Length)
        LogMsg "✓ Sent test text"
        
        Start-Sleep -Milliseconds 500
        \\$port.Close()
        LogMsg "✓ Closed port"
      } catch {
        LogMsg "✗ FAILED: \\$_"
      }
    `
    
    execSync(`powershell -NoProfile -Command "${psCommand}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'inherit']
    })
    
    log(`Result written to log file`)
  } catch (err) {
    log(`Command error: ${err.message.split('\n')[0]}`)
  }
}

async function main() {
  // Clear previous log
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile)
  }
  
  log('╔══════════════════════════════════════════════════════════╗')
  log('║  Bluetooth Thermal Printer Diagnostic Tool               ║')
  log('║  Testing baud rates for BT-58L printer on COM3           ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')
  log('⚠️  IMPORTANT: Make sure your BT-58L printer is:')
  log('   1. Powered ON')
  log('   2. Bluetooth connected to this computer')
  log('   3. Ready to receive data')
  log('')
  log('The test will try these baud rates:')
  log('   - 9600 (most common)')
  log('   - 19200')
  log('   - 38400')
  log('   - 115200')
  log('')
  log('Watch your printer during each test. It should print "TEST"')
  log('')
  
  const port = 'COM3'
  const baudRates = [9600, 19200, 38400, 115200]
  
  for (const baudRate of baudRates) {
    await testBaudRate(port, baudRate)
    
    // Wait between tests for printer to settle
    await new Promise(r => setTimeout(r, 2000))
  }
  
  log('')
  log('════════════════════════════════════════════════════════════')
  log('✅ Diagnostic complete!')
  log('')
  log('RESULTS: Check above - did your printer print any test page?')
  log('')
  log('If YES at baud rate X:')
  log('  1. Note the baud rate')
  log('  2. Update electron/main.js line with: 9600 -> X')
  log('  3. Restart Stocka')
  log('')
  log('Log saved to: ' + logFile)
  log('════════════════════════════════════════════════════════════')
}

main().catch(console.error)
