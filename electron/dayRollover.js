// Owns the trading-day boundary.
//
// Days used to go missing. A drawer left open at midnight simply kept running, so
// the shifts list showed one row spanning two or three dates, the days it swallowed
// had no row of their own, and every report filed their takings under the date the
// drawer opened. The only thing watching for this was a 30-minute setInterval,
// which does not fire at all while a laptop is suspended — and these shops close
// the lid at night.
//
// So the schedule here is deliberately paranoid rather than clever:
//
//   • Aim at the next local 00:00:05, but never sleep longer than 15 minutes. A
//     bare setTimeout to midnight is wrong three ways — a suspended timer neither
//     fires nor catches up, the clock can be corrected under it, and DST moves the
//     target. Re-checking on a short ceiling makes all three self-correcting.
//   • Wake on powerMonitor 'resume' and 'unlock-screen', so a machine opened at
//     08:00 rolls over before the first sale rather than up to 15 minutes later.
//   • Decide what to do by asking the database, never by trusting that a tick
//     "means" midnight. rollOverOpenShifts is idempotent, so an extra run is free
//     and a missed one is recoverable.
const logger = require('./logger')

const TICK_CEILING_MS = 15 * 60 * 1000

let _timer = null
let _running = false
let _stopped = false
let _userDataPath = null

function msUntilTick() {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5, 0)
  return Math.max(1000, Math.min(midnight - now, TICK_CEILING_MS))
}

// Satellites mirror shifts from Main via delta sync — rolling over locally would
// invent a second continuation for the same drawer.
function isSatellite() {
  try {
    const { getLanConfig, LAN_MODES } = require('./lan/lanConfig')
    return getLanConfig(_userDataPath).mode === LAN_MODES.CLIENT
  } catch (_) {
    return false
  }
}

function run(trigger = 'tick') {
  if (_running || isSatellite()) return []
  _running = true
  try {
    const { rollOverOpenShifts } = require('./database/domains/shifts')
    const rolled = rollOverOpenShifts()
    if (rolled.length > 0) {
      const failed = rolled.filter(r => !r.success)
      logger.info(
        `[DayRollover] (${trigger}) rolled ${rolled.length} shift(s) into the new day: ` +
        rolled.map(r => `${r.cashier}#${r.shiftId}${r.success ? '' : ` FAILED: ${r.error}`}`).join(', ')
      )
      if (failed.length > 0) {
        logger.error(`[DayRollover] ${failed.length} shift(s) could not be rolled over — they are still open`)
      }

      // Tell this machine's windows, then the satellites. Neither logs anyone out:
      // the cashier's drawer moved, they did not lose their session.
      try {
        require('./database/ipc').broadcastShiftEvent('shift:changed', {
          reason: 'rollover', timestamp: Date.now(),
          cashiers: rolled.filter(r => r.success).map(r => r.cashier),
        })
      } catch (_) {}
      try { require('./lan/lanServer').broadcastChange('domain:shifts:close') } catch (_) {}
    }
    return rolled
  } catch (err) {
    logger.error(`[DayRollover] check failed: ${err.message}`)
    return []
  } finally {
    _running = false
  }
}

function arm() {
  if (_stopped) return
  clearTimeout(_timer)
  _timer = setTimeout(() => { run('tick'); arm() }, msUntilTick())
  // Never hold the process open on our account — the tray/LAN server decides that.
  if (_timer.unref) _timer.unref()
}

function init(userDataPath) {
  _userDataPath = userDataPath
  _stopped = false

  // powerMonitor is only available after app.whenReady(), which is where this is
  // called from. backgroundServer already holds a powerSaveBlocker on Main, but
  // that prevents idle suspension — it does nothing about a closed lid.
  try {
    const { powerMonitor } = require('electron')
    powerMonitor.on('resume', () => { run('resume'); arm() })
    powerMonitor.on('unlock-screen', () => run('unlock'))
  } catch (err) {
    logger.error(`[DayRollover] power monitor unavailable: ${err.message}`)
  }

  run('boot')
  arm()
}

function stop() {
  _stopped = true
  clearTimeout(_timer)
  _timer = null
}

module.exports = { init, stop, run, msUntilTick }
