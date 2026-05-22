const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

// Paste the contents of stocka-public.pem here after running:
//   openssl genrsa -out stocka-private.pem 2048
//   openssl rsa -in stocka-private.pem -pubout -out stocka-public.pem
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiH5Fp9n83afr/49S6G9K
jxBKfHIx+LbaY269ZWfscJWty0kMqFpNXjnVbIBGhghl2HsBUtpvAtB03pLOuXk0
/M/k4vwOEz424N1sK5EpHU2CezsFY95dBUikokFknoHUfQaP+NmW9Ntc3sd15uxt
vpusgf+0R3Yyj+DGWKR9cueL+/Pqskr8gGZQPAuDcJnnBOEwN7m3kjyMeKr1VNML
G41FUWdPLSit/kPhrMlN5CUSSy2fnhnETq6TN9VY6LTuFkvBzkhKYISnnBd8TDBP
NkZf666KkHvs8fb2uBEYUsAVzYpT32Cg0X956+J/quZMcoTgzJNMzeMQQ7STtTge
pwIDAQAB
-----END PUBLIC KEY-----`

/**
 * Verify a base64-encoded license string against the embedded public key.
 * Returns the license data object on success, or null if invalid.
 */
function verifyLicense(licenseString) {
  try {
    const decoded = JSON.parse(Buffer.from(licenseString.trim(), 'base64').toString('utf8'))
    const payload = JSON.stringify(decoded.data)
    const signature = Buffer.from(decoded.sig, 'base64')
    const valid = crypto.verify('sha256', Buffer.from(payload), PUBLIC_KEY, signature)
    return valid ? decoded.data : null
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

module.exports = { verifyLicense, saveLicense, loadLicense }
