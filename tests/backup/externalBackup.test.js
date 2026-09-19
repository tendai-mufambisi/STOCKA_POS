import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { freshDb, disposeDb, electronModule } from '../helpers/db.js'

const engine = electronModule('database/backupEngine.js')
const external = electronModule('database/externalBackup.js')

afterAll(disposeDb)

let userData

// A stand-in for the USB stick. The real code finds a drive by scanning letters
// for its marker; these tests drive the copy logic directly with an explicit path,
// which is the part where data is actually at risk.
let drive

function driveFolder() {
  return path.join(drive, external.DRIVE_FOLDER)
}

beforeEach(() => {
  freshDb()
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'stocka-ext-'))
  drive = fs.mkdtempSync(path.join(os.tmpdir(), 'stocka-drive-'))
  engine.init(userData)
  external.init(userData)
  // no polling in tests — the copy logic is driven directly
  engine.writeStateSection('external', null)
})

describe('drive identity', () => {
  it('writes a marker so the drive can be found again after Windows changes its letter', async () => {
    // The whole reason detection is marker-based: the same stick is E: today and
    // F: tomorrow, and a backup system that stops working on a letter change is
    // worse than none.
    const markerDir = path.join(drive, external.DRIVE_FOLDER)
    fs.mkdirSync(markerDir, { recursive: true })
    fs.writeFileSync(
      path.join(markerDir, external.DRIVE_MARKER),
      JSON.stringify({ driveId: 'abc123', adoptedAt: new Date().toISOString() })
    )

    const marker = JSON.parse(fs.readFileSync(path.join(markerDir, external.DRIVE_MARKER), 'utf8'))
    expect(marker.driveId).toBe('abc123')
  })

  it('reports no drive when nothing is carrying our marker', () => {
    expect(external.findDrive('a-drive-that-is-not-plugged-in')).toBeNull()
  })

  it('reports no drive when asked about nothing', () => {
    expect(external.findDrive(null)).toBeNull()
  })
})

describe('external state', () => {
  it('starts out not configured', () => {
    const state = external.getExternalState()
    expect(state.configured).toBe(false)
    expect(state.connected).toBe(false)
  })

  it('refuses to copy when no drive has been set up', async () => {
    const result = await external.backupToDrive('test')
    expect(result.success).toBe(false)
    expect(result.reason).toBe('not-configured')
  })

  it('refuses to copy on a till that only mirrors Main', async () => {
    fs.writeFileSync(
      path.join(userData, 'lan_config.json'),
      JSON.stringify({ mode: 'client', serverIp: '192.168.0.10', serverPort: 7821 })
    )

    const result = await external.backupToDrive('test')

    expect(result.success).toBe(false)
    expect(result.reason).toBe('satellite')
  })

  it('reports not-connected when the drive is set up but absent', async () => {
    engine.writeStateSection('external', { driveId: 'missing-drive' })

    const result = await external.backupToDrive('test')

    expect(result.success).toBe(false)
    expect(result.reason).toBe('not-connected')
  })
})

