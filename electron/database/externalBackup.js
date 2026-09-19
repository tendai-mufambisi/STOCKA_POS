// Verified copies of the ledger onto a USB stick or external drive.
//
// This is the layer that actually protects a shop from losing its computer. A
// backup sitting in %APPDATA% on the same machine survives a corrupt database; it
// does not survive the machine being stolen, dropped, or dying. The external copy
// is the one that does.
//
// Two decisions shape everything below.
//
// FINDING THE DRIVE. Not by drive letter — the same stick is E: today and F:
// tomorrow depending on what else is plugged in, and a backup system that silently
// stops working when Windows reassigns a letter is worse than none. Instead the
// drive carries a marker file with an id we generated when it was set up, and
// detection is "which attached volume is holding our marker". That is a handful of
// existsSync calls across the drive letters, cheap enough to poll every few
// seconds without spawning anything. Listing drives with labels for the setup
// screen is the only thing that needs PowerShell, and that runs on demand.
//
// NEVER TRUSTING THE WRITE. USB writes fail in ways local writes do not: the stick
// is pulled mid-copy, it is counterfeit and silently drops data, it is failing. So
// the copy lands under a .part name, is renamed into place only once complete, and
// is then opened and checked ON THE DRIVE. A copy that cannot be read back is
// deleted, and the previous external backup — which we know was good — is left
// standing as the most recent thing on the stick.
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const logger = require('../logger')

const DRIVE_FOLDER = 'Stocka Backups'
const DRIVE_MARKER = 'stocka-drive.json'
const PART_SUFFIX  = '.part'

// How many copies to leave on the stick. Lower than the local tiers on purpose:
// these are often small, and a drive that fills up stops protecting anything.
const KEEP_ON_DRIVE = 10

// How often to look for the drive. Pure filesystem checks, so this is close to
// free — the cost of noticing a stick within a few seconds of it being plugged in.
const POLL_MS = 8000

// A local backup older than this is not good enough to copy out; take a fresh one
// first. Otherwise plugging in the drive at closing time could hand you a copy of
// the shop as it stood hours ago.
const FRESH_ENOUGH_MS = 2 * 60 * 1000

// C: is the system drive and A:/B: are floppy letters nothing has used in decades.
const LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('')

let _userDataPath = null
let _timer = null
let _inFlight = null
let _stopped = false
let _onChange = null
let _lastSeenLetter = null   // checked first on each poll, so the usual case is one stat

// ── drive identity ────────────────────────────────────────────────────────────

const driveFolder = (letter) => path.join(`${letter}\\`, DRIVE_FOLDER)
const markerPath  = (letter) => path.join(driveFolder(letter), DRIVE_MARKER)

function readMarker(letter) {
  try { return JSON.parse(fs.readFileSync(markerPath(letter), 'utf8')) } catch (_) { return null }
}

// Which attached volume is carrying our marker? Returns the drive letter ("E:") or
// null. Deliberately identity-based rather than letter-based — see the header.
function findDrive(driveId) {
  if (!driveId) return null

  // The letter it was on last time is overwhelmingly the letter it is on now.
  if (_lastSeenLetter && readMarker(_lastSeenLetter)?.driveId === driveId) return _lastSeenLetter

  for (const ch of LETTERS) {
    const letter = `${ch}:`
    if (readMarker(letter)?.driveId === driveId) {
      _lastSeenLetter = letter
      return letter
    }
  }
  _lastSeenLetter = null
  return null
}

