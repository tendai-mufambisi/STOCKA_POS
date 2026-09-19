import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { freshDb, disposeDb, electronModule } from '../helpers/db.js'

const engine = electronModule('database/backupEngine.js')

afterAll(disposeDb)

let userData

function newUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocka-backup-'))
  engine.init(dir)
  return dir
}

const backupsIn = (dir) =>
  fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.endsWith('.db'))

// stocka_2026-09-17T12-34-56-789Z.db, the exact shape the engine writes.
const nameFor = (date) => `stocka_${date.toISOString().replace(/[:.]/g, '-')}.db`
const daysAgo = (n) => new Date(Date.now() - n * 86400000)

beforeEach(() => {
  freshDb()
  userData = newUserData()
})

describe('backup creation', () => {
  it('creates a backup that is a real, readable database', async () => {
    const result = await engine.runBackupNow('test')

    expect(result.success).toBe(true)
    expect(result.verified).toBe(true)

    const verdict = engine.verifyBackupFile(path.join(userData, 'backups', result.filename))
    expect(verdict.ok).toBe(true)
  })

  it('leaves a single self-contained file, not a database plus sidecars', async () => {
    // A backup copied out of a WAL database is itself in WAL mode, so verifying it
    // used to leave a -wal and a -shm beside it. Anyone copying "the backup" to a
    // USB stick would have taken one of three files.
    const { filename } = await engine.runBackupNow('test')

    const left = fs.readdirSync(path.join(userData, 'backups'))
    expect(left).toContain(filename)
    expect(left.filter((f) => f.endsWith('-wal') || f.endsWith('-shm'))).toEqual([])
  })

  it('records the backup as verified in the state file', async () => {
    await engine.runBackupNow('test')

    const state = engine.getState()
    expect(state.local.lastVerifiedAt).toBeTruthy()
    expect(state.local.lastError).toBeNull()
    expect(state.local.consecutiveFailures).toBe(0)
  })

  it('reports failure rather than claiming success when the backup cannot be written', async () => {
    // A full disk, a disconnected drive and a permissions problem all end here:
    // the backups folder cannot be written to. The engine must say so rather than
    // report a backup the shop does not have.
    const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'stocka-blocked-'))
    fs.writeFileSync(path.join(blocked, 'backups'), 'a file where the folder should be')
    engine.init(blocked)

    const result = await engine.runBackupNow('test')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()

    const state = engine.getState()
    expect(state.local.lastError).toBeTruthy()
    expect(state.local.consecutiveFailures).toBeGreaterThan(0)
  })
})

describe('verification', () => {
  it('rejects an empty file', () => {
    const file = path.join(userData, 'empty.db')
    fs.writeFileSync(file, '')
    expect(engine.verifyBackupFile(file).ok).toBe(false)
  })

  it('rejects a file that is not a database at all', () => {
    const file = path.join(userData, 'junk.db')
    fs.writeFileSync(file, 'this is not a sqlite database')
    expect(engine.verifyBackupFile(file).ok).toBe(false)
  })

  it('rejects a truncated backup — the realistic way a USB copy goes bad', async () => {
    const { filename } = await engine.runBackupNow('test')
    const file = path.join(userData, 'backups', filename)

    const full = fs.readFileSync(file)
    fs.writeFileSync(file, full.subarray(0, Math.floor(full.length / 2)))

    expect(engine.verifyBackupFile(file).ok).toBe(false)
  })

  it('accepts a backup taken before a recent feature shipped', async () => {
    // A backup from before cash_movements existed is still a good backup of
    // everything that existed then, and the migrations bring it forward when it is
    // restored. Requiring today's full schema would quietly condemn every backup
    // older than the newest feature — exactly the ones somebody reaches for.
    const { filename } = await engine.runBackupNow('test')
    const filePath = path.join(userData, 'backups', filename)

    const Database = electronModule('../node_modules/better-sqlite3/lib/index.js')
    const old = new Database(filePath)
    old.exec('DROP TABLE IF EXISTS cash_movements')
    old.close()

    expect(engine.verifyBackupFile(filePath).ok).toBe(true)
  })

  it('rejects a database that opens fine but is missing the core tables', () => {
    // A valid SQLite file is not the same thing as a usable Stocka backup.
    const Database = electronModule('../node_modules/better-sqlite3/lib/index.js')
    const file = path.join(userData, 'stranger.db')
    const other = new Database(file)
    other.exec('CREATE TABLE unrelated (id INTEGER)')
    other.close()

    const verdict = engine.verifyBackupFile(file)
    expect(verdict.ok).toBe(false)
    expect(verdict.error).toMatch(/core tables/i)
  })
})

