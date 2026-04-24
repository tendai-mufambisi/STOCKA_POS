const fs = require('fs')
const path = require('path')
const { app } = require('electron')

// Ensure logs directory exists
const logsDir = path.join(app.getPath('userData'), 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

// Log file path
const logFile = path.join(logsDir, `stocka-${new Date().toISOString().split('T')[0]}.log`)

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
    fs.appendFileSync(logFile, logEntry)
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
  getLogFile: () => logFile,
  getLogsDir: () => logsDir
}
