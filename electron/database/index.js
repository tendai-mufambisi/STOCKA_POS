const Database = require('better-sqlite3')
const logger = require('../logger')

let db = null
let dbFilePath = null

function initDb(filePath) {
  dbFilePath = filePath
  db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  logger.info(`Database opened: ${filePath}`)
  return db
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb first.')
  return db
}

// No-op: better-sqlite3 writes directly to disk on every statement
function saveDb() {}

function closeDb() {
  if (db) {
    db.close()
    db = null
    logger.info('Database closed')
  }
}

function reopenDb() {
  if (!dbFilePath) throw new Error('No database path set')
  if (db) { db.close(); db = null }
  db = new Database(dbFilePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  logger.info(`Database reopened: ${dbFilePath}`)
  return db
}

module.exports = { initDb, getDb, saveDb, closeDb, reopenDb }
