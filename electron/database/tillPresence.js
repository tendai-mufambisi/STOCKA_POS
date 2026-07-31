// Which till a write came from, and which tills Main can currently see.
//
// Two separate things live here because they answer the same question from
// opposite ends:
//
//   • _requestTill — the till code of the satellite whose /lan/invoke call is
//     running right now (set by the LAN server, cleared straight after, exactly
//     like audit.setRequestMachine). Null for Main's own IPC writes.
//   • _presenceProvider — a function the LAN server installs so domain code can
//     ask "is till S2 connected, and has it drained its offline queue?" without
//     the database layer having to know anything about HTTP.
//
// Closing a cashier's drawer from Main while their till is unreachable computes
// the variance from sales Main has never seen. The presence check is what lets
// closeShift refuse that.

// `remote` matters independently of `till`: a satellite running an older build
// sends no till header, so the code is null even though the write is definitely
// NOT this machine's. Without that distinction its shifts would be stamped with
// Main's own till code and silently escape the close guard.
let _request = { remote: false, till: null }
function setRequestTill(code, remote = true) { _request = { remote, till: code || null } }
function clearRequestTill() { _request = { remote: false, till: null } }
function getRequestTill() { return _request.till }
function isRemoteRequest() { return _request.remote }

// This machine's own till code ('M' on Main/standalone, 'S1'… on a satellite).
// Set once at startup by electron/lan/index.js.
let _localTill = null
function setLocalTillCode(code) { _localTill = code || null }
function getLocalTillCode() { return _localTill }

// () => [{ till, lastSeen, pending }] — installed by the LAN server when it starts.
let _presenceProvider = null
function setPresenceProvider(fn) { _presenceProvider = typeof fn === 'function' ? fn : null }

// A till counts as present when Main has heard from it inside this window. The
// satellite pings every few seconds, so 20 s tolerates one missed beat without
// declaring a live till dead.
const PRESENCE_WINDOW_MS = 20_000

// Returns { observable, seen, online, pending, lastSeen } for a till code.
//   observable: false → this machine isn't running a LAN server, so it has no
//                       opinion at all. Callers must NOT treat that as "offline";
//                       a standalone shop would never be able to close a drawer.
//   seen: false       → server is running but that till has not checked in inside
//                       the presence window. That IS "offline".
//   pending           → writes still sitting in that till's offline queue, i.e.
//                       sales Main has not received yet.
function getTillPresence(code) {
  const blank = { observable: false, seen: false, online: false, pending: 0, lastSeen: null }
  if (!code || !_presenceProvider) return blank
  let list = []
  try { list = _presenceProvider() || [] } catch (_) { return blank }
  // A till that reconnects on a new IP briefly has two rows (the old one ages out
  // of the window). Always judge it by its most recent check-in.
  const row = list
    .filter(c => c.till === code)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))[0]
  if (!row) return { ...blank, observable: true }
  return {
    observable: true,
    seen: true,
    online: Date.now() - (row.lastSeen || 0) < PRESENCE_WINDOW_MS,
    pending: row.pending || 0,
    lastSeen: row.lastSeen || null,
  }
}

module.exports = {
  setRequestTill, clearRequestTill, getRequestTill, isRemoteRequest,
  setLocalTillCode, getLocalTillCode,
  setPresenceProvider, getTillPresence,
  PRESENCE_WINDOW_MS,
}
