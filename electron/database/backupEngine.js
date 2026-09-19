// Owns every backup Stocka takes of its own database.
//
// What was here before was a bare fs.copyFile of stocka.db, fired only by a button
// in Settings. Three things were wrong with that, and all three are why this module
// exists:
//
//   • The database runs in WAL mode. A committed sale lives in stocka.db-wal until
//     a checkpoint folds it back into the main file, so copying stocka.db alone
//     could hand you a "backup" missing the last stretch of trading — or a torn
//     page, if the copy raced a write. SQLite's online backup API (exposed by
//     better-sqlite3 as db.backup()) is the only correct way to copy a live
//     database: it produces a single, fully checkpointed, self-contained file and
//     is safe to run mid-sale.
//
//   • Nothing ever read a backup back. A file existing on disk was treated as proof
//     of a working recovery copy. Here every backup is reopened and checked before
//     it counts, and a copy that fails verification is deleted rather than left
//     lying around looking like protection.
//
//   • Rotation was "keep the newest 10". Once backups are automatic that is ten
//     copies of one afternoon. The rotation below keeps recent, daily and weekly
//     tiers so there is still something to go back to a month later.
//
// Everything is gated on this machine being the authority for its own data. A
// satellite's database is a partial mirror — the delta sync deliberately never
// ships stock_movements or sale_holds — so a satellite backing itself up would
// produce a file that looks like a full backup and silently isn't.
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const Database = require('better-sqlite3')
const logger = require('../logger')
const { getDb } = require('./index')

const STATE_FILE    = 'backup_state.json'
const MANIFEST_FILE = 'manifest.json'
const BACKUPS_DIR   = 'backups'
const DB_FILE       = 'stocka.db'

// Rotation tiers. Anything surviving none of the three is deleted.
const KEEP_RECENT = 10   // most recent N, whatever their age
const KEEP_DAILY  = 14   // newest backup of each of the last N days
const KEEP_WEEKLY = 8    // newest backup of each of the last N weeks

// How long a write waits before triggering a backup. Long enough that a busy
// counter ringing up ten sales in a row produces one backup rather than ten,
// short enough that a till abandoned mid-afternoon is never far from protected.
const DEBOUNCE_MS = 90 * 1000

// Only these are auto-rotated. stocka_pre-reset_* and stocka_pre-restore_* are
// safety nets taken immediately before a destructive action, and deleting one to
// make room for a routine backup would defeat the point of having taken it.
const AUTO_BACKUP_RE = /^stocka_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.db$/

// Tables that must be present and readable for a backup to count as usable.
//
// Deliberately only the ones that have existed for as long as Stocka has, and
// whose absence means the file is not a Stocka database at all. It is tempting to
// list every table the app currently has, but that would condemn every backup
// taken before the newest feature shipped — a backup from before cash_movements
// existed is still a perfectly good backup of everything that existed then, and
// the migrations bring it forward when it is restored. Verification answers "is
// this a readable Stocka database", not "was it taken by today's version".
const CORE_TABLES = ['shops', 'users', 'products', 'sales', 'sale_items']

let _userDataPath = null
let _timer = null
let _inFlight = null       // single-flight promise, so two triggers can't race
let _pendingReason = null
let _stopped = false

// ── paths ─────────────────────────────────────────────────────────────────────

const dbPath      = () => path.join(_userDataPath, DB_FILE)
const backupsDir  = () => path.join(_userDataPath, BACKUPS_DIR)
const statePath   = () => path.join(_userDataPath, STATE_FILE)
const manifestPath = () => path.join(backupsDir(), MANIFEST_FILE)

const ensureDir = () => fsp.mkdir(backupsDir(), { recursive: true }).catch(() => {})

// ── state ─────────────────────────────────────────────────────────────────────
//
// Deliberately a file in userData and not a table in the database: backup history
// has to survive being restored over, and a row inside stocka.db would be replaced
// by whatever the restored backup happened to say about itself.
//
// Shaped with a per-destination key from the start, so 'external' and 'offsite'
// land here later without a migration.

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')) } catch (_) { return {} }
}