// Removable volumes currently attached, with their labels, for the setup screen.
// The one place PowerShell is worth it: a drive called "KINGSTON (E:)" is
// recognisable to the person holding it, where a bare letter is not.
function listRemovableDrives() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process')
    // DriveType 2 is "Removable Disk". USB hard drives report as 3 (Local Disk)
    // and are included too — plenty of shops back up to a small external HDD, and
    // excluding them would be an arbitrary restriction. The system drive is
    // filtered out below rather than by type.
    const script =
      'Get-CimInstance Win32_LogicalDisk | ' +
      'Where-Object { $_.DriveType -eq 2 -or $_.DriveType -eq 3 } | ' +
      'Select-Object DeviceID, VolumeName, FreeSpace, Size, DriveType | ConvertTo-Json -Compress'

    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          logger.warn('[Backup] Could not list drives: ' + err.message)
          return resolve([])
        }
        try {
          const raw = JSON.parse(stdout.trim() || '[]')
          const rows = Array.isArray(raw) ? raw : [raw]
          const systemDrive = (process.env.SystemDrive || 'C:').toUpperCase()
          resolve(rows
            .filter(r => r && r.DeviceID && r.DeviceID.toUpperCase() !== systemDrive)
            .map(r => ({
              letter:     r.DeviceID,
              label:      r.VolumeName || 'Removable drive',
              freeBytes:  Number(r.FreeSpace) || 0,
              totalBytes: Number(r.Size) || 0,
              removable:  r.DriveType === 2,
              // Already set up as this shop's backup drive?
              isBackupDrive: Boolean(readMarker(r.DeviceID)),
            })))
        } catch (parseErr) {
          logger.warn('[Backup] Could not read drive list: ' + parseErr.message)
          resolve([])
        }
      })
  })
}

// ── state ─────────────────────────────────────────────────────────────────────
//
// Lives alongside the local backup state, under its own key. Reads and writes go
// through backupEngine so there is exactly one owner of that file.

function engine() { return require('./backupEngine') }

function readExternalState() {
  return engine().readStateSection('external') || {}
}

function writeExternalState(patch) {
  const current = readExternalState()
  engine().writeStateSection('external', { ...current, ...patch })
}

// ── setting up / forgetting a drive ───────────────────────────────────────────

// Claim a drive as this shop's backup drive: create the folder and write the
// marker that findDrive looks for. Idempotent — re-adopting a drive that is
// already set up keeps its existing id, so the backups already on it stay ours.
async function adoptDrive(letter) {
  if (!/^[A-Za-z]:$/.test(letter)) throw new Error('Not a valid drive')

  const existing = readMarker(letter)
  const driveId = existing?.driveId || crypto.randomBytes(8).toString('hex')

  await fsp.mkdir(driveFolder(letter), { recursive: true })
  await fsp.writeFile(
    markerPath(letter),
    JSON.stringify({ driveId, adoptedAt: existing?.adoptedAt || new Date().toISOString() }, null, 2),
    'utf8'
  )

  // Confirm it is really there — a write-protected or failing stick can accept the
  // call and produce nothing, and finding that out now is far better than finding
  // it out on the day the computer dies.
  if (readMarker(letter)?.driveId !== driveId) {
    throw new Error('The drive did not accept the setup file. It may be write-protected or failing.')
  }

  _lastSeenLetter = letter
  writeExternalState({
    driveId,
    driveLabel: null,       // filled in by the caller, which has the friendly name
    adoptedAt:  new Date().toISOString(),
    lastError:  null,
  })

  logger.info(`[Backup] External drive set up at ${letter}`)
  return { driveId, letter }
}

function forgetDrive() {
  // The marker is deliberately left on the stick. Removing it would need the drive
  // to be plugged in, and "forget this drive" must work when it is lost or broken —
  // which is exactly when somebody reaches for it.
  _lastSeenLetter = null
  engine().writeStateSection('external', null)
  logger.info('[Backup] External drive forgotten')
}

// ── copying to the drive ──────────────────────────────────────────────────────

function parseBackupTime(filename) {
  return engine().parseAutoBackupDate(filename)
}

