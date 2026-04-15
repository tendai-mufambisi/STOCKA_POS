#!/usr/bin/env node

/**
 * Bluetooth Thermal Printer Diagnostic Tool
 * Tests different baud rates and COM port settings to find what works
 */

const { execSync } = require('child_process')

async function testBaudRate(port, baudRate) {
  console.log(`\n🔧 Testing ${port} at ${baudRate} baud...`)
  
  try {
    const psCommand = `
      try {
        $port = New-Object System.IO.Ports.SerialPort "${port}", ${baudRate}, None, 8, One
        $port.Handshake = [System.IO.Ports.Handshake]::None
        $port.ReadTimeout = 1000
        $port.WriteTimeout = 2000
        
        $port.Open()
        Write-Host "✓ Port opened at ${baudRate} baud"
        
        # Send initialization sequence
        $initBytes = @(0x1B, 0x40)  # ESC @ (reset printer)
        $port.Write($initBytes, 0, $initBytes.Length)
        
        # Send test text
        $testText = "TEST OK\r\n"
        $testBytes = [System.Text.Encoding]::ASCII.GetBytes($testText)
        $port.Write($testBytes, 0, $testBytes.Length)
        
        # Cut paper
        $cutBytes = @(0x1B, 0x69)
        $port.Write($cutBytes, 0, $cutBytes.Length)
        
        Start-Sleep -Milliseconds 200
        $port.Close()
        
        Write-Host "✓ Test completed - check printer for output"
      } catch {
        Write-Host "✗ Failed: $($_.Exception.Message)"
      }
    `
    
    execSync(`powershell -NoProfile -Command "${psCommand}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: 5000
    })
  } catch (err) {
    console.log(`✗ Error: ${err.message.split('\n')[0]}`)
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║  Bluetooth Thermal Printer Diagnostic Tool        ║')
  console.log('║  Tests different baud rates on COM3               ║')
  console.log('╚═══════════════════════════════════════════════════╝')
  
  const port = 'COM3'
  const baudRates = [9600, 19200, 38400, 115200]
  
  console.log(`\nTesting port: ${port}`)
  console.log('Common thermal printer baud rates: 9600, 19200, 38400')
  console.log('\n⏳ Make sure your printer is powered on and ready...\n')
  
  for (const baudRate of baudRates) {
    await testBaudRate(port, baudRate)
    
    // Pause between tests
    await new Promise(r => setTimeout(r, 1000))
  }
  
  console.log('\n✅ Diagnostic complete!')
  console.log('\n📝 Notes:')
  console.log('- If printer prints at one of these baud rates, we found the correct setting')
  console.log('- Update the printer baud rate in electron/main.js with the working rate')
  console.log('- Most BT-58L printers use 9600 or 115200 baud')
}

main().catch(console.error)
