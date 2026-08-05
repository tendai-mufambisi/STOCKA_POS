import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// electron/logger.js resolves its log directory from APPDATA at first write and
// caches it. Left alone, a test run would append to the real
// %APPDATA%/Stocka/logs — the same directory the live app uses. Point it at a
// throwaway directory instead: tests must never touch real user data.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'stocka-test-'))
process.env.APPDATA = sandbox
process.env.HOME = sandbox