// Keep the newest KEEP_ON_DRIVE, and clear any .part files left by a copy that was
// interrupted — a half-written file must never look like a backup.
async function rotateOnDrive(destDir) {
  try {
    const files = await fsp.readdir(destDir)
    const backups = []

    for (const name of files) {
      if (name.endsWith(PART_SUFFIX)) {
        try { await fsp.unlink(path.join(destDir, name)) } catch (_) {}
        continue
      }
      const date = parseBackupTime(name)
      if (date) backups.push({ name, date })
    }

    backups.sort((a, b) => b.date - a.date)
    for (const stale of backups.slice(KEEP_ON_DRIVE)) {
      try { await fsp.unlink(path.join(destDir, stale.name)) } catch (_) {}
    }
  } catch (err) {
    logger.warn('[Backup] Could not tidy the external drive: ' + err.message)
  }
}

// The newest local backup that has been verified, taking a fresh one if what we
// have is stale. The external copy is a copy of a known-good local backup rather
// than a second independent snapshot, so the two destinations always hold the same
// artefact and "verified" means the same thing in both places.
async function freshLocalBackup() {
  const backups = await engine().listBackups()
  const newest = backups.find(b => b.verified && b.kind === 'automatic')

  if (newest && Date.now() - new Date(newest.createdAt).getTime() < FRESH_ENOUGH_MS) {
    return newest
  }

  const result = await engine().runBackupNow('external')
  if (!result.success) throw new Error(result.error || 'Could not create a backup to copy')

  const updated = await engine().listBackups()
  const created = updated.find(b => b.filename === result.filename)
  if (!created) throw new Error('The new backup could not be found')
  return created
}

// Put a verified copy of the newest local backup into destDir and check it where
// it lands. Separated from drive discovery because this is where data is actually
// at risk — everything above is just working out which letter the stick is on.
async function copyVerifiedBackupTo(destDir) {
  let partPath = null

  try {
    const source = await freshLocalBackup()
    await fsp.mkdir(destDir, { recursive: true })

    // Refuse rather than fill the stick to the last byte and leave it unable to
    // hold the next one. The margin is deliberate, not tight.
    const needed = source.sizeBytes * 1.2
    const free = await freeSpaceAt(destDir)
    if (free !== null && free < needed) {
      throw new Error(
        'Not enough room on the drive. The backup needs about ' +
        `${Math.ceil(needed / 1048576)} MB and there is ${Math.floor(free / 1048576)} MB free.`
      )
    }

    const destPath = path.join(destDir, source.filename)
    partPath = destPath + PART_SUFFIX

    // Land under .part, then rename. A stick pulled mid-copy leaves a .part that
    // the next rotation clears, never something that looks like a backup.
    await fsp.copyFile(source.path, partPath)
    await fsp.rename(partPath, destPath)
    partPath = null

    // Verify the copy where it now lives. This is the whole point: a file that
    // copied without error can still be unreadable on a failing stick. A copy that
    // fails here is deleted, leaving the previous known-good copy as the newest
    // thing on the drive.
    const verdict = engine().verifyBackupFile(destPath)
    if (!verdict.ok) {
      try { await fsp.unlink(destPath) } catch (_) {}
      throw new Error(`The copy on the drive could not be read back: ${verdict.error}`)
    }

    await rotateOnDrive(destDir)
    return { success: true, filename: source.filename, sizeBytes: verdict.sizeBytes, verified: true }
  } catch (err) {
    if (partPath) { try { await fsp.unlink(partPath) } catch (_) {} }
    return { success: false, error: err.message }
  }
}

async function performExternalBackup(reason) {
  const startedAt = Date.now()
  const { driveId } = readExternalState()

  if (!driveId) return { success: false, skipped: true, reason: 'not-configured' }

  const letter = findDrive(driveId)
  if (!letter) {
    writeExternalState({ connected: false })
    return { success: false, skipped: true, reason: 'not-connected' }
  }

  const result = await copyVerifiedBackupTo(driveFolder(letter))
  const now = new Date().toISOString()

  if (!result.success) {
    const prev = readExternalState()
    writeExternalState({
      connected:     Boolean(findDrive(driveId)),
      lastAttemptAt: now,
      lastReason:    reason,
      lastError:     result.error,
      consecutiveFailures: (prev.consecutiveFailures || 0) + 1,
    })
    logger.error(`[Backup] External copy failed (${reason}): ${result.error}`)
    return result
  }

  writeExternalState({
    connected:      true,
    letter,
    lastAttemptAt:  now,
    lastSuccessAt:  now,
    lastVerifiedAt: now,
    lastFilename:   result.filename,
    lastSizeBytes:  result.sizeBytes,
    lastReason:     reason,
    lastError:      null,
    consecutiveFailures: 0,
  })

  const durationMs = Date.now() - startedAt
  logger.info(`[Backup] External copy ${result.filename} verified on ${letter} (${reason}, ${durationMs}ms)`)
  return { ...result, letter, durationMs }
}

