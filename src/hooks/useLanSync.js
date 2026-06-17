import { useEffect } from 'react'

/**
 * Calls `onSync` whenever the LAN sync layer reports fresh data:
 *  - on the satellite: after every delta sync (lan:synced)
 *  - on the main computer: after a satellite writes via /lan/invoke (lan:data-changed)
 *
 * Use this in any page that displays data which other LAN machines can mutate.
 * The callback should re-fetch whatever data the page displays.
 */
export function useLanSync(onSync) {
  useEffect(() => {
    if (!window.stocka?.lan) return
    const unsubs = []
    if (window.stocka.lan.onSynced)      unsubs.push(window.stocka.lan.onSynced(onSync))
    if (window.stocka.lan.onDataChanged) unsubs.push(window.stocka.lan.onDataChanged(onSync))
    return () => unsubs.forEach(u => u?.())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
