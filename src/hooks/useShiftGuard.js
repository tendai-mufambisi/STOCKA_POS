import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import { useSaleStore } from '../store/useSaleStore'
import { useShiftStore } from '../store/useShiftStore'
import { getCurrentShift, reconcileOrphanedSales } from '../database/db'

// Polls for remote shift closure and raises a flag so Dashboard can show the
// force-close modal.  Only active for Cashier role users with an active shift.
export function useShiftGuard() {
  const { user } = useAuthStore()
  const { saleInProgress, setPendingForceClose, pendingForceClose } = useSaleStore()
  const [shiftForceClosed, setShiftForceClosed] = useState(false)

  // Refs so callbacks always read the latest values without stale closures
  const saleRef = useRef(saleInProgress)
  useEffect(() => { saleRef.current = saleInProgress }, [saleInProgress])

  const pendingRef = useRef(false)
  const shiftIdRef = useRef(user?.current_shift_id ?? null)
  useEffect(() => {
    if (user?.current_shift_id) shiftIdRef.current = user.current_shift_id
  }, [user?.current_shift_id])

  const triggerForceClose = useCallback(() => {
    pendingRef.current = true
    setPendingForceClose(true)
    if (!saleRef.current) {
      setShiftForceClosed(true)
    }
  }, [setPendingForceClose])

  const checkShift = useCallback(async () => {
    if (!user || user.role !== 'Cashier' || !shiftIdRef.current) return
    try {
      const active = await getCurrentShift(user.username)
      if (!active) {
        // Shift was closed remotely — trigger if not already triggered
        if (!pendingRef.current) triggerForceClose()
      } else {
        shiftIdRef.current = active.id
        // Shift was reopened — clear everything
        if (pendingRef.current) {
          pendingRef.current = false
          setPendingForceClose(false)
          setShiftForceClosed(false)
        }
      }
    } catch (_) {}
  }, [user, triggerForceClose, setPendingForceClose])

  // When a sale finishes and there is a pending force-close, show the modal
  useEffect(() => {
    if (!saleInProgress && pendingRef.current && !shiftForceClosed) {
      setShiftForceClosed(true)
    }
  }, [saleInProgress, shiftForceClosed])

  // Poll every 8 s as the safety net
  useEffect(() => {
    if (!user || user.role !== 'Cashier') return
    const timer = setInterval(checkShift, 8000)
    return () => clearInterval(timer)
  }, [user, checkShift])

  // Satellites: react immediately when the local DB syncs from server
  useEffect(() => {
    const lan = window.stocka?.lan
    if (!lan?.onSynced) return
    const off = lan.onSynced(checkShift)
    return () => off?.()
  }, [checkShift])

  // Local machine: react to the IPC push that fires right after closeAllOpenShifts.
  // Cashiers only — the admin/manager who ran Close Day (whose own shift may be in
  // the batch) must not be shown the force-close logout modal for their own action.
  useEffect(() => {
    if (!user || user.role !== 'Cashier') return
    const shifts = window.stocka?.shifts
    if (!shifts?.onForceClose) return
    const off = shifts.onForceClose(triggerForceClose)
    return () => off?.()
  }, [user, triggerForceClose])

  // ── Provisional-shift auto-heal (all roles) ──────────────────────────────
  // If startShift got queued (Main unreachable at that instant), Dashboard stores a
  // __provisional shift with no id so selling isn't blocked — but any sale made
  // before the real shift confirms is written with shift_id: null. The moment the
  // real shift lands, reattach those orphaned sales so Shift Management / End of
  // Day agree with Transactions without any admin having to notice or intervene.
  const { currentShift, setCurrentShift } = useShiftStore()
  const healingRef = useRef(false)

  const checkProvisionalShift = useCallback(async () => {
    if (!user?.username || !currentShift?.__provisional || healingRef.current) return
    healingRef.current = true
    try {
      const real = await getCurrentShift(user.username)
      if (real?.id) {
        setCurrentShift(real)
        try { await reconcileOrphanedSales(real.id) } catch (_) { /* next tick will retry */ }
      }
    } catch (_) {
      // still unreachable — stay provisional, selling keeps working, try again next tick
    } finally {
      healingRef.current = false
    }
  }, [user?.username, currentShift?.__provisional, setCurrentShift])

  useEffect(() => {
    if (!currentShift?.__provisional) return
    checkProvisionalShift()
    const timer = setInterval(checkProvisionalShift, 8000)
    return () => clearInterval(timer)
  }, [currentShift?.__provisional, checkProvisionalShift])

  useEffect(() => {
    const lan = window.stocka?.lan
    if (!lan?.onSynced || !currentShift?.__provisional) return
    const off = lan.onSynced(checkProvisionalShift)
    return () => off?.()
  }, [checkProvisionalShift, currentShift?.__provisional])

  return { shiftForceClosed }
}
