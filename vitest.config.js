import { defineConfig } from 'vitest/config'

// The analytics engine runs in the Electron main process, so its tests run in
// Node — not jsdom — and better-sqlite3 must be loaded by Node's own resolver
// rather than transformed by Vite.
//
// IMPORTANT: run these via `npm test`, not `npx vitest`.
//
// postinstall.js rebuilds better-sqlite3 against the Electron ABI, which the
// machine's own Node cannot load (ERR_DLOPEN_FAILED — Electron 29 is ABI 121,
// Node 24 is 137). `npm test` therefore runs vitest under Electron's bundled
// Node via ELECTRON_RUN_AS_NODE=1. That keeps a single native binary in the
// tree and means tests exercise the exact build the app ships, rather than a
// second copy compiled for a different runtime.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    server: { deps: { external: ['better-sqlite3'] } },
    // electron/ is CommonJS; tests are ESM and import it through interop.
    deps: { interopDefault: true },
    restoreMocks: true,
  },
})
