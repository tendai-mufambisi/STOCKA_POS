const fs = require('fs')
const path = require('path')

let logsDir = null
let logFile = null

function getLogFile() {
  if (logFile) return logFile
  const userDataPath = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Stocka')
    : path.join(process.env.HOME, 'Stocka')
  logsDir = path.join(userDataPath, 'logs')
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true })
  logFile = path.join(logsDir, `stocka-${new Date().toISOString().split('T')[0]}.log`)
  return logFile
}

/**
 * Write log entry to file with timestamp
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString()
  let logEntry = `[${timestamp}] [${level}] ${message}`
  
  if (data) {
    logEntry += `\n${JSON.stringify(data, null, 2)}`
  }
  logEntry += '\n'

  // Write to file
  try {
    fs.appendFileSync(getLogFile(), logEntry)
  } catch (err) {
    console.error('Failed to write to log file:', err)
  }

  // Also log to console in development
  if (process.env.NODE_ENV === 'development') {
    if (level === 'error') {
      console.error(`❌ ${message}`, data || '')
    } else if (level === 'warn') {
      console.warn(`⚠️ ${message}`, data || '')
    } else if (level === 'info') {
      console.log(`ℹ️ ${message}`, data || '')
    } else {
      console.log(`✅ ${message}`, data || '')
    }
  }
}

module.exports = {
  info: (msg, data) => log('INFO', msg, data),
  warn: (msg, data) => log('WARN', msg, data),
  error: (msg, data) => log('ERROR', msg, data),
  debug: (msg, data) => log('DEBUG', msg, data),
  getLogFile: () => getLogFile(),
  getLogsDir: () => logsDir
}
