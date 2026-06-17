const path = require('path')
const logger = require('../logger')
const { getLanConfig, saveLanConfig, getOrCreateSecret, LAN_MODES, DEFAULT_PORT } = require('./lanConfig')
const { createServer, getConnectedClients, generatePairingCode, getPairingInfo } = require('./lanServer')
const { startBeacon, scanForServers, getLocalIp } = require('./lanDiscovery')
const { OfflineQueue } = require('./offlineQueue')
const { updateMakeHandler } = require('../database/ipc')

let _server = null
let _stopBeacon = null
let _queue = null
let _userDataPath = null
let _getMainWindow = null
let _clientMod = null   // lanClient module, set only in CLIENT mode

function notifyRenderer(channel, data) {
  try {
    const win = _getMainWindow && _getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, data)
  } catch (_) {}
}

function getStatus() {
  const cfg = getLanConfig(_userDataPath)
  const isRunning = _server !== null && _server.listening
  const clients = getConnectedClients()
  const clientStatus = _clientMod ? _clientMod.getClientStatus() : null
  return {
    mode:        cfg.mode,
    isRunning,
    ip:          cfg.mode === LAN_MODES.SERVER && isRunning ? getLocalIp() : null,
    port:        cfg.serverPort || DEFAULT_PORT,
    clientCount: clients.length,
    clients,
    queueSize:   _queue ? _queue.size() : 0,
    serverIp:    cfg.serverIp || null,
    clientOnline: clientStatus?.online ?? null,
    lastSync:    clientStatus?.lastSync ?? null,
  }
}

function stopLan() {
  if (_stopBeacon) { _stopBeacon(); _stopBeacon = null }
  if (_server) { _server.close(() => {}); _server = null }
  if (_clientMod) { _clientMod.stopClient(); _clientMod = null }
}

function startServerMode(cfg, secret) {
  if (_server) { _server.close(() => {}); _server = null }
  if (_stopBeacon) { _stopBeacon(); _stopBeacon = null }

  const port = cfg.serverPort || DEFAULT_PORT
  const shop = (() => {
    try { return require('../database/domains/shop').getShop() } catch (_) { return null }
  })()
  const shopName = shop?.name || 'Stocka'

  logger.info(`[LAN] Starting Main Computer (server) mode on port ${port}`)
  _server = createServer(secret, port, (ch, data) => notifyRenderer(ch, data))
  _server.listen(port, '0.0.0.0', () => {
    logger.info(`[LAN Server] Listening on 0.0.0.0:${port}`)
    notifyRenderer('lan:status-changed', getStatus())
  })
  _server.on('error', (err) => {
    const detail = err.code === 'EADDRINUSE'
      ? `port ${port} is already in use — close any other program using it, or pick a different port in Network settings`
      : (err.code || err.message)
    logger.error(`[LAN] Server failed to start: ${detail}`)
    notifyRenderer('lan:status-changed', { ...getStatus(), error: err.message })
  })

  generatePairingCode()
  _stopBeacon = startBeacon(port, shopName)
}

function startClientMode(cfg, secret) {
  logger.info(`[LAN] Starting Satellite (client) mode → target ${cfg.serverIp}:${cfg.serverPort || DEFAULT_PORT}`)
  _clientMod = require('./lanClient')
  _clientMod.startClient(
    { serverIp: cfg.serverIp, serverPort: cfg.serverPort || DEFAULT_PORT, secret },
    _queue,
    (ch, data) => notifyRenderer(ch, data)
  )
}