describe('safety copies', () => {
  it('creates a verified copy under a name rotation will not reclaim', async () => {
    const copy = await engine.createSafetyCopy('pre-restore')

    expect(copy.filename).toContain('pre-restore')
    expect(engine.verifyBackupFile(copy.path).ok).toBe(true)
    // Rotation only ever considers plain stocka_<timestamp>.db names.
    expect(engine.parseAutoBackupDate(copy.filename)).toBeNull()
  })

  it('survives a rotation that would otherwise clear the folder', async () => {
    const copy = await engine.createSafetyCopy('pre-reset')

    // Fill the folder well past every tier.
    for (let i = 0; i < 40; i++) {
      fs.writeFileSync(path.join(userData, 'backups', nameFor(daysAgo(i * 30))), 'x')
    }
    await engine.rotate()

    expect(backupsIn(userData)).toContain(copy.filename)
  })
})

describe('rotation tiers', () => {
  const entries = (dates) => dates.map((d) => ({ filename: nameFor(d), date: d }))

  it('keeps everything while there is little to keep', () => {
    const dates = [0, 1, 2].map(daysAgo)
    expect(engine.selectForDeletion(entries(dates))).toEqual([])
  })

  it('keeps the most recent ten whatever their age', () => {
    // Twelve backups inside one afternoon: the old "keep newest 10" rule would
    // have been the entire policy, and everything older would already be gone.
    const dates = Array.from({ length: 12 }, (_, i) => new Date(Date.now() - i * 60000))
    const doomed = engine.selectForDeletion(entries(dates)).map((e) => e.filename)

    for (const d of dates.slice(0, engine.KEEP_RECENT)) {
      expect(doomed).not.toContain(nameFor(d))
    }
  })

  it('keeps one backup per day beyond the recent window', () => {
    // Four backups a day for a fortnight. The recent tier covers the last few
    // hours; the daily tier is what leaves yesterday recoverable.
    const dates = []
    for (let day = 0; day < 14; day++) {
      for (let n = 0; n < 4; n++) dates.push(new Date(Date.now() - day * 86400000 - n * 3600000))
    }
    const all = entries(dates)
    const doomed = new Set(engine.selectForDeletion(all).map((e) => e.filename))
    const survivors = all.filter((e) => !doomed.has(e.filename))

    const days = new Set(survivors.map((e) => e.date.toDateString()))
    expect(days.size).toBe(14)
  })

  it('still has a recovery point months back, which the old rule did not', () => {
    // One backup a day for a year.
    const all = entries(Array.from({ length: 365 }, (_, i) => daysAgo(i)))
    const doomed = new Set(engine.selectForDeletion(all).map((e) => e.filename))
    const survivors = all.filter((e) => !doomed.has(e.filename))

    const oldest = survivors.reduce((a, b) => (a.date < b.date ? a : b))
    const ageInDays = (Date.now() - oldest.date) / 86400000
    // Weekly tier reaches back roughly two months past the daily tier.
    expect(ageInDays).toBeGreaterThan(40)
  })

  it('deletes what survives none of the tiers', () => {
    const all = entries(Array.from({ length: 365 }, (_, i) => daysAgo(i)))
    const doomed = engine.selectForDeletion(all)

    expect(doomed.length).toBeGreaterThan(0)
    expect(doomed.length).toBeLessThan(all.length)
  })

  it('takes a backup\'s sidecars with it, leaving no orphans behind', async () => {
    const doomed = nameFor(daysAgo(400))
    for (const suffix of ['', '-wal', '-shm']) {
      fs.writeFileSync(path.join(userData, 'backups', doomed + suffix), 'x')
    }
    // Enough newer backups to fill every tier — including the weekly one, which
    // reaches back about two months — so the old copy survives none of them.
    for (let i = 0; i < 120; i++) {
      fs.writeFileSync(path.join(userData, 'backups', nameFor(daysAgo(i))), 'x')
    }

    await engine.rotate()
    const left = fs.readdirSync(path.join(userData, 'backups'))

    expect(left).not.toContain(doomed)
    expect(left).not.toContain(doomed + '-wal')
    expect(left).not.toContain(doomed + '-shm')
  })

  it('folds in the sidecars of an older backup that is still worth keeping', async () => {
    // A real backup from before consolidation existed: valid, but in WAL mode with
    // a -wal and -shm beside it.
    const { filename } = await engine.runBackupNow('test')
    const filePath = path.join(userData, 'backups', filename)
    const legacy = new (electronModule('../node_modules/better-sqlite3/lib/index.js'))(filePath)
    legacy.pragma('journal_mode = WAL')
    legacy.prepare('SELECT COUNT(*) FROM sales').pluck().get()
    legacy.close()

    await engine.rotate()

    const left = fs.readdirSync(path.join(userData, 'backups'))
    expect(left).toContain(filename)
    expect(left.filter((f) => f.endsWith('-wal') || f.endsWith('-shm'))).toEqual([])
    // and it is still a usable backup afterwards
    expect(engine.verifyBackupFile(filePath).ok).toBe(true)
  })

  it('leaves an unreadable older backup alone rather than opening it to tidy up', async () => {
    const junk = nameFor(daysAgo(2))
    fs.writeFileSync(path.join(userData, 'backups', junk), 'not a database')
    fs.writeFileSync(path.join(userData, 'backups', junk + '-wal'), 'x')

    await engine.rotate()

    // Still there, untouched — we do not open a suspect file read-write.
    expect(fs.readFileSync(path.join(userData, 'backups', junk), 'utf8')).toBe('not a database')
  })

  it('ignores files that are not automatic backups', async () => {
    fs.writeFileSync(path.join(userData, 'backups', 'stocka_pre-reset_2026-01-01.db'), 'x')
    fs.writeFileSync(path.join(userData, 'backups', 'notes.txt'), 'x')
    for (let i = 0; i < 40; i++) {
      fs.writeFileSync(path.join(userData, 'backups', nameFor(daysAgo(i * 30))), 'x')
    }

    await engine.rotate()
    const left = fs.readdirSync(path.join(userData, 'backups'))

    expect(left).toContain('stocka_pre-reset_2026-01-01.db')
    expect(left).toContain('notes.txt')
  })
})

