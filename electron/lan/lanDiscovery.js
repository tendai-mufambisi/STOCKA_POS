const dgram = require('dgram')
const os = require('os')
const logger = require('../logger')

const DISCOVERY_PORT = 7820
const BEACON_INTERVAL_MS = 5000

function getLocalIp() {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return '127.0.0.1'
}

// Start broadcasting a UDP beacon every 5 seconds.
// Returns a stop() function.
function startBeacon(serverPort, shopName) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  let timer = null

  socket.on('error', (err) => {
    logger.warn(`[LAN Discovery] Beacon socket error: ${err.code || err.message} — satellites will need to enter the IP manually since Auto-Detect relies on this broadcast`)
  })

  socket.bind(() => {
    try { socket.setBroadcast(true) } catch (_) {}
    const ip = getLocalIp()
    logger.info(`[LAN Discovery] Beacon broadcasting on UDP ${DISCOVERY_PORT} — advertising ${ip}:${serverPort}`)
    const send = () => {
      try {
        const msg = Buffer.from(JSON.stringify({ stocka: true, ip, port: serverPort, shopName }))
        socket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255', (err) => {
          if (err) logger.warn(`[LAN Discovery] Beacon send failed: ${err.code || err.message}`)
        })
      } catch (_) {}
    }
    send()
    timer = setInterval(send, BEACON_INTERVAL_MS)
  })

  return function stop() {
    if (timer) { clearInterval(timer); timer = null }
    try { socket.close() } catch (_) {}
  }
}

// Listen on the discovery port for beacons for `timeoutMs` ms, then resolve with found servers.
function scanForServers(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const found = new Map() // ip → server info

    socket.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString())
        if (data.stocka && data.ip && data.port) found.set(data.ip, data)
      } catch (_) {}
    })

    socket.on('error', (err) => {
      logger.warn(`[LAN Discovery] Scan socket error: ${err.code || err.message} — this can happen if UDP port ${DISCOVERY_PORT} is blocked or already bound by another process`)
      resolve([...found.values()])
    })

    socket.bind(DISCOVERY_PORT, () => {
      setTimeout(() => {
        try { socket.close() } catch (_) {}
        logger.info(`[LAN Discovery] Scan finished — found ${found.size} server(s)`)
        resolve([...found.values()])
      }, timeoutMs)
    })
  })
}

module.exports = { startBeacon, scanForServers, getLocalIp, DISCOVERY_PORT }
