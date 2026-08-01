import { createRequire } from 'node:module'

// Everything under electron/ is CommonJS and shares state through Node's module
// registry — electron/database/index.js holds the connection in a module-level
// singleton that every domain function reads via getDb().
//
// Loading those files with ESM `import` instead creates a SECOND instance of
// that module, so the connection opened by the test is invisible to the domain
// function under test ("Database not initialized"). createRequire puts the
// tests in the same registry the app uses, so there is exactly one singleton.
//
// Domain modules must therefore be reached through domain() below, never via a
// bare `import` in a test file.
const require = createRequire(import.meta.url)

const { initDb, getDb, closeDb } = require('../../electron/database/index.js')
const { createTables, runMigrations, ensureIndexes } = require('../../electron/database/schema.js')

/**
 * A fresh in-memory database built from the REAL production DDL — createTables +
 * runMigrations + ensureIndexes, exactly as the app boots. No hand-written
 * fixture schema: if a column, CHECK constraint or migration changes under a
 * metric, the test depending on it must break. That is the point.
 */
export function freshDb() {
  try { closeDb() } catch { /* nothing open yet */ }
  const db = initDb(':memory:')
  createTables(db)
  runMigrations(db)
  ensureIndexes(db)
  return db
}

export function disposeDb() {
  try { closeDb() } catch { /* already closed */ }
}

/** Load a domain module through the same registry as the DB singleton. */
export function domain(name) {
  return require(`../../electron/database/domains/${name}.js`)
}

/** Load any module under electron/ through that same registry. */
export function electronModule(relPath) {
  return require(`../../electron/${relPath}`)
}

export { getDb }
