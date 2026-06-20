import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import { useSaleStore } from '../store/useSaleStore'
import { getCurrentShift } from '../database/db'

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

  // Local machine: react to the IPC push that fires right after closeAllOpenShifts
  useEffect(() => {
    const shifts = window.stocka?.shifts
    if (!shifts?.onForceClose) return
    const off = shifts.onForceClose(triggerForceClose)
    return () => off?.()
  }, [triggerForceClose])

  return { shiftForceClosed }
}
