#!/usr/bin/env node
// Usage: node tools/generate-license.js "Customer Name" "customer@email.com"
//
// Requires stocka-private.pem in the project root (never committed).
// Generate the keypair once:
//   openssl genrsa -out stocka-private.pem 2048
//   openssl rsa -in stocka-private.pem -pubout -out stocka-public.pem
// Then paste the contents of stocka-public.pem into electron/license.js.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const privateKeyPath = path.resolve(__dirname, '..', 'stocka-private.pem')

if (!fs.existsSync(privateKeyPath)) {
  console.error('\nError: stocka-private.pem not found at project root.')
  console.error('Generate it first:\n')
  console.error('  openssl genrsa -out stocka-private.pem 2048')
  console.error('  openssl rsa -in stocka-private.pem -pubout -out stocka-public.pem\n')
  process.exit(1)
}

const [customer, email] = process.argv.slice(2)
if (!customer) {
  console.error('\nUsage: node tools/generate-license.js "Customer Name" "customer@email.com"\n')
  process.exit(1)
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf8')

const licenseData = {
  customer,
  email: email || '',
  issued: new Date().toISOString(),
}

const payload = JSON.stringify(licenseData)
const signature = crypto.sign('sha256', Buffer.from(payload), privateKey)

const licenseKey = Buffer.from(JSON.stringify({
  data: licenseData,
  sig: signature.toString('base64'),
})).toString('base64')

const divider = '─'.repeat(64)
console.log(`\nLicense key for: ${customer}`)
console.log(divider)
console.log(licenseKey)
console.log(divider)
console.log(`Issued: ${licenseData.issued}`)
console.log('\nSend this key to the customer.\n')
