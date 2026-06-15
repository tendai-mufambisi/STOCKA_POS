const path = require('path')
const { getLanConfig, saveLanConfig, getOrCreateSecret, LAN_MODES, DEFAULT_PORT } = require('./lanConfig')
const { createServer, getConnectedClients } = require('./lanServer')
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

  _server = createServer(secret, port)
  _server.listen(port, '0.0.0.0', () => {
    console.log(`[LAN Server] Listening on 0.0.0.0:${port}`)
    notifyRenderer('lan:status-changed', getStatus())
  })
  _server.on('error', (err) => {
    console.error('[LAN Server] Failed to start:', err.message)
    notifyRenderer('lan:status-changed', { ...getStatus(), error: err.message })
  })

  _stopBeacon = startBeacon(port, shopName)
}

function startClientMode(cfg, secret) {
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

      return { ok: true, status: getStatus() }
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
