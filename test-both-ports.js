#!/usr/bin/env node

const fs = require('fs')

console.log('Testing COM3 and COM4 for printer connectivity...\n')

const testData = Buffer.from([
  0x1B, 0x40,                // ESC @ - Reset
  0x1B, 0x45, 0x01,          // Emphasized
  0x1B, 0x21, 0x38,          // Large
])

const testText = 'TEST\r\n'
const allData = Buffer.concat([testData, Buffer.from(testText), Buffer.from([0x1B, 0x69])])

async function testPort(portName) {
  return new Promise((resolve) => {
    console.log(`⏳ Testing ${portName}...`)
    
    fs.open(`\\\\.\\${portName}`, 'w', (err, fd) => {
      if (err) {
        console.log(`❌ ${portName}: Not available (${err.code})`)
        resolve(false)
        return
      }
      
      console.log(`✅ ${portName}: Opened, writing ${allData.length} bytes...`)
      
      fs.write(fd, allData, (writeErr) => {
        if (writeErr) {
          console.log(`❌ ${portName}: Write failed`)
          fs.close(fd, () => {})
          resolve(false)
          return
        }
        
        console.log(`✅ ${portName}: Write successful!`)
        
        fs.close(fd, () => {
          resolve(true)
        })
      })
    })
  })
}

async function main() {
  await testPort('COM3')
  console.log()
  await testPort('COM4')
  
  console.log('\n📝 Did either port cause your printer to respond?')
  console.log('   If COM4 worked, update Settings with COM4 instead of COM3')
}

main()
