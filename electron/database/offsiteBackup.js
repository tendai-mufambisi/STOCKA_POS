// The copy that leaves the building.
//
// A backup on the computer survives a corrupt database. A backup on the USB stick
// survives the computer dying. Neither survives the shop burning down, flooding, or
// being cleared out overnight — because both are sitting in the same room. This is
// the layer that answers that, and it is the only one a person has to do by hand.
//
// Stocka deliberately does NOT upload anything. No Google Drive integration, no
// account to connect, no financial records leaving the machine on their own. The
// shop exports a file and puts it wherever they already trust — their own Drive,
// their phone, a second stick kept at home. That keeps the promise that the data
// never leaves the building unless somebody decides to send it.
//
// The consequence is the thing this module is most careful about: once that file is
// gone, Stocka has no idea what happened to it. It cannot confirm the upload, cannot
// re-read it, cannot notice it being deleted. So nothing here ever uses the word
// "verified" about an off-site copy. What is verified is the file at the moment it
// was written; what is RECORDED is the owner saying they put it somewhere safe.
// Those are different claims and the difference is the honest part of the feature.
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const Database = require('better-sqlite3')
const logger = require('../logger')

// An exported file is a Stocka database with one extra table describing itself, so
// it is a single file that can still be opened, checked and restored — and can also
// say what it is months later when somebody finds it in a folder called "stuff".
const MANIFEST_TABLE = 'stocka_backup_manifest'

// How long before a recorded off-site copy is worth mentioning again. Far longer
// than the drive's three days: taking a file out of the building is a deliberate
// errand, not a daily habit, and nagging weekly would train people to ignore it.
const OFFSITE_STALE_DAYS = 30

let _userDataPath = null

function engine() { return require('./backupEngine') }

function init(userDataPath) {
  _userDataPath = userDataPath
}

// ── the exported file ─────────────────────────────────────────────────────────

// Stamps the copy with where it came from. Written into the file itself rather than
// a sidecar, because a sidecar is the thing that gets lost.
function writeManifest(filePath, details) {
  let db = null
  try {
    db = new Database(filePath, { fileMustExist: true })
    db.exec(`CREATE TABLE IF NOT EXISTS ${MANIFEST_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT
    )`)
    const insert = db.prepare(`INSERT OR REPLACE INTO ${MANIFEST_TABLE} (key, value) VALUES (?, ?)`)
    const writeAll = db.transaction((rows) => {
      for (const [key, value] of rows) insert.run(key, value == null ? null : String(value))
    })
    writeAll(Object.entries(details))

    // Back to a single self-contained file — the same reason local backups are
    // consolidated. An export that is really three files is an export that arrives
    // somewhere as one third of a database.
    db.pragma('journal_mode = DELETE')
  } finally {
    try { db && db.close() } catch (_) {}
  }
}

// What the file can tell you about itself, for anyone holding one and wondering.
function readManifest(filePath) {
  let db = null
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true })
    const present = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    ).pluck().get(MANIFEST_TABLE)
    if (!present) return null
    const rows = db.prepare(`SELECT key, value FROM ${MANIFEST_TABLE}`).all()
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  } catch (_) {
    return null
  } finally {
    try { db && db.close() } catch (_) {}
  }
}

// A name that means something to a person scrolling a Drive folder a year from now.
function suggestedFilename(shopName) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
  const shop = (shopName || 'Stocka')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'Stocka'
  return `${shop}_Backup_${stamp}.stockabackup`
}