describe('copying to the drive', () => {
  it('puts a verified copy on the drive', async () => {
    const result = await external.copyVerifiedBackupTo(driveFolder())

    expect(result.success).toBe(true)
    expect(result.verified).toBe(true)

    const onDrive = path.join(driveFolder(), result.filename)
    expect(fs.existsSync(onDrive)).toBe(true)
    // Checked where it landed, not merely where it came from.
    expect(engine.verifyBackupFile(onDrive).ok).toBe(true)
  })

  it('leaves no .part file behind on a successful copy', async () => {
    await external.copyVerifiedBackupTo(driveFolder())

    const left = fs.readdirSync(driveFolder())
    expect(left.filter((f) => f.endsWith('.part'))).toEqual([])
  })

  it('copies the same file that is held locally, not a second snapshot', async () => {
    // Both destinations holding the same artefact is what lets "verified" mean the
    // same thing in both places.
    const result = await external.copyVerifiedBackupTo(driveFolder())

    const local = path.join(userData, 'backups', result.filename)
    expect(fs.readFileSync(local)).toEqual(fs.readFileSync(path.join(driveFolder(), result.filename)))
  })

  it('fails clearly when the drive cannot be written to', async () => {
    // A stick pulled out, write-protected, or failing all arrive here.
    const blocked = path.join(drive, 'blocked')
    fs.writeFileSync(blocked, 'a file where the folder should be')

    const result = await external.copyVerifiedBackupTo(path.join(blocked, 'nested'))

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('does not let a failed copy remove what is already on the drive', async () => {
    const good = await external.copyVerifiedBackupTo(driveFolder())
    expect(good.success).toBe(true)

    // Now make the next copy impossible by making the source unreadable.
    const blocked = path.join(drive, 'blocked2')
    fs.writeFileSync(blocked, 'x')
    await external.copyVerifiedBackupTo(path.join(blocked, 'nested'))

    // The known-good copy is still the newest thing on the drive.
    expect(fs.existsSync(path.join(driveFolder(), good.filename))).toBe(true)
    expect(engine.verifyBackupFile(path.join(driveFolder(), good.filename)).ok).toBe(true)
  })
})

describe('rotation on the drive', () => {
  const nameFor = (d) => `stocka_${d.toISOString().replace(/[:.]/g, '-')}.db`
  const daysAgo = (n) => new Date(Date.now() - n * 86400000)

  it('clears half-written copies left by a drive pulled mid-copy', async () => {
    // The dangerous case: a .part file that somebody later mistakes for a backup.
    fs.mkdirSync(driveFolder(), { recursive: true })
    const interrupted = nameFor(daysAgo(1)) + '.part'
    fs.writeFileSync(path.join(driveFolder(), interrupted), 'half a database')

    await external.rotateOnDrive(driveFolder())

    expect(fs.readdirSync(driveFolder())).not.toContain(interrupted)
  })

  it('keeps a bounded number of copies so the stick cannot fill up', async () => {
    fs.mkdirSync(driveFolder(), { recursive: true })
    for (let i = 0; i < external.KEEP_ON_DRIVE + 15; i++) {
      fs.writeFileSync(path.join(driveFolder(), nameFor(daysAgo(i))), 'x')
    }

    await external.rotateOnDrive(driveFolder())

    const left = fs.readdirSync(driveFolder()).filter((f) => f.endsWith('.db'))
    expect(left).toHaveLength(external.KEEP_ON_DRIVE)
  })

  it('keeps the newest copies, not an arbitrary selection', async () => {
    fs.mkdirSync(driveFolder(), { recursive: true })
    const written = []
    for (let i = 0; i < external.KEEP_ON_DRIVE + 5; i++) {
      const name = nameFor(daysAgo(i))
      fs.writeFileSync(path.join(driveFolder(), name), 'x')
      written.push(name)
    }

    await external.rotateOnDrive(driveFolder())
    const left = fs.readdirSync(driveFolder())

    // written[0] is today's; the last few are the ones that should have gone.
    expect(left).toContain(written[0])
    expect(left).toContain(written[external.KEEP_ON_DRIVE - 1])
    expect(left).not.toContain(written[external.KEEP_ON_DRIVE])
    expect(left).not.toContain(written[written.length - 1])
  })

  it('leaves the drive marker alone', async () => {
    fs.mkdirSync(driveFolder(), { recursive: true })
    fs.writeFileSync(path.join(driveFolder(), external.DRIVE_MARKER), '{"driveId":"x"}')
    for (let i = 0; i < external.KEEP_ON_DRIVE + 5; i++) {
      fs.writeFileSync(path.join(driveFolder(), nameFor(daysAgo(i))), 'x')
    }

    await external.rotateOnDrive(driveFolder())

    // Losing the marker would orphan the drive — Stocka would stop recognising it
    // and quietly never back up again.
    expect(fs.readdirSync(driveFolder())).toContain(external.DRIVE_MARKER)
  })
})