function writeState(state) {
  try {
    const tmp = statePath() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, statePath())
  } catch (err) {
    logger.warn('[Backup] Could not persist backup state: ' + err.message)
  }
}

function recordSuccess({ filename, sizeBytes, reason, durationMs }) {
  const now = new Date().toISOString()
  const state = readState()
  state.local = {
    lastAttemptAt:  now,
    lastSuccessAt:  now,
    lastVerifiedAt: now,
    lastFilename:   filename,
    lastSizeBytes:  sizeBytes,
    lastReason:     reason,
    lastDurationMs: durationMs,
    lastError:      null,
    consecutiveFailures: 0,
  }
  writeState(state)
}

// The state file has one owner, so other destinations (the external drive, and
// later the off-site copy) read and write their own section through here rather
// than opening the file themselves and racing this module's writes.
function readStateSection(key) {
  return readState()[key] || null
}

function writeStateSection(key, value) {
  const state = readState()
  if (value === null) delete state[key]
  else state[key] = value
  writeState(state)
}

function recordFailure(reason, message) {
  const state = readState()
  const prev = state.local || {}
  state.local = {
    ...prev,
    lastAttemptAt: new Date().toISOString(),
    lastReason:    reason,
    lastError:     message,
    consecutiveFailures: (prev.consecutiveFailures || 0) + 1,
  }
  writeState(state)
}

// ── manifest ──────────────────────────────────────────────────────────────────
//
// What we know about each file sitting in the backups folder. It exists so the
// Backups screen can distinguish a copy this engine created and verified from one
// it merely found — backups written by earlier versions of Stocka were never
// checked, and showing them as "Verified" because they happen to be on disk would
// be exactly the false assurance this whole rewrite is meant to remove.

function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf8')) } catch (_) { return {} }
}

function writeManifest(manifest) {
  try {
    const tmp = manifestPath() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8')
    fs.renameSync(tmp, manifestPath())
  } catch (err) {
    logger.warn('[Backup] Could not persist backup manifest: ' + err.message)
  }
}

function recordInManifest(filename, entry) {
  const manifest = readManifest()
  manifest[filename] = entry
  writeManifest(manifest)
}

// ── gating ────────────────────────────────────────────────────────────────────

function isSatellite() {
  try {
    const { getLanConfig, LAN_MODES } = require('../lan/lanConfig')
    return getLanConfig(_userDataPath).mode === LAN_MODES.CLIENT
  } catch (_) {
    return false
  }
}

// ── consolidation ─────────────────────────────────────────────────────────────

// A backup copied out of a WAL database is itself a WAL database, so the moment
// anything opens it — including our own verification pass — SQLite writes a
// stocka_….db-shm and stocka_….db-wal beside it. That matters more than it looks:
// a backup has to be ONE file. The moment somebody drags it to a USB stick, mails
// it, or restores it, those two sidecars are what decide whether they took a whole
// database or two thirds of one.
//
// Switching the copy to journal_mode = DELETE folds the log into the file and
// removes the sidecars, leaving a single self-contained database. The live
// database is untouched — this only ever runs against a finished copy.
function consolidate(filePath) {
  let db = null
  try {
    db = new Database(filePath, { fileMustExist: true })
    db.pragma('journal_mode = DELETE')
  } finally {
    try { db && db.close() } catch (_) {}
  }
}

// Remove a backup along with any sidecars it left behind, so rotation cannot leave
// an orphaned -wal/-shm pointing at a database that is no longer there.
async function removeBackup(filename) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { await fsp.unlink(path.join(backupsDir(), filename + suffix)) } catch (_) {}
  }
}

// ── verification ──────────────────────────────────────────────────────────────

