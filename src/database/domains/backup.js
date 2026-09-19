const wb = window.stocka.backup
const wd = window.stocka.db

export const exportBackupAsFile = (filename) => wb.exportAsFile(filename)
export const importBackupFromFile = (jsonString) => wb.importFromFile(jsonString)

// Legacy wrappers — map to the file-level db.* handlers
export const createDatabaseBackup = () => wd.backup()
export const getBackupHistory = async () => {
  const res = await wd.listBackups()
  return res?.backups || []
}
// Protection state: when the last verified backup happened, what failed last, and
// whether this machine is a satellite (which is backed up on Main, not here).
export const getBackupState = async () => {
  const res = await wd.backupState?.()
  return res?.state || null
}

// ── External backup drive ────────────────────────────────────────────────────
export const listBackupDrives = async () => {
  const res = await wd.listDrives?.()
  return res?.drives || []
}
export const setBackupDrive    = (letter, label) => wd.setDrive(letter, label)
export const forgetBackupDrive = ()              => wd.forgetDrive()
export const backupToDriveNow  = ()              => wd.externalNow()
export const onBackupDriveChange = (cb)          => wd.onExternalChange?.(cb) || (() => {})
export const restoreFromBackup = (filename) => wd.restore(filename)
export const manageBackupStorage = async () => {}
export const shouldCreateBackup = async () => false

// ── Off-site copy ────────────────────────────────────────────────────────────
// Stocka writes the file; a person carries it out of the building. Nothing here
// uploads anything, and nothing here can confirm what happened to the file after
// it was written — which is why the verb is "record", never "verify".
export const exportOffsiteBackup   = ()        => wd.exportOffsite()
export const recordOffsiteCopy     = (details) => wd.recordOffsite(details)
export const forgetOffsiteRecord   = ()        => wd.forgetOffsite()
export const restoreFromBackupFile = ()        => wd.restoreFromFile()
