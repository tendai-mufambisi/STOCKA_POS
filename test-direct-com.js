#!/usr/bin/env node

/**
 * Simple direct COM port write test
 * Tests if we can write binary data directly to COM3
 */

const fs = require('fs')

console.log('╔════════════════════════════════════════════════════╗')
console.log('║  Direct COM Port Write Test for BT-58L Printer     ║')
console.log('╚════════════════════════════════════════════════════╝\n')

// Simple test receipt data
const testData = Buffer.from([
  0x1B, 0x40,                    // ESC @ - Reset printer
  0x1B, 0x45, 0x01,              // ESC E - Emphasized on
  0x1B, 0x21, 0x38,              // ESC ! - Large font
])

const testText = 'TEST PRINT\r\nFrom Node.js\r\n'
const textBuffer = Buffer.from(testText, 'utf-8')

const cutCommand = Buffer.from([0x1B, 0x69]) // ESC i - Cut paper

const allData = Buffer.concat([testData, textBuffer, cutCommand])

console.log(`Test data size: ${allData.length} bytes`)
console.log(`Content: ESC/POS commands + "TEST PRINT" + Cut\n`)

console.log('⏳ Attempting direct write to COM3...\n')

fs.open('\\\\.\\COM3', 'w', (err, fd) => {
  if (err) {
    console.error(`❌ FAILED to open COM3: ${err.message}`)
    console.error(`   Error code: ${err.code}`)
    console.log('\n📝 Possible causes:')
    console.log('   1. COM3 is not available')
    console.log('   2. Another application has the port open')
    console.log('   3. Windows permissions issue')
    console.log('   4. Bluetooth connection to printer is lost')
    process.exit(1)
  }
  
  console.log('✅ COM3 port opened successfully')
  console.log(`📤 Writing ${allData.length} bytes...`)
  
  fs.write(fd, allData, (writeErr) => {
    if (writeErr) {
      console.error(`❌ FAILED to write: ${writeErr.message}`)
      fs.close(fd, () => {})
      process.exit(1)
    }
    
    console.log('✅ Data written successfully!')
    console.log('⏳ Waiting 500ms for printer to process...')
    
    setTimeout(() => {
      fs.close(fd, (closeErr) => {
        if (closeErr) {
          console.warn(`⚠️  Close warning: ${closeErr.message}`)
        }
        console.log('✅ Port closed')
        console.log('\n🎉 Test complete!')
        console.log('\n📝 If your printer printed "TEST PRINT", the connection works!')
        console.log('   If nothing printed, check:')
        console.log('   - Printer is powered on')
        console.log('   - Bluetooth is still connected')
        console.log('   - COM3 is still the active port')
      })
    }, 500)
  })
})
