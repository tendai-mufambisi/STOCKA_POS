// `electron-builder install-app-deps` rebuilds native modules against the
// Electron ABI. That is needed for the desktop build and meaningless for the
// web one — Vercel runs `npm install` for `build:web`, where there is no
// Electron runtime to rebuild against, so the step can only cost build minutes
// or fail outright on a platform the desktop app never targets.
//
// Skipped on Vercel (and any CI that only builds the web bundle); local and
// desktop-release installs are unaffected.
const { execSync } = require('child_process');

if (process.env.VERCEL) {
  console.log('postinstall: Vercel detected — skipping electron-builder install-app-deps');
  process.exit(0);
}

try {
  execSync('electron-builder install-app-deps', { stdio: 'inherit' });
} catch (err) {
  console.error('postinstall: electron-builder install-app-deps failed:', err.message);
  process.exit(1);
}