// Called from main.js BEFORE registerDomainIpc.
// Returns:
//   makeHandler — null in standalone/server mode (uses local DB);
//                 lanClient.makeHandler in client mode (proxies writes to server)
//   lanHandlers — [channel, fn] pairs for lan:* IPC channels
//   stopLan     — cleanup function for app quit
function initLan(userDataPath, getMainWindow) {
  _userDataPath = userDataPath
  _getMainWindow = getMainWindow
  _queue = new OfflineQueue(path.join(userDataPath, 'offline_queue.json'))

  const cfg = getLanConfig(userDataPath)
  const secret = getOrCreateSecret(userDataPath)

  let lanMakeHandler = null

  if (cfg.mode === LAN_MODES.SERVER) {
    startServerMode(cfg, secret)
  } else if (cfg.mode === LAN_MODES.CLIENT && cfg.serverIp) {
    startClientMode(cfg, secret)
    lanMakeHandler = _clientMod.makeHandler
  }

  // ── lan:* IPC handlers ────────────────────────────────────────────────────

  const lanHandlers = [

    ['lan:get-status', () => getStatus()],

    ['lan:get-config', () => {
      const c = getLanConfig(_userDataPath)
      const { secret: _s, ...safe } = c
      return { ...safe, hasSecret: !!c.secret }
    }],

    ['lan:save-config', (event, newCfg) => {
      const current = getLanConfig(_userDataPath)
      const merged = { ...current, ...newCfg }

      // No-op if nothing relevant changed — avoids restarting an already-running
      // server (which would rotate the pairing code and briefly drop connections)
      // or re-pinging an already-connected client.
      const unchanged =
        current.mode === merged.mode &&
        current.serverPort === merged.serverPort &&
        (merged.mode !== LAN_MODES.CLIENT || current.serverIp === merged.serverIp)
      if (unchanged && ((merged.mode === LAN_MODES.SERVER && _server?.listening) ||
                         (merged.mode === LAN_MODES.CLIENT && _clientMod) ||
                         merged.mode === LAN_MODES.STANDALONE)) {
        return { ok: true, status: getStatus() }
      }

      saveLanConfig(_userDataPath, merged)

      const sec = getOrCreateSecret(_userDataPath)

      // Stop everything, then restart in the new mode
      stopLan()
      if (merged.mode === LAN_MODES.SERVER) {
        startServerMode(merged, sec)
        lanMakeHandler = null
      } else if (merged.mode === LAN_MODES.CLIENT && merged.serverIp) {
        startClientMode(merged, sec)
        lanMakeHandler = _clientMod.makeHandler
      }
      // Push the new handler into ipc.js so domain calls route correctly without restart
      updateMakeHandler(lanMakeHandler)

      // Server bind is async — the renderer's lan:status-changed subscription will get
      // the accurate status once the port is bound. Return a provisional status here.
      const provisionalStatus = getStatus()
      if (merged.mode === LAN_MODES.SERVER && !provisionalStatus.isRunning) {
        provisionalStatus.starting = true
      }
      return { ok: true, status: provisionalStatus }
    }],

    ['lan:discover', async () => {
      try {
        const servers = await scanForServers(5000)
        return { ok: true, servers }
      } catch (err) {
        return { ok: false, error: err.message, servers: [] }
      }
    }],

    ['lan:get-clients', () => getConnectedClients()],

    // Main computer: read/regenerate the one-time pairing PIN shown to the operator
    ['lan:get-pairing-info', () => {
      if (!_server) return { ok: false, error: 'Server not running.' }
      return { ok: true, info: getPairingInfo() }
    }],

    ['lan:regenerate-pairing-code', () => {
      if (!_server) return { ok: false, error: 'Server not running.' }
      return { ok: true, info: generatePairingCode() }
    }],

    // Satellite: exchange a pairing PIN for the Main computer's secret, switch to
    // client mode, then immediately pull a full snapshot so local data mirrors Main
    // exactly instead of merging with whatever was on this machine before.
    ['lan:pair-and-connect', async (event, { serverIp, serverPort, code }) => {
      const lanClient = require('./lanClient')
      const port = parseInt(serverPort) || DEFAULT_PORT
      try {
        const { secret, shopName } = await lanClient.pair(serverIp, port, code)

        const current = getLanConfig(_userDataPath)
        const merged = { ...current, mode: LAN_MODES.CLIENT, serverIp, serverPort: port, secret }
        saveLanConfig(_userDataPath, merged)

        stopLan()
        startClientMode(merged, secret)
        updateMakeHandler(_clientMod.makeHandler)

        await lanClient.applyFullSnapshot(serverIp, port, secret)

        notifyRenderer('lan:status-changed', getStatus())
        return { ok: true, shopName, status: getStatus() }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    }],

    // Satellite: manually wipe-and-reseed from Main. Recovery tool for when delta
    // sync has drifted, or to re-mirror after the satellite's data diverged.
    ['lan:force-resync', async () => {
      if (!_clientMod) return { ok: false, error: 'Not in satellite mode.' }
      try {
        const cfg = getLanConfig(_userDataPath)
        await _clientMod.applyFullSnapshot(cfg.serverIp, cfg.serverPort || DEFAULT_PORT, cfg.secret)
        return { ok: true, status: getStatus() }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    }],

    ['lan:stop', () => {
      stopLan()
      notifyRenderer('lan:status-changed', getStatus())
      return { ok: true }
    }],

    ['lan:sync-now', async () => {
      if (_clientMod) {
        await _clientMod.syncFromServer()
        return { ok: true, status: getStatus() }
      }
      return { ok: false, error: 'Not in client mode' }
    }],
  ]

  return { lanHandlers, stopLan, makeHandler: lanMakeHandler }
}

module.exports = { initLan }
