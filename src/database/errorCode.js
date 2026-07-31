// Restores machine-readable error codes on the renderer side.
//
// Main puts a code on refusals it expects the UI to handle specially (currently
// TILL_UNREACHABLE — "that cashier's till is offline, so these totals can't be
// trusted"). Electron's contextBridge clones thrown Errors and keeps only the
// message, so preload.js smuggles the code through as a "[CODE] message" prefix.
// This unwraps it, leaving the user-facing message clean and err.code usable.

const CODED = /^\[([A-Z][A-Z0-9_]*)\]\s([\s\S]*)$/

export function withErrorCode(promise) {
  return Promise.resolve(promise).catch((err) => {
    const m = CODED.exec(err?.message || '')
    if (!m) throw err
    const wrapped = new Error(m[2])
    wrapped.code = m[1]
    throw wrapped
  })
}
