import { useEffect, useRef, useState } from 'react'
import { isCloudConfigured } from '../services/supabaseClient'
import { pullCloudChangesToLocal } from '../services/syncService'
import { getDb, saveDb } from '../database/db'

/**
 * Custom hook for real-time data synchronization
 * Implements periodic polling to refresh data from Supabase
 * Non-breaking: errors are logged but don't interrupt main operations
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.pollInterval - Polling interval in milliseconds (default: 30000ms)
 * @param {boolean} options.enabled - Enable/disable real-time sync (default: true if cloud configured)
 * @param {Array} options.dependencies - Additional dependencies to trigger sync
 * @param {Function} options.onSyncComplete - Callback when sync completes successfully
 * @param {Function} options.onSyncError - Callback when sync encounters error
 * 
 * @returns {Object} Sync state and control functions
 */
export const useRealtimeSync = (options = {}) => {
  const {
    pollInterval = 30000,
    enabled = isCloudConfigured(),
    dependencies = [],
    onSyncComplete = null,
    onSyncError = null
  } = options

  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState(null)
  const [syncError, setSyncError] = useState(null)
  const pollTimerRef = useRef(null)
  const isMountedRef = useRef(true)

  // Perform sync operation
  const performSync = async (isManual = false) => {
    if (!enabled || isSyncing) return

    try {
      setIsSyncing(true)
      setSyncError(null)

      // Only sync if cloud is configured
      if (!isCloudConfigured()) {
        setIsSyncing(false)
        return
      }

      const shop = JSON.parse(localStorage.getItem('stocka_shop') || '{}')
      const user = JSON.parse(localStorage.getItem('stocka_user') || '{}')

      if (!shop?.id) {
        // No shop configured, skip sync
        setIsSyncing(false)
        return
      }

      // Pull cloud changes to local (one-way sync from cloud to local)
      await pullCloudChangesToLocal({
        shopId: shop.id,
        actor: user?.username || 'app'
      })

      if (isMountedRef.current) {
        setLastSyncTime(new Date().toISOString())
        setSyncError(null)
        
        if (onSyncComplete) {
          onSyncComplete()
        }
      }
    } catch (error) {
      if (isMountedRef.current) {
        setSyncError(error.message)
        console.warn('[Realtime Sync] Sync error:', error)
        
        if (onSyncError) {
          onSyncError(error)
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsSyncing(false)
      }
    }
  }

  // Setup polling effect
  useEffect(() => {
    isMountedRef.current = true

    if (!enabled) {
      return
    }

    // Perform initial sync on mount
    performSync(false)

    // Setup polling interval
    pollTimerRef.current = setInterval(() => {
      performSync(false)
    }, pollInterval)

    return () => {
      isMountedRef.current = false
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
      }
    }
  }, [enabled, pollInterval, ...dependencies])

  // Manual sync trigger
  const triggerSync = async () => {
    await performSync(true)
  }

  // Stop polling
  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  // Start polling (resume)
  const startPolling = () => {
    if (enabled && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => {
        performSync(false)
      }, pollInterval)
    }
  }

  return {
    isSyncing,
    lastSyncTime,
    syncError,
    triggerSync,
    stopPolling,
    startPolling,
    isEnabled: enabled
  }
}

/**
 * Hook to refresh page data after sync
 * Used by components that need to reload data when sync completes
 * 
 * @param {Function} loadDataFunction - Function to call to reload data
 * @param {boolean} autoSync - Whether to auto-sync on mount
 */
export const useSyncRefresh = (loadDataFunction, autoSync = true) => {
  const syncState = useRealtimeSync({
    enabled: autoSync && isCloudConfigured(),
    onSyncComplete: () => {
      // Give sync a moment to write to localStorage before reloading
      setTimeout(() => {
        if (loadDataFunction) {
          loadDataFunction().catch(err => 
            console.warn('[Sync Refresh] Error reloading data:', err)
          )
        }
      }, 500)
    }
  })

  return syncState
}
