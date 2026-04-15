#!/usr/bin/env node

const fs = require('fs')

console.log('🔍 Testing COM port accessibility...\n')

for (let i = 1; i <= 9; i++) {
  const comPort = `COM${i}`
  try {
    // Try to open the COM port
    const handle = fs.openSync(`\\\\.\\${comPort}`, 'r')
    fs.closeSync(handle)
    console.log(`✅ ${comPort}: ACCESSIBLE (Printer likely here)`)
  } catch (e) {
    console.log(`❌ ${comPort}: Not accessible`)
  }
}

console.log('\n📝 If multiple ports show ACCESSIBLE:')
console.log('   COM3 is the main Bluetooth port for the printer')
console.log('   Other COMs might be alternate channels\n')

// Also test serial port library if available
console.log('🔍 Checking if serialport module is available...')
try {
  const SerialPort = require('serialport')
  console.log('✅ serialport module found')
  SerialPort.SerialPort.list().then(ports => {
    console.log('\n📦 Available ports:')
    ports.forEach(p => {
      console.log(`  - ${p.path}: ${p.manufacturer} ${p.productId ? '(PID: ' + p.productId + ')' : ''}`)
    })
  })
} catch {
  console.log('ℹ️  serialport module not installed (not needed for basic COM access)')
}