// Open the finished copy as a real database and satisfy ourselves it could
// actually be restored. quick_check walks the pages and their indexes without the
// full cross-reference pass of integrity_check — on a shop-sized database it costs
// milliseconds, and it catches the truncation and torn-page failures that are the
// realistic way a backup goes bad.
function verifyBackupFile(filePath) {
  let db = null
  try {
    const stat = fs.statSync(filePath)
    if (!stat.size) return { ok: false, error: 'Backup file is empty' }

    db = new Database(filePath, { readonly: true, fileMustExist: true })

    const check = db.pragma('quick_check', { simple: true })
    if (String(check).toLowerCase() !== 'ok') {
      return { ok: false, error: `Integrity check failed: ${check}` }
    }

    const present = new Set(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).pluck().all()
    )
    const missing = CORE_TABLES.filter(t => !present.has(t))
    if (missing.length) {
      return { ok: false, error: `Backup is missing core tables: ${missing.join(', ')}` }
    }

    // Presence in sqlite_master is not the same as being readable — a corrupt
    // b-tree root shows up here and not above.
    for (const table of CORE_TABLES) {
      db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()
    }

    return { ok: true, sizeBytes: stat.size }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    try { db && db.close() } catch (_) {}
  }
}

// ── rotation ──────────────────────────────────────────────────────────────────

