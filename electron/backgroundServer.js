// Background (Main Computer) mode.
//
// A satellite can only reach Main while Main's process is alive — the LAN HTTP
// listener lives inside this process (lan/lanServer.js). Two things used to end
// that prematurely:
//
//   1. Clicking the window X quit the app outright (window-all-closed → app.quit),
//      taking the listener with it. Satellites went offline and queued.
//   2. Windows idle-slept the machine, freezing every process including ours.
//
// So when this machine is the Main Computer we (a) turn the X into "hide to tray"
// and (b) hold a power-save blocker. Both are released the moment the machine
// stops being Main — a satellite or standalone till keeps the old behaviour where
// closing the window really does quit.
const { app, Tray, Menu, powerSaveBlocker, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const logger = require('./logger')

let _tray = null
let _blockerId = null
let _active = false        // is this machine currently acting as Main?
let _quitting = false      // set once a real quit is underway, so 'close' stops being intercepted
let _userDataPath = null
let _getMainWindow = null
let _createWindow = null
let _balloonShown = false

// Background mode keeps a process alive after the window disappears. In dev that
// is a trap: the lingering process holds better_sqlite3.node open and the next
// `npm run dist` fails with a file lock, with no visible window to explain why.
// Set STOCKA_BACKGROUND=1 to exercise it from a dev run anyway.
function allowedHere() {
  return app.isPackaged || process.env.STOCKA_BACKGROUND === '1'
}

function isMainComputer() {
  try {
    const { getLanConfig, LAN_MODES } = require('./lan/lanConfig')
    return getLanConfig(_userDataPath).mode === LAN_MODES.SERVER
  } catch (_) {
    return false
  }
}

// ── Power-save blocker ───────────────────────────────────────────────────────
// 'prevent-app-suspension' maps to SetThreadExecutionState(ES_SYSTEM_REQUIRED) on
// Windows: it stops the *idle* sleep timer only. The display still turns off (which
// we want — a dark screen on an awake till is correct overnight), and it does NOT
// stop a deliberate Start→Sleep, a lid close, or a shutdown. Those stay the
// operator's responsibility.

function startBlocker() {
  if (_blockerId !== null && powerSaveBlocker.isStarted(_blockerId)) return
  try {
    _blockerId = powerSaveBlocker.start('prevent-app-suspension')
    logger.info('[Background] Sleep prevention ON — this machine will not idle-sleep while it is Main')
  } catch (err) {
    logger.error('[Background] Could not start power-save blocker: ' + err.message)
    _blockerId = null
  }
}

function stopBlocker() {
  if (_blockerId === null) return
  try {
    if (powerSaveBlocker.isStarted(_blockerId)) powerSaveBlocker.stop(_blockerId)
    logger.info('[Background] Sleep prevention OFF')
  } catch (err) {
    logger.error('[Background] Could not stop power-save blocker: ' + err.message)
  }
  _blockerId = null
}

// ── Tray ─────────────────────────────────────────────────────────────────────

function trayIcon() {
  const file = path.join(__dirname, '..', 'src', 'assets',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  if (fs.existsSync(file)) {
    const img = nativeImage.createFromPath(file)
    if (!img.isEmpty()) return img
  }
  // Tray construction throws on an empty image, which would take the whole app
  // down on startup. A 1px placeholder is a bad icon; a crash is worse.
  logger.warn('[Background] Tray icon asset missing — using a blank icon')
  return nativeImage.createEmpty()
}

function showWindow() {
  const win = _getMainWindow && _getMainWindow()
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } else if (_createWindow) {
    _createWindow()
  }
}

function buildTray() {
  if (_tray) return
  try {
    _tray = new Tray(trayIcon())
  } catch (err) {
    logger.error('[Background] Tray could not be created: ' + err.message)
    _tray = null
    return
  }
  _tray.setToolTip('Stocka — Main Computer. Running in the background so tills can sync.')
  _tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Stocka — Main Computer', enabled: false },
    { type: 'separator' },
    { label: 'Open Stocka', click: showWindow },
    {
      label: 'Quit Stocka (tills will stop syncing)',
      click: () => { _quitting = true; app.quit() },
    },
  ]))
  // Windows convention is double-click to restore; single click is forgiving.
  _tray.on('click', showWindow)
  _tray.on('double-click', showWindow)
  logger.info('[Background] Tray icon created — window X now hides instead of quitting')
}

function destroyTray() {
  if (!_tray) return
  try { _tray.destroy() } catch (_) {}
  _tray = null
}

// Tell the operator once per run where the app went — otherwise the first X looks
// like a crash and someone force-kills it from Task Manager.
function notifyHidden() {
  if (_balloonShown || !_tray) return
  _balloonShown = true
  if (process.platform !== 'win32') return
  try {
    _tray.displayBalloon({
      icon: trayIcon(),
      title: 'Stocka is still running',
      content: 'This is the Main Computer, so Stocka keeps running in the background for the other tills. Click the tray icon to reopen it.',
    })
  } catch (_) {}
}

// ── Start-with-Windows ───────────────────────────────────────────────────────
// A Windows Update reboot at 3am otherwise leaves the shop headless until someone
// notices the satellites have been queueing all morning.

function setAutoLaunch(on) {
  if (!app.isPackaged) return
  try {
    if (app.getLoginItemSettings().openAtLogin === on) return
    app.setLoginItemSettings({ openAtLogin: on })
    logger.info(`[Background] Start-with-Windows ${on ? 'enabled' : 'disabled'}`)
  } catch (err) {
    logger.error('[Background] Could not change start-with-Windows: ' + err.message)
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

// Attach the close interceptor to a window. Called for every window we create,
// because the decision to hide is made at close time, not at creation time.
function attachWindow(win) {
  if (!win) return
  win.on('close', (e) => {
    if (_quitting || !_active) return  // real quit, or not Main → close normally
    e.preventDefault()
    win.hide()
    logger.info('[Background] Window hidden — LAN server still serving satellites')
    notifyHidden()
  })
}

// Re-read LAN config and turn background mode on or off to match. Safe to call
// repeatedly; only acts on an actual change.
function refresh() {
  const want = allowedHere() && isMainComputer()
  if (want === _active) return _active
  _active = want
  if (want) {
    logger.info('[Background] This machine is the Main Computer — enabling background mode')
    buildTray()
    startBlocker()
    setAutoLaunch(true)
  } else {
    logger.info('[Background] This machine is no longer the Main Computer — disabling background mode')
    destroyTray()
    stopBlocker()
    setAutoLaunch(false)
    // A window hidden while this machine was Main would otherwise be unreachable
    // now that the tray is gone.
    showWindow()
  }
  return _active
}

function init(userDataPath, getMainWindow, createWindow) {
  _userDataPath = userDataPath
  _getMainWindow = getMainWindow
  _createWindow = createWindow

  // Any quit path (tray menu, Alt+F4 on a satellite, auto-updater relaunch,
  // OS shutdown) must stop the close interceptor or the app cannot exit.
  app.on('before-quit', () => { _quitting = true })

  refresh()
}

function isActive() { return _active }

module.exports = { init, refresh, attachWindow, isActive, showWindow }
