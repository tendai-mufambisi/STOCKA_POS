// Run once: node tools/generate-keypair.js
// Creates stocka-private.pem and stocka-public.pem in the project root.
// stocka-private.pem is gitignored — keep it safe, never share it.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const privateKeyPath = path.resolve(__dirname, '..', 'stocka-private.pem')
const publicKeyPath  = path.resolve(__dirname, '..', 'stocka-public.pem')

if (fs.existsSync(privateKeyPath)) {
  console.log('\n⚠️  stocka-private.pem already exists. Delete it first if you want to regenerate.\n')
  process.exit(1)
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

fs.writeFileSync(privateKeyPath, privateKey,  'utf8')
fs.writeFileSync(publicKeyPath,  publicKey,   'utf8')

console.log('\n✅ Keys generated successfully!\n')
console.log('  stocka-private.pem  ← KEEP THIS SECRET, never commit')
console.log('  stocka-public.pem   ← paste contents into electron/license.js\n')
console.log('Public key (copy everything below into electron/license.js):\n')
console.log(publicKey)
