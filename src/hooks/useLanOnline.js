import { useState, useEffect } from 'react'

/**
 * Whether this machine can currently reach the authoritative database.
 *
 * Main and standalone tills are always `reachable` — they *are* the authority.
 * A satellite is only reachable when it is connected AND has nothing still sitting
 * in its offline queue: queued writes exist in neither the local DB nor Main's, so
 * any shop-wide total computed while the queue is draining is missing them.
 *
 * Use this to gate operations that need a complete picture of the whole shop
 * (End of Day). Do NOT use it to gate a cashier's own actions — selling and
 * closing your own drawer are local knowledge and must keep working offline.
 */
export function useLanOnline() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    const lan = window.stocka?.lan
    if (!lan) return

    const read = () => lan.getStatus().then(setStatus).catch(() => {})
    read()
    const off = lan.onStatusChange?.(setStatus)
    const poll = setInterval(read, 5000)

    return () => {
      try { off?.() } catch (_) {}
      clearInterval(poll)
    }
  }, [])

  const isSatellite = status?.mode === 'client'
  const online      = status?.clientOnline ?? false
  const queued      = status?.queueBusinessSize ?? status?.queueSize ?? 0

  return {
    status,
    isSatellite,
    online,
    queued,
    // Until the first status lands we assume reachable rather than flashing a
    // blocking warning on every page load.
    reachable: status === null ? true : (!isSatellite || (online && queued === 0)),
  }
}
