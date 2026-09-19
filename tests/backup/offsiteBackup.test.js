import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { freshDb, disposeDb, electronModule } from '../helpers/db.js'

const engine = electronModule('database/backupEngine.js')
const offsite = electronModule('database/offsiteBackup.js')

afterAll(disposeDb)

let userData
let away   // stands in for wherever the owner saves the file

beforeEach(() => {
  freshDb()
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'stocka-off-'))
  away = fs.mkdtempSync(path.join(os.tmpdir(), 'stocka-away-'))
  engine.init(userData)
  offsite.init(userData)
  engine.writeStateSection('offsite', null)
})

describe('exporting a copy', () => {
  it('writes a file that can be read back', async () => {
    const dest = path.join(away, 'shop.stockabackup')
    const result = await offsite.exportTo(dest)

    expect(result.success).toBe(true)
    expect(result.verified).toBe(true)
    expect(fs.existsSync(dest)).toBe(true)
  })

  it('produces a file that is itself a restorable backup', async () => {
    // The export is worthless if it cannot come back. It has to satisfy exactly
    // the same check as any backup Stocka made for itself.
    const dest = path.join(away, 'shop.stockabackup')
    await offsite.exportTo(dest)

    expect(engine.verifyBackupFile(dest).ok).toBe(true)
  })

  it('is a single file, with no sidecars to lose on the way', async () => {
    // Somebody is about to drag this into a Drive folder. If it is really three
    // files, they will upload one of them.
    const dest = path.join(away, 'shop.stockabackup')
    await offsite.exportTo(dest)

    const left = fs.readdirSync(away)
    expect(left).toEqual(['shop.stockabackup'])
  })

  it('does not leave a broken file behind when the destination is unusable', async () => {
    const blocked = path.join(away, 'blocked')
    fs.writeFileSync(blocked, 'a file where the folder should be')

    const result = await offsite.exportTo(path.join(blocked, 'nested', 'shop.stockabackup'))

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('refuses on a till that only mirrors Main', async () => {
    fs.writeFileSync(
      path.join(userData, 'lan_config.json'),
      JSON.stringify({ mode: 'client', serverIp: '10.0.0.2', serverPort: 7821 })
    )

    const result = await offsite.exportTo(path.join(away, 'shop.stockabackup'))
    expect(result.success).toBe(false)
    expect(result.skipped).toBe(true)
  })
})

describe('the file describes itself', () => {
  it('carries a manifest saying where it came from', async () => {
    // A year later this is a file called "shop.stockabackup" in a Drive folder.
    // It has to be able to answer what it is without Stocka present.
    const dest = path.join(away, 'shop.stockabackup')
    await offsite.exportTo(dest)

    const manifest = offsite.readManifest(dest)
    expect(manifest).toBeTruthy()
    expect(manifest.exported_at).toBeTruthy()
    expect(manifest.app_version).toBeTruthy()
  })

  it('says what a replacement computer will still need', async () => {
    // Restoring the ledger is not the same as being back in business: the machine
    // needs activating and the tills need re-pairing. Better to learn that from
    // the file than on the morning the shop is trying to reopen.
    const dest = path.join(away, 'shop.stockabackup')
    await offsite.exportTo(dest)

    const manifest = offsite.readManifest(dest)
    expect(manifest.not_included).toMatch(/licence|activat/i)
  })

  it('returns nothing for a file that carries no manifest', () => {
    const plain = path.join(away, 'plain.db')
    fs.writeFileSync(plain, 'not a database')
    expect(offsite.readManifest(plain)).toBeNull()
  })
})

describe('naming the file', () => {
  it('uses the shop name and a readable date', () => {
    const name = offsite.suggestedFilename('Mai Moyo Tuckshop')
    expect(name).toMatch(/^Mai-Moyo-Tuckshop_Backup_\d{4}-\d{2}-\d{2}_\d{4}\.stockabackup$/)
  })

  it('survives a shop name full of characters a filesystem will not take', () => {
    const name = offsite.suggestedFilename('Bra/Tino\\s "Shop" *2*')
    expect(name).not.toMatch(/[/\\"*]/)
    expect(name.endsWith('.stockabackup')).toBe(true)
  })

  it('falls back to something sensible when there is no shop name', () => {
    expect(offsite.suggestedFilename(null)).toMatch(/^Stocka_Backup_/)
    expect(offsite.suggestedFilename('***')).toMatch(/^Stocka_Backup_/)
  })
})

describe('recording that a copy left the building', () => {
  it('records when, and where the owner says they put it', () => {
    const state = offsite.recordCopy({ where: 'My Google Drive', filename: 'shop.stockabackup' })

    expect(state.recorded).toBe(true)
    expect(state.recordedAt).toBeTruthy()
    expect(state.recordedWhere).toBe('My Google Drive')
  })

  it('never records it as verified', () => {
    // The entire honesty of this feature lives in this distinction. Stocka wrote a
    // file; it has no idea whether it reached anyone's Drive, and it must not grow
    // a field that lets a screen imply otherwise.
    const state = offsite.recordCopy({ where: 'Drive' })

    expect(state.verifiable).toBe(false)
    expect(state.verifiedAt).toBeUndefined()
    expect(Object.keys(state).some((k) => /verified/i.test(k))).toBe(false)
  })

  it('accepts being told nothing about where it went', () => {
    const state = offsite.recordCopy({})
    expect(state.recorded).toBe(true)
    expect(state.recordedWhere).toBeNull()
  })

  it('keeps a count across repeats, so the habit is visible', () => {
    offsite.recordCopy({ where: 'Drive' })
    const state = offsite.recordCopy({ where: 'Drive' })
    expect(state.timesRecorded).toBe(2)
  })

  it('can be cleared', () => {
    offsite.recordCopy({ where: 'Drive' })
    const state = offsite.forgetRecord()
    expect(state.recorded).toBe(false)
  })

  it('reports nothing recorded on a fresh install', () => {
    const state = offsite.getOffsiteState()
    expect(state.recorded).toBe(false)
    expect(state.verifiable).toBe(false)
  })
})
