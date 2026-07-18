// Event-time context for LAN replays.
//
// On the Main computer a satellite's write may be replayed long after it actually
// happened: while Main was offline the satellite parked the write in its offline
// queue and only sent it once Main came back. If the domain function stamps the
// time itself (new Date() / SQLite datetime('now')) it records the REPLAY time,
// not the moment the cashier acted — so a 7am sale shows up at 4pm.
//
// To fix that, the LAN server sets the real action time here (from the queued
// item's timestamp, sent as `occurred_at`) right before it runs a proxied write,
// and clears it straight after. Domain functions read it via the eventNow* helpers
// below instead of reading the wall clock directly.
//
// Nothing is set for:
//   • Main's own writes (renderer → IPC → domain function, no LAN hop), and
//   • online satellite writes (Main is reachable, its clock is authoritative).
// In both cases the helpers fall back to the current time, which is correct —
// there is no replay delay to correct for. We deliberately do NOT trust a
// satellite's clock for online writes; only unavoidable offline replays use it.

let _eventTimeMs = null // real action time (ms since epoch) during a replay, else null

// iso may be an ISO-8601 string or null. Ignored if unparseable so a malformed
// value can never poison a write — we just fall back to the current clock.
function setEventTime(iso) {
  if (!iso) { _eventTimeMs = null; return }
  const t = new Date(iso).getTime()
  _eventTimeMs = Number.isFinite(t) ? t : null
}

function clearEventTime() { _eventTimeMs = null }

// ISO-8601 ('…T…Z'). Use for columns currently written with new Date().toISOString()
// — shifts.started_at/closed_at, sales.held_at/voided_at/released_from_hold_at,
// products.last_sold_date.
function eventNowIso() {
  return new Date(_eventTimeMs ?? Date.now()).toISOString()
}

// SQLite datetime('now') format ('YYYY-MM-DD HH:MM:SS', UTC). Use for columns whose
// schema default is datetime('now') — created_at on sales, stock_movements, the
// audit log, notifications. Matching the format keeps ORDER BY / string comparisons
// on those columns consistent with the historical rows.
function eventNowSql() {
  return new Date(_eventTimeMs ?? Date.now()).toISOString().replace('T', ' ').slice(0, 19)
}

// Milliseconds at the real action time, for arithmetic (e.g. the void 24h window).
function eventNowMs() {
  return _eventTimeMs ?? Date.now()
}

module.exports = { setEventTime, clearEventTime, eventNowIso, eventNowSql, eventNowMs }
