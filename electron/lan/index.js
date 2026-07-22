const path = require('path')
const logger = require('../logger')
const { getLanConfig, saveLanConfig, getOrCreateSecret, LAN_MODES, DEFAULT_PORT } = require('./lanConfig')
const { createServer, getConnectedClients, generatePairingCode, getPairingInfo, broadcastEodClosed, broadcastChange, WRITE_CHANNELS_SERVER } = require('./lanServer')
const { startBeacon, scanForServers, getLocalIp } = require('./lanDiscovery')
const { OfflineQueue } = require('./offlineQueue')
const { updateMakeHandler } = require('../database/ipc')
const { setTillIdentityFromPairing, ensureMainIdentity } = require('./tillIdentity')

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
  const rawQueue = _queue ? _queue.peek() : []
  return {
    mode:        cfg.mode,
    isRunning,
    ip:          cfg.mode === LAN_MODES.SERVER && isRunning ? getLocalIp() : null,
    port:        cfg.serverPort || DEFAULT_PORT,
    clientCount: clients.length,
    clients,
    queueSize:   rawQueue.length,
    // Real business writes only — what the offline banner shows a cashier. Legacy
    // queue files can hold thousands of derived-state entries that are not
    // "pending records" in any sense a cashier would recognise.
    queueBusinessSize: _queue ? _queue.businessSize() : 0,
    // Enrich sale writes so a "this till" view can show real details (amount,
    // receipt number, item count) for sales still waiting to reach Main —
    // not just an opaque "1 write pending".
    queueItems:  rawQueue.map(item => {
      const base = { id: item.id, channel: item.channel, timestamp: item.timestamp }
      if (item.channel === 'domain:sales:add' && item.args?.[0]) {
        const sale = item.args[0]
        base.summary = {
          total: sale.total || 0,
          cashier: sale.cashier || null,
          receiptNumber: sale.receipt_number || null,
          paymentMethod: sale.payment_method || null,
          itemCount: Array.isArray(item.args[1]) ? item.args[1].length : 0,
        }
      }
      // Stock received while offline — enrich so the Stock Control page can show
      // the same "waiting to sync" highlight the Transactions page shows for sales.
      // (product_name isn't in the payload; the renderer resolves it from product_id.)
      if (item.channel === 'domain:stock:addReceiving' && item.args?.[0]) {
        const r = item.args[0]
        base.summary = {
          kind: 'supplier',
          productId: r.product_id ?? null,
          units: r.total_units || 0,
          costPerUnit: r.cost_per_unit || 0,
          recordedBy: r.recorded_by || null,
        }
      }
      if (item.channel === 'domain:stock:recordDirect' && item.args?.[0]) {
        const p = item.args[0]
        base.summary = {
          kind: 'direct',
          productId: p.product_id ?? null,
          units: p.quantity || 0,
          costPerUnit: p.cost_per_unit || 0,
          recordedBy: p.recorded_by || null,
        }
      }
      return base
    }),
    serverIp:         cfg.serverIp || null,
    clientOnline:     clientStatus?.online ?? null,
    clientConnecting: clientStatus?.connecting ?? false,
    lastSync:         clientStatus?.lastSync ?? null,
    lastSyncAt:       clientStatus?.lastSyncAt ?? null,
    lastSyncError:    clientStatus?.lastSyncError ?? null,
    clockSkewMs:      clientStatus?.clockSkewMs ?? 0,
    // True when this machine is holding the tray + sleep blocker as Main, so the
    // operator can see why it refuses to sleep and that closing it won't stop sync.
    backgroundMode:   (() => { try { return require('../backgroundServer').isActive() } catch (_) { return false } })(),
  }
}

function stopLan() {
  if (_stopBeacon) { _stopBeacon(); _stopBeacon = null }
  if (_server) { _server.close(() => {}); _server = null }
  if (_clientMod) { _clientMod.stopClient(); _clientMod = null }
}

// When running as the server, wrap write IPC handlers so that every local
// write also broadcasts a change event to any connected satellite SSE streams.
function makeServerHandler(channel, fn) {
  return (event, ...args) => {
    try {
      const result = fn(...args)
      if (WRITE_CHANNELS_SERVER.has(channel)) broadcastChange(channel)
      return result
    } catch (err) {
      return { __error: err.message }
    }
  }
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
  _server = createServer(secret, port, (ch, data) => notifyRenderer(ch, data), _userDataPath)
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
    (ch, data) => {
      // Always send the full status shape for lan:status-changed so the renderer
      // always gets mode + all fields, not just the partial client status object.
      if (ch === 'lan:status-changed') notifyRenderer(ch, getStatus())
      else notifyRenderer(ch, data)
    }
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

  // Main is always its own authority — standalone and server modes both get
  // the fixed till code 'M', assigned once and kept forever.
  if (cfg.mode !== LAN_MODES.CLIENT) ensureMainIdentity(userDataPath)

  let lanMakeHandler = null

  if (cfg.mode === LAN_MODES.SERVER) {
    startServerMode(cfg, secret)
    lanMakeHandler = makeServerHandler
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
      if (merged.mode !== LAN_MODES.CLIENT) ensureMainIdentity(_userDataPath)

      // Stop everything, then restart in the new mode
      stopLan()
      if (merged.mode === LAN_MODES.SERVER) {
        startServerMode(merged, sec)
        lanMakeHandler = makeServerHandler
      } else if (merged.mode === LAN_MODES.CLIENT && merged.serverIp) {
        startClientMode(merged, sec)
        lanMakeHandler = _clientMod.makeHandler
      }
      // Push the new handler into ipc.js so domain calls route correctly without restart
      updateMakeHandler(lanMakeHandler)

      // Becoming Main gains the tray + sleep blocker; leaving Main gives them up.
      try { require('../backgroundServer').refresh() } catch (_) {}

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
        const { secret, shopName, tillCode } = await lanClient.pair(serverIp, port, code)
        if (tillCode) setTillIdentityFromPairing(_userDataPath, tillCode)

        const current = getLanConfig(_userDataPath)
        const merged = { ...current, mode: LAN_MODES.CLIENT, serverIp, serverPort: port, secret }
        saveLanConfig(_userDataPath, merged)

        stopLan()
        startClientMode(merged, secret)
        updateMakeHandler(_clientMod.makeHandler)

        // This machine just became a satellite — drop the tray/sleep blocker it
        // would have been holding if it was previously Main.
        try { require('../backgroundServer').refresh() } catch (_) {}

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

    // Admin machine: after EOD is saved locally, push the eod_closed SSE event to all satellites
    ['lan:broadcast-eod-closed', (event, date, closedBy) => {
      if (_server) broadcastEodClosed(date, closedBy)
      return { ok: true }
    }],

    ['lan:sync-now', async () => {
      if (_clientMod) {
        await _clientMod.syncFromServer()
        return { ok: true, status: getStatus() }
      }
      return { ok: false, error: 'Not in client mode' }
    }],

    ['lan:clear-queue', () => {
      if (!_queue) return { ok: false, error: 'No queue.' }
      _queue.clear()
      notifyRenderer('lan:status-changed', getStatus())
      return { ok: true }
    }],
  ]

  return { lanHandlers, stopLan, makeHandler: lanMakeHandler }
}

module.exports = { initLan }
