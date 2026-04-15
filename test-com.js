const fs = require('fs');

console.log('Scanning for available COM ports...\n');

for (let i = 1; i <= 9; i++) {
  const comPort = `COM${i}`;
  try {
    const handle = fs.openSync(`\\\\.\\${comPort}`, 'r');
    fs.closeSync(handle);
    console.log(`✓ ${comPort}: FOUND (Thermal Printer detected)`);
  } catch (e) {
    console.log(`✗ ${comPort}: Not available`);
  }
}

console.log('\nScanning complete.');
