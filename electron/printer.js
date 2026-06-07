'use strict'
// Cross-platform Bluetooth thermal printer via serialport.
// Handles discovery (Windows COM / macOS cu.* / Linux rfcomm) and raw ESC/POS writes.

const { SerialPort } = require('serialport')
const { exec } = require('child_process')
const { promisify } = require('util')
const logger = require('./logger')

const execAsync = promisify(exec)
const BAUD_RATE = 9600
const PRINT_TIMEOUT_MS = 15000

// ── Discovery ─────────────────────────────────────────────────────────────────

async function scanPrinters() {
  let all = []
  try {
    all = await SerialPort.list()
  } catch (err) {
    throw new Error('SerialPort.list() failed: ' + err.message)
  }

  logger.info(`[BT-SCAN] SerialPort.list() returned ${all.length} port(s)`)

  const platform = process.platform
  if (platform === 'win32')  return discoverWindows(all)
  if (platform === 'darwin') return discoverMacOS(all)
  return discoverLinux(all)
}

function discoverWindows(ports) {
  const bt = ports.filter(p =>
    (p.pnpId        && /^BTHENUM/i.test(p.pnpId)) ||
    (p.friendlyName && /bluetooth/i.test(p.friendlyName)) ||
    (p.manufacturer && /bluetooth/i.test(p.manufacturer))
  )

  // Show Bluetooth-flagged ports first; fall back to all COM ports if none found
  const list = bt.length > 0 ? bt : ports

  return list.map(p => ({
    path:         p.path,
    name:         p.friendlyName || p.path,
    manufacturer: p.manufacturer || '',
    type:         bt.includes(p) ? 'bluetooth' : 'serial'
  }))
}

function discoverMacOS(ports) {
  // /dev/cu.* = outgoing (correct for writing). /dev/tty.* = incoming — wrong direction.
  return ports
    .filter(p =>
      p.path.startsWith('/dev/cu.') &&
      !p.path.includes('Bluetooth-PDA-Sync') &&
      !p.path.includes('Bluetooth-Modem')
    )
    .map(p => ({
      path:         p.path,
      name:         p.path.replace('/dev/cu.', ''),
      manufacturer: p.manufacturer || '',
      type:         'bluetooth'
    }))
}

async function discoverLinux(ports) {
  const results = []

  // Bound rfcomm devices (explicitly connected Bluetooth serial)
  ports.filter(p => /^\/dev\/rfcomm/.test(p.path)).forEach(p => {
    results.push({ path: p.path, name: p.path, type: 'bluetooth', manufacturer: 'Bluetooth SPP' })
  })

  // ttyUSB as secondary (some adapters appear here)
  ports.filter(p => /^\/dev\/ttyUSB/.test(p.path)).forEach(p => {
    results.push({
      path:         p.path,
      name:         `${p.manufacturer ? p.manufacturer + ' — ' : ''}${p.path}`,
      type:         'usb-serial',
      manufacturer: p.manufacturer || ''
    })
  })

  // List paired Bluetooth devices so the user knows what to bind
  try {
    const { stdout } = await execAsync('bluetoothctl devices Paired', { timeout: 4000 })
    stdout.trim().split('\n').filter(Boolean).forEach((line, i) => {
      const m = line.match(/Device\s+([0-9A-Fa-f:]{17})\s+(.+)/)
      if (!m) return
      const candidatePath = `/dev/rfcomm${i}`
      if (!results.find(r => r.path === candidatePath)) {
        results.push({
          path:         candidatePath,
          name:         `${m[2]} (${m[1]})`,
          type:         'bluetooth-unbound',
          manufacturer: 'Bluetooth — not yet bound',
          hint:         `sudo rfcomm bind rfcomm${i} ${m[1]}`
        })
      }
    })
  } catch (_) { /* bluetoothctl not available on this distro */ }

  return results
}

// ── Raw print ─────────────────────────────────────────────────────────────────

async function printRaw(portPath, data) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portPath, baudRate: BAUD_RATE, autoOpen: false })

    const timer = setTimeout(() => {
      port.close(() => {})
      reject(new Error(
        `Print timed out after ${PRINT_TIMEOUT_MS / 1000}s. ` +
        'Is the printer powered on and in Bluetooth range?'
      ))
    }, PRINT_TIMEOUT_MS)

    const fail = (err) => {
      clearTimeout(timer)
      let msg = err.message || String(err)
      if (process.platform === 'linux') {
        if (/EACCES/.test(msg))
          msg += '\n\nFix: sudo usermod -a -G dialout $USER  (then log out and back in)'
        if (/ENOENT/.test(msg) && /rfcomm/.test(portPath))
          msg += `\n\nFix: sudo rfcomm bind ${portPath.replace('/dev/', '')} <MAC_ADDRESS>`
      }
      if (process.platform === 'win32' && /Access denied/i.test(msg))
        msg += '\n\nThe COM port may be held by the Windows print spooler. ' +
               'Try turning the printer off/on, or run: net stop spooler && net start spooler'
      port.close(() => {})
      reject(new Error(msg))
    }

    port.open((openErr) => {
      if (openErr) return fail(openErr)

      port.write(data, 'binary', (writeErr) => {
        if (writeErr) return fail(writeErr)

        port.drain((drainErr) => {
          if (drainErr) return fail(drainErr)
          clearTimeout(timer)
          // Let the printer buffer flush before closing
          setTimeout(() => {
            port.close((closeErr) => {
              if (closeErr) logger.warn('[BT-PRINT] Close error: ' + closeErr.message)
              resolve()
            })
          }, 500)
        })
      })
    })

    port.on('error', fail)
  })
}

// ── ESC/POS test page ─────────────────────────────────────────────────────────

function buildTestPage(portPath, shopName) {
  const ESC = '\x1B'
  const GS  = '\x1D'
  const LF  = '\n'
  const c   = []

  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-GB')
  const timeStr = now.toLocaleTimeString('en-GB')

  c.push(ESC + '@')           // initialize
  c.push(ESC + 'a\x01')      // center
  c.push(ESC + 'E\x01')      // bold
  c.push(ESC + '!\x38')      // double height+width
  c.push('STOCKA POS' + LF)
  c.push(ESC + '!\x00')      // normal size
  c.push(ESC + 'E\x00')      // bold off
  c.push('Test Print' + LF)
  c.push(ESC + 'a\x00')      // left
  c.push('-'.repeat(32) + LF)
  c.push(`Shop:  ${shopName || 'Stocka Shop'}` + LF)
  c.push(`Port:  ${portPath}` + LF)
  c.push(`Date:  ${dateStr}` + LF)
  c.push(`Time:  ${timeStr}` + LF)
  c.push('-'.repeat(32) + LF)
  c.push('Print quality:' + LF)
  ;[
    'Thin:  ' + '-'.repeat(24),
    'Bold:  ' + '='.repeat(24),
    'Hash:  ' + '#'.repeat(24),
    'Star:  ' + '*'.repeat(24)
  ].forEach(l => c.push(l + LF))
  c.push('-'.repeat(32) + LF)
  c.push(ESC + 'a\x01')      // center
  c.push(ESC + 'E\x01')
  c.push('PRINTER OK' + LF)
  c.push(ESC + 'E\x00')
  c.push('Powered by Stocka' + LF)
  c.push('\n\n\n')
  c.push(GS + 'V\x42')       // partial cut
  c.push(ESC + '@')           // reset

  return Buffer.from(c.join(''), 'binary')
}

module.exports = { scanPrinters, printRaw, buildTestPage }
