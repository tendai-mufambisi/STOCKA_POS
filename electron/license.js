const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

// ── KEEP THIS IN SYNC WITH tools/generate-license.js ────────────────────────
const HMAC_SECRET = '76d6d54eb2a4f41870407c78b43ad6151431f06465e20f0c'
// ────────────────────────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function fromBase32(str) {
  const lookup = {}
  for (let i = 0; i < ALPHABET.length; i++) lookup[ALPHABET[i]] = i
  let bits = 0, val = 0
  const out = []
  for (const ch of str) {
    if (!(ch in lookup)) return null
    val = (val << 5) | lookup[ch]
    bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

function verifyLicense(licenseString) {
  try {
    const raw = licenseString.trim().replace(/-/g, '').toUpperCase()
    if (raw.length !== 16) return null
    const bytes = fromBase32(raw)
    if (!bytes || bytes.length < 10) return null
    const seed        = bytes.slice(0, 6)
    const mac         = bytes.slice(6, 10)
    const expectedMac = crypto.createHmac('sha256', HMAC_SECRET).update(seed).digest().slice(0, 4)
    if (!mac.equals(expectedMac)) return null
    return { customer: 'Licensed', email: '', issued: '' }
  } catch {
    return null
  }
}

function getLicensePath() {
  return path.join(app.getPath('userData'), 'license.dat')
}

function saveLicense(licenseString) {
  fs.writeFileSync(getLicensePath(), licenseString.trim(), 'utf8')
}

function loadLicense() {
  try {
    const raw = fs.readFileSync(getLicensePath(), 'utf8')
    return verifyLicense(raw)
  } catch {
    return null
  }
}

function getRawKey() {
  try { return fs.readFileSync(getLicensePath(), 'utf8').trim() || null } catch { return null }
}

module.exports = { verifyLicense, saveLicense, loadLicense, getRawKey }