describe('listing', () => {
  it('marks backups it created as checked and ones it merely found as not checked', async () => {
    const { filename } = await engine.runBackupNow('test')
    // A backup written by an older version of Stocka: on disk, never verified.
    const stranger = nameFor(daysAgo(3))
    fs.writeFileSync(path.join(userData, 'backups', stranger), 'x')

    const listed = await engine.listBackups()
    const mine = listed.find((b) => b.filename === filename)
    const theirs = listed.find((b) => b.filename === stranger)

    expect(mine.verified).toBe(true)
    expect(mine.kind).toBe('automatic')
    expect(theirs.verified).toBe(false)
  })

  it('returns backups newest first', async () => {
    for (const d of [daysAgo(1), daysAgo(5), daysAgo(3)]) {
      fs.writeFileSync(path.join(userData, 'backups', nameFor(d)), 'x')
    }
    const listed = await engine.listBackups()
    const times = listed.map((b) => new Date(b.createdAt).getTime())

    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})

describe('satellite gating', () => {
  it('refuses to back up a till that only mirrors Main', async () => {
    // A satellite's database is a partial mirror — the delta sync never ships
    // stock_movements or sale_holds — so a backup taken here would look complete
    // and silently not be.
    fs.writeFileSync(
      path.join(userData, 'lan_config.json'),
      JSON.stringify({ mode: 'client', serverIp: '192.168.0.10', serverPort: 7821 })
    )

    const result = await engine.runBackupNow('test')

    expect(result.success).toBe(false)
    expect(result.skipped).toBe(true)
    expect(backupsIn(userData)).toHaveLength(0)
  })

  it('backs up normally as Main', async () => {
    fs.writeFileSync(
      path.join(userData, 'lan_config.json'),
      JSON.stringify({ mode: 'server', serverPort: 7821 })
    )

    const result = await engine.runBackupNow('test')
    expect(result.success).toBe(true)
  })
})
