// Removes ELECTRON_RUN_AS_NODE before launching Electron so the app
// starts correctly even when that variable is set in the shell session.
const { spawn } = require('child_process')
const path = require('path')

delete process.env.ELECTRON_RUN_AS_NODE

const electronPath = require('electron')
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: process.env
})

child.on('close', (code) => process.exit(code ?? 0))
