// Per-installation till identity: a short code ('M' for Main, 'S1'/'S2'/… for
// satellites) used to prefix receipt numbers and tag every sale with the till
// that rang it up. NEVER synced — this file is local to each machine on purpose,
// so two tills can never end up sharing (and racing over) the same identity.
const fs = require('fs')
const path = require('path')

const IDENTITY_FILE = 'till_identity.json'
const SATELLITE_COUNTER_FILE = 'till_satellite_counter.json' // Main-side only
const RECEIPT_COUNTER_FILE = 'till_receipt_counter.json'

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch (_) { return fallback }
}

function writeJson(filePath, data) {
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function getTillIdentity(userDataPath) {
  return readJson(path.join(userDataPath, IDENTITY_FILE), null)
}

function setTillIdentity(userDataPath, identity) {
  writeJson(path.join(userDataPath, IDENTITY_FILE), identity)
  return identity
}

// Called at startup whenever this machine is NOT a satellite (standalone or
// server/Main) — it is always its own authority, so it always gets code 'M'.
function ensureMainIdentity(userDataPath) {
  const existing = getTillIdentity(userDataPath)
  if (existing?.code === 'M') return existing
  return setTillIdentity(userDataPath, { code: 'M', label: existing?.label || 'Main' })
}

function setTillLabel(userDataPath, label) {
  const current = getTillIdentity(userDataPath) || { code: 'M' }
  return setTillIdentity(userDataPath, { ...current, label: String(label || '').trim() || current.label })
}

// Main-side: hand out the next satellite code ('S1', 'S2', …) when a till pairs
// for the first time. A fresh counter file per Main install; codes are never
// reused even if a satellite is later un-paired, so history stays unambiguous.
function allocateSatelliteCode(userDataPath) {
  const file = path.join(userDataPath, SATELLITE_COUNTER_FILE)
  const state = readJson(file, { n: 0 })
  state.n += 1
  writeJson(file, state)
  return `S${state.n}`
}

// Satellite-side: store the code + a friendly default label handed back by Main
// at pairing time. Re-pairing (e.g. after Force Full Resync) keeps the same
// identity file untouched unless pair-and-connect explicitly overwrites it.
function setTillIdentityFromPairing(userDataPath, code) {
  const n = parseInt(String(code).replace(/\D/g, ''), 10) || 1
  return setTillIdentity(userDataPath, { code, label: `Till ${n + 1}` })
}

// Allocates the next receipt number for THIS till, entirely from local state —
// works identically online or offline, and can never collide with another
// till's numbers because each till only ever touches its own counter file.
function nextReceiptNumber(userDataPath, tillCode, getDb) {
  const now = new Date()
  const todayPrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const file = path.join(userDataPath, RECEIPT_COUNTER_FILE)
  let state = readJson(file, null)

  if (!state || state.date !== todayPrefix || state.tillCode !== tillCode) {
    // New day (or first run, or the till's code changed after re-pairing) — reseed
    // from the local DB as a safety net in case the counter file was ever lost,
    // so a reinstalled till never reissues a number it already used today.
    let seed = 0
    try {
      const db = getDb()
      const like = `${tillCode}-${todayPrefix}-%`
      const last = db.prepare(
        `SELECT receipt_number FROM sales WHERE till_code = ? AND receipt_number LIKE ? ORDER BY receipt_number DESC LIMIT 1`
      ).pluck().get(tillCode, like)
      if (last) seed = parseInt(last.split('-').pop(), 10) || 0
    } catch (_) { /* DB not ready — start from 0, acceptable on first-ever sale */ }
    state = { date: todayPrefix, tillCode, counter: seed }
  }

  state.counter += 1
  writeJson(file, state)
  return `${tillCode}-${todayPrefix}-${String(state.counter).padStart(4, '0')}`
}

module.exports = {
  getTillIdentity, setTillIdentity, ensureMainIdentity, setTillLabel,
  allocateSatelliteCode, setTillIdentityFromPairing, nextReceiptNumber,
}
