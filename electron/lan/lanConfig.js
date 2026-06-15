const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const LAN_MODES = { STANDALONE: 'standalone', SERVER: 'server', CLIENT: 'client' }
const CONFIG_FILE = 'lan_config.json'
const DEFAULT_PORT = 7821

function getLanConfig(userDataPath) {
  const filePath = path.join(userDataPath, CONFIG_FILE)
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (_) {}
  return { mode: LAN_MODES.STANDALONE, serverIp: null, serverPort: DEFAULT_PORT, secret: null }
}

function saveLanConfig(userDataPath, config) {
  const filePath = path.join(userDataPath, CONFIG_FILE)
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf8')
  fs.renameSync(tmpPath, filePath)
}

function getOrCreateSecret(userDataPath) {
  const cfg = getLanConfig(userDataPath)
  if (cfg.secret) return cfg.secret
  const secret = crypto.randomBytes(16).toString('hex')
  saveLanConfig(userDataPath, { ...cfg, secret })
  return secret
}

module.exports = { LAN_MODES, DEFAULT_PORT, getLanConfig, saveLanConfig, getOrCreateSecret }