function isoWeekKey(date) {
  // Thursday of the same week determines the ISO year and week number.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

const dayKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// Newest first, then keep: every one of the last KEEP_RECENT; the newest survivor
// of each of the last KEEP_DAILY days; the newest survivor of each of the last
// KEEP_WEEKLY weeks. Whatever is left over is what gets deleted.
function selectForDeletion(entries) {
  const sorted = [...entries].sort((a, b) => b.date - a.date)
  const keep = new Set(sorted.slice(0, KEEP_RECENT).map(e => e.filename))

  const seenDays = new Map()
  for (const entry of sorted) {
    if (keep.has(entry.filename)) continue
    const key = dayKey(entry.date)
    if (!seenDays.has(key)) seenDays.set(key, entry)
  }
  for (const entry of [...seenDays.values()].sort((a, b) => b.date - a.date).slice(0, KEEP_DAILY)) {
    keep.add(entry.filename)
  }

  const seenWeeks = new Map()
  for (const entry of sorted) {
    if (keep.has(entry.filename)) continue
    const key = isoWeekKey(entry.date)
    if (!seenWeeks.has(key)) seenWeeks.set(key, entry)
  }
  for (const entry of [...seenWeeks.values()].sort((a, b) => b.date - a.date).slice(0, KEEP_WEEKLY)) {
    keep.add(entry.filename)
  }

  return sorted.filter(e => !keep.has(e.filename))
}

// stocka_2026-09-17T12-34-56-789Z.db -> Date, or null if this is not an auto backup.
function parseAutoBackupDate(filename) {
  const match = AUTO_BACKUP_RE.exec(filename)
  if (!match) return null
  const iso = match[1].replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z'
  )
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

async function rotate() {
  try {
    const files = await fsp.readdir(backupsDir())
    const entries = []
    for (const filename of files) {
      const date = parseAutoBackupDate(filename)   // skips pre-reset / pre-restore
      if (date) entries.push({ filename, date })
    }

    for (const entry of selectForDeletion(entries)) {
      // Sidecars go with it — see removeBackup.
      await removeBackup(entry.filename)
    }

    // Tidy up sidecars left by backups written before consolidation existed. Two
    // cases, and they are not the same thing:
    //
    //   • the database is gone — the sidecar is an orphan, just delete it
    //   • the database is still here — fold its log in, so that backup becomes the
    //     single file everything downstream (a USB copy, an export) assumes it is
    //
    // The second case only ever runs against a backup that passes verification
    // first. Opening a file we already suspect, read-write, to tidy it up would be
    // a strange way to look after somebody's records.
    const present = new Set(await fsp.readdir(backupsDir()))
    for (const name of present) {
      const base = name.replace(/-(wal|shm)$/, '')
      if (base === name) continue
      const basePath = path.join(backupsDir(), base)
      if (!present.has(base)) {
        try { await fsp.unlink(path.join(backupsDir(), name)) } catch (_) {}
      } else if (verifyBackupFile(basePath).ok) {
        try { consolidate(basePath) } catch (_) { /* leave it exactly as it was */ }
      }
    }

    // Drop manifest rows whose file is no longer there, so the manifest cannot
    // outgrow the folder it describes.
    const remaining = new Set(await fsp.readdir(backupsDir()))
    const manifest = readManifest()
    let changed = false
    for (const filename of Object.keys(manifest)) {
      if (!remaining.has(filename)) { delete manifest[filename]; changed = true }
    }
    if (changed) writeManifest(manifest)
  } catch (err) {
    logger.warn('[Backup] Rotation failed: ' + err.message)
  }
}

// ── listing ───────────────────────────────────────────────────────────────────

// Everything in the backups folder, newest first, annotated with what we actually
// know about it rather than what we would like to claim.
async function listBackups() {
  await ensureDir()
  const manifest = readManifest()
  const files = await fsp.readdir(backupsDir())
  const backups = []

  for (const filename of files) {
    if (!filename.startsWith('stocka_') || !filename.endsWith('.db')) continue
    const filePath = path.join(backupsDir(), filename)
    let stat
    try { stat = await fsp.stat(filePath) } catch (_) { continue }

    const known = manifest[filename] || null
    const autoDate = parseAutoBackupDate(filename)
    backups.push({
      filename,
      path: filePath,
      // The manifest's timestamp beats mtime: copying a backups folder between
      // machines rewrites mtime but not what the file actually contains.
      createdAt: known?.createdAt || (autoDate ? autoDate.toISOString() : stat.mtime.toISOString()),
      sizeBytes: stat.size,
      kind:      known?.kind || (autoDate ? 'automatic' : 'safety'),
      reason:    known?.reason || null,
      verified:  Boolean(known?.verifiedAt),
      verifiedAt: known?.verifiedAt || null,
    })
  }

  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  return backups
}

// A copy taken immediately before something destructive (a restore, a test-data
// reset). Named so rotation will never reclaim it, and verified like any other
// backup — a safety net nobody checked is not a safety net.
async function createSafetyCopy(label) {
  await ensureDir()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename  = `stocka_${label}_${timestamp}.db`
  const destPath  = path.join(backupsDir(), filename)

  await getDb().backup(destPath)
  consolidate(destPath)

  const verdict = verifyBackupFile(destPath)
  if (!verdict.ok) {
    await removeBackup(filename)
    throw new Error(`Could not take a safety copy before continuing: ${verdict.error}`)
  }

  recordInManifest(filename, {
    createdAt:  new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    sizeBytes:  verdict.sizeBytes,
    kind:       'safety',
    reason:     label,
  })

  logger.info(`[Backup] Safety copy ${filename} verified (${label})`)
  return { filename, path: destPath, sizeBytes: verdict.sizeBytes }
}

// ── the backup itself ─────────────────────────────────────────────────────────

async function performBackup(reason) {
  const startedAt = Date.now()
  await ensureDir()

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename  = `stocka_${timestamp}.db`
  const destPath  = path.join(backupsDir(), filename)

  try {
    // The online backup API, not a file copy: consistent against a live WAL
    // database and safe to run while a sale is being rung up.
    await getDb().backup(destPath)
    consolidate(destPath)

    const verdict = verifyBackupFile(destPath)
    if (!verdict.ok) {
      // A copy that failed verification is worse than no copy, because it looks
      // like protection in the backups list. Remove it and leave the last known
      // good backup as the newest thing standing.
      await removeBackup(filename)
      throw new Error(verdict.error)
    }

    recordInManifest(filename, {
      createdAt:  new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      sizeBytes:  verdict.sizeBytes,
      kind:       'automatic',
      reason,
    })

    await rotate()

    const durationMs = Date.now() - startedAt
    recordSuccess({ filename, sizeBytes: verdict.sizeBytes, reason, durationMs })
    logger.info(`[Backup] ${filename} verified (${reason}, ${durationMs}ms)`)

    // If the backup drive happens to be plugged in, it should get this copy too
    // rather than waiting to be unplugged and reconnected. Skipped when the
    // external layer is what asked for this backup in the first place, which would
    // otherwise be a loop.
    if (reason !== 'external') {
      try {
        const external = require('./externalBackup')
        if (external.getExternalState().connected) {
          external.backupToDrive('follow-local').catch(() => {})
        }
      } catch (_) { /* the external layer must never break a local backup */ }
    }

    return { success: true, filename, sizeBytes: verdict.sizeBytes, verified: true }
  } catch (err) {
    recordFailure(reason, err.message)
    logger.error(`[Backup] Failed (${reason}): ${err.message}`)
    return { success: false, error: err.message }
  }
}

// ── public API ────────────────────────────────────────────────────────────────

function init(userDataPath) {
  _userDataPath = userDataPath
  _stopped = false
  // Synchronously, so that anything reading the folder straight after init finds
  // it there rather than racing a promise nobody awaited.
  try { fs.mkdirSync(backupsDir(), { recursive: true }) } catch (_) {}
}

// Run one now and wait for it. Used by the manual button, by end of day, and on
// quit. Single-flight: a second caller joins the backup already running rather
// than starting a competing one.
function runBackupNow(reason = 'manual') {
  if (!_userDataPath) return Promise.resolve({ success: false, error: 'Backup engine not initialised' })
  if (isSatellite()) {
    return Promise.resolve({
      success: false,
      skipped: true,
      error: 'This till mirrors the Main computer. Backups are taken on the Main computer.',
    })
  }
  if (_inFlight) return _inFlight

  clearTimeout(_timer)
  _timer = null
  _pendingReason = null

  _inFlight = performBackup(reason).finally(() => { _inFlight = null })
  return _inFlight
}

// Something was written. Schedule a backup, coalescing everything arriving in the
// meantime into one run — a counter working through a queue of customers should
// cost one backup, not one per sale.
function requestBackup(reason = 'write') {
  if (!_userDataPath || _stopped || isSatellite()) return
  _pendingReason = _pendingReason || reason
  if (_timer) return
  _timer = setTimeout(() => {
    _timer = null
    const r = _pendingReason || reason
    _pendingReason = null
    runBackupNow(r).catch(() => {})
  }, DEBOUNCE_MS)
  if (typeof _timer.unref === 'function') _timer.unref()
}

// True while a write is waiting on the debounce or a backup is running — lets quit
// decide whether it owes the shop a final backup or can close immediately.
const hasPendingWork = () => _timer !== null || _inFlight !== null

function stop() {
  _stopped = true
  clearTimeout(_timer)
  _timer = null
}

function getState() {
  const state = readState()
  return {
    ...state,
    isSatellite: isSatellite(),
    pending: hasPendingWork(),
  }
}

module.exports = {
  init,
  runBackupNow,
  requestBackup,
  hasPendingWork,
  stop,
  getState,
  listBackups,
  createSafetyCopy,
  readStateSection,
  writeStateSection,
  isSatellite,
  // The live connection, for callers that need to read the ledger itself rather
  // than a backup of it (the export stamps a manifest from it).
  openLive: getDb,
  verifyBackupFile,
  rotate,
  dbPath,
  backupsDir,
  parseAutoBackupDate,
  // exported for tests
  selectForDeletion,
  AUTO_BACKUP_RE,
  KEEP_RECENT,
  KEEP_DAILY,
  KEEP_WEEKLY,
  DEBOUNCE_MS,
}
