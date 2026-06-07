const fs = require('fs')
const logger = require('../logger')

let db = null
let SQL = null
let dbFilePath = null

async function initDb(filePath) {
  dbFilePath = filePath
  const initSqlJs = require('sql.js')
  SQL = await initSqlJs()

  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath)
    db = new SQL.Database(data)
    logger.info(`Database loaded: ${filePath}`)
  } else {
    db = new SQL.Database()
    logger.info(`New database created: ${filePath}`)
  }

  return db
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb first.')
  return db
}

function saveDb() {
  if (!db || !dbFilePath) return
  try {
    const data = db.export()
    const tmpPath = dbFilePath + '.tmp'
    fs.writeFileSync(tmpPath, Buffer.from(data))
    fs.renameSync(tmpPath, dbFilePath)
  } catch (err) {
    logger.error('Failed to save database: ' + err.message)
  }
}

function closeDb() {
  if (db) {
    saveDb()
    db.close()
    db = null
    logger.info('Database closed')
  }
}

function reopenDb() {
  if (!dbFilePath) throw new Error('No database path set')
  if (fs.existsSync(dbFilePath)) {
    const data = fs.readFileSync(dbFilePath)
    db = new SQL.Database(data)
  } else {
    db = new SQL.Database()
  }
  logger.info(`Database reopened: ${dbFilePath}`)
  return db
}

function getSql() {
  if (!SQL) throw new Error('SQL.js not initialized')
  return SQL
}

module.exports = { initDb, getDb, getSql, saveDb, closeDb, reopenDb }
