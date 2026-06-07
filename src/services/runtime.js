export const isElectronRuntime = () => {
  return typeof window !== 'undefined' && !!window.stocka
}

export const getRuntimeMode = () => {
  return isElectronRuntime() ? 'desktop' : 'web'
}

export const canUseNativePrinter = () => {
  return isElectronRuntime() && !!window.stocka?.printer
}

// Returns true when the app is running in cloud-connected mode.
// Cloud mode is active when a valid token payload is stored in safeStorage.
// Offline-only clients (license key activation) never have a token stored.
export const isCloudMode = async () => {
  if (!isElectronRuntime() || !window.stocka?.cloud) return false
  const token = await window.stocka.cloud.loadToken()
  return !!token?.access_token
}
