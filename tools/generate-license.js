#!/usr/bin/env node
// Usage: node tools/generate-license.js "Customer Name"
//
// Generates a 19-character license key: XXXX-XXXX-XXXX-XXXX
//
// The HMAC_SECRET below must match the one in electron/license.js.
// Change it once to something unique before you distribute the app.
// After distributing, do NOT change it — old keys will stop working.

const crypto = require('crypto')

// ── KEEP THIS IN SYNC WITH electron/license.js ──────────────────────────────
const HMAC_SECRET = '76d6d54eb2a4f41870407c78b43ad6151431f06465e20f0c'
// ────────────────────────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 chars, no 0/O/1/I

function toBase32(buf) {
  let bits = 0, val = 0, out = ''
  for (const byte of buf) {
    val = (val << 8) | byte
    bits += 8
    while (bits >= 5) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ALPHABET[(val << (5 - bits)) & 31]
  return out
}

const [customer] = process.argv.slice(2)
if (!customer) {
  console.error('\nUsage: node tools/generate-license.js "Customer Name"\n')
  process.exit(1)
}

// 6 random bytes (seed) + 4 bytes HMAC checksum = 10 bytes → 16 base32 chars
const seed = crypto.randomBytes(6)
const mac  = crypto.createHmac('sha256', HMAC_SECRET).update(seed).digest().slice(0, 4)
const raw  = toBase32(Buffer.concat([seed, mac]))
const key  = raw.match(/.{4}/g).join('-')

const divider = '─'.repeat(40)
console.log(`\nLicense key for: ${customer}`)
console.log(divider)
console.log(key)
console.log(divider)
console.log('Send this key to the customer.\n')
