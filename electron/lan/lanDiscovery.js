const dgram = require('dgram')
const os = require('os')

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

  socket.on('error', () => {}) // ignore "port in use" etc.

  socket.bind(() => {
    try { socket.setBroadcast(true) } catch (_) {}
    const ip = getLocalIp()
    const send = () => {
      try {
        const msg = Buffer.from(JSON.stringify({ stocka: true, ip, port: serverPort, shopName }))
        socket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255', () => {})
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

    socket.on('error', () => resolve([...found.values()]))

    socket.bind(DISCOVERY_PORT, () => {
      setTimeout(() => {
        try { socket.close() } catch (_) {}
        resolve([...found.values()])
      }, timeoutMs)
    })
  })
}

module.exports = { startBeacon, scanForServers, getLocalIp, DISCOVERY_PORT }
