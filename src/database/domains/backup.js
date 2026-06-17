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
export const restoreFromBackup = (filename) => wd.restore(filename)
export const manageBackupStorage = async () => {}
export const shouldCreateBackup = async () => false