// Write a verified copy of the ledger to somewhere outside Stocka's own folders.
// Same discipline as every other destination: land it, stamp it, read it back, and
// only then call it a success.
async function exportTo(destPath) {
  if (!_userDataPath) return { success: false, error: 'Not initialised' }
  if (engine().isSatellite()) {
    return {
      success: false, skipped: true,
      error: 'This till mirrors the Main computer. Export from the Main computer instead.',
    }
  }

  const startedAt = Date.now()
  try {
    const source = await freshLocalBackup()
    await fsp.mkdir(path.dirname(destPath), { recursive: true })
    await fsp.copyFile(source.path, destPath)

    let shopName = null
    let details = {}
    try {
      const db = engine().openLive()
      shopName = db.prepare('SELECT name FROM shops LIMIT 1').pluck().get() || null
      details = {
        sales: db.prepare('SELECT COUNT(*) FROM sales').pluck().get(),
        products: db.prepare('SELECT COUNT(*) FROM products').pluck().get(),
      }
    } catch (_) { /* a manifest without counts is still a useful manifest */ }

    writeManifest(destPath, {
      exported_at: new Date().toISOString(),
      app_version: require('../../package.json').version,
      shop_name: shopName,
      source_backup: source.filename,
      sales_count: details.sales,
      products_count: details.products,
      // Said inside the file, so it travels with it: this is the ledger, and the
      // things a replacement machine needs beyond it.
      contains: 'Complete Stocka records database.',
      not_included: 'Licence key and till pairing. A replacement computer needs Stocka activated again and any extra tills re-paired.',
    })

    const verdict = engine().verifyBackupFile(destPath)
    if (!verdict.ok) {
      try { await fsp.unlink(destPath) } catch (_) {}
      throw new Error(`The exported file could not be read back: ${verdict.error}`)
    }

    const durationMs = Date.now() - startedAt
    logger.info(`[Backup] Exported ${path.basename(destPath)} verified (${durationMs}ms)`)
    return {
      success: true,
      path: destPath,
      filename: path.basename(destPath),
      sizeBytes: verdict.sizeBytes,
      verified: true,
      durationMs,
    }
  } catch (err) {
    logger.error('[Backup] Export failed: ' + err.message)
    return { success: false, error: err.message }
  }
}

// Reuses the newest checked local backup rather than taking a separate snapshot, so
// the file somebody carries out of the building is the same artefact that was
// checked here.
async function freshLocalBackup() {
  const backups = await engine().listBackups()
  const newest = backups.find((b) => b.verified && b.kind === 'automatic')
  if (newest && Date.now() - new Date(newest.createdAt).getTime() < 2 * 60 * 1000) return newest

  const result = await engine().runBackupNow('export')
  if (!result.success) throw new Error(result.error || 'Could not create a backup to export')

  const updated = await engine().listBackups()
  const created = updated.find((b) => b.filename === result.filename)
  if (!created) throw new Error('The new backup could not be found')
  return created
}

// ── recording that a copy left the building ───────────────────────────────────

function readOffsiteState() {
  return engine().readStateSection('offsite') || {}
}

// The owner telling us they put a copy somewhere safe. This is testimony, not
// verification, and the field names say so — `recordedAt`, never `verifiedAt` — so
// that no screen reading this state can accidentally claim more than we know.
function recordCopy({ where, filename } = {}) {
  const now = new Date().toISOString()
  const prev = readOffsiteState()
  engine().writeStateSection('offsite', {
    ...prev,
    recordedAt: now,
    recordedWhere: where || null,
    recordedFilename: filename || null,
    timesRecorded: (prev.timesRecorded || 0) + 1,
  })
  logger.info(`[Backup] Off-site copy recorded${where ? ` (${where})` : ''}`)
  return getOffsiteState()
}

function forgetRecord() {
  engine().writeStateSection('offsite', null)
  return getOffsiteState()
}

function getOffsiteState() {
  const state = readOffsiteState()
  return {
    ...state,
    recorded: Boolean(state.recordedAt),
    // Stated explicitly rather than left to be inferred, because every consumer of
    // this object is one careless rename away from showing it as verified.
    verifiable: false,
  }
}

module.exports = {
  init,
  exportTo,
  recordCopy,
  forgetRecord,
  getOffsiteState,
  readManifest,
  suggestedFilename,
  MANIFEST_TABLE,
  OFFSITE_STALE_DAYS,
}