function freeSpaceAt(dirPath) {
  return new Promise((resolve) => {
    if (!fs.statfs) return resolve(null)
    fs.statfs(dirPath, (err, stats) => resolve(err ? null : stats.bsize * stats.bavail))
  })
}

// ── public API ────────────────────────────────────────────────────────────────

function backupToDrive(reason = 'manual') {
  if (!_userDataPath) return Promise.resolve({ success: false, error: 'Not initialised' })
  if (engine().isSatellite()) {
    return Promise.resolve({
      success: false, skipped: true, reason: 'satellite',
      error: 'This till mirrors the Main computer. The external backup is taken there.',
    })
  }
  if (_inFlight) return _inFlight

  _inFlight = performExternalBackup(reason).finally(() => { _inFlight = null })
  return _inFlight
}

// Separate from startWatching on purpose. Everything here needs to know where the
// app's data lives, but only Main watches for the drive — so hanging that path off
// the watcher meant "set up a drive" depended on the watcher having started first.
// That held today by luck of ordering rather than by design.
function init(userDataPath) {
  _userDataPath = userDataPath
}

// Watch for the drive being plugged in, and copy to it the moment it appears.
// The shop should not have to remember to press anything: plug it in, it updates.
function startWatching(onChange) {
  _onChange = onChange
  _stopped = false

  let wasConnected = false

  const tick = async () => {
    if (_stopped) return
    try {
      const { driveId } = readExternalState()
      const connected = Boolean(driveId && findDrive(driveId))

      if (connected !== wasConnected) {
        wasConnected = connected
        writeExternalState({ connected })
        if (_onChange) _onChange({ connected })

        // Arriving is the interesting edge. Leaving just means it is unplugged,
        // which is what a drive kept somewhere safe is supposed to be.
        if (connected) {
          logger.info('[Backup] Backup drive detected')
          await backupToDrive('drive-connected')
          if (_onChange) _onChange({ connected: true, justBackedUp: true })
        }
      }
    } catch (err) {
      logger.warn('[Backup] Drive watch error: ' + err.message)
    } finally {
      if (!_stopped) {
        _timer = setTimeout(tick, POLL_MS)
        if (typeof _timer.unref === 'function') _timer.unref()
      }
    }
  }

  tick()
}

function stopWatching() {
  _stopped = true
  clearTimeout(_timer)
  _timer = null
}

// What the UI shows. Includes whether the drive is attached right now, which is
// the difference between "your backup is 6 days old, plug the drive in" and "your
// backup is 6 days old and the drive is sitting right here".
function getExternalState() {
  const state = readExternalState()
  const connected = Boolean(state.driveId && findDrive(state.driveId))
  return {
    ...state,
    configured: Boolean(state.driveId),
    connected,
    letter: connected ? _lastSeenLetter : null,
    busy: _inFlight !== null,
  }
}

module.exports = {
  init,
  startWatching,
  stopWatching,
  backupToDrive,
  listRemovableDrives,
  adoptDrive,
  forgetDrive,
  getExternalState,
  findDrive,
  rotateOnDrive,
  copyVerifiedBackupTo,
  DRIVE_FOLDER,
  DRIVE_MARKER,
  KEEP_ON_DRIVE,
  POLL_MS,
}
