const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Fetch the stored token from safeStorage (Electron only)
async function loadToken() {
  if (!window.stocka?.cloud) return null
  return window.stocka.cloud.loadToken()
}

// Exchange a stale access token using the stored refresh token.
// Updates safeStorage with the new access token.
async function refreshAccessToken() {
  const stored = await loadToken()
  if (!stored?.refresh_token) return null

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: stored.refresh_token }),
    })

    if (!res.ok) {
      // Refresh token expired or revoked — force re-login
      await window.stocka.cloud.clearToken()
      return null
    }

    const { access_token } = await res.json()
    await window.stocka.cloud.saveToken({ ...stored, access_token })
    return access_token
  } catch {
    return null
  }
}

// Return a valid access token, refreshing automatically if expired.
export async function getValidToken() {
  const stored = await loadToken()
  if (!stored?.access_token) return null

  // Decode JWT payload (no verification — server verifies on every request)
  try {
    const payload = JSON.parse(atob(stored.access_token.split('.')[1]))
    const expiresSoon = payload.exp * 1000 < Date.now() + 60_000 // refresh if < 1 min left

    if (expiresSoon) {
      return await refreshAccessToken()
    }

    return stored.access_token
  } catch {
    return await refreshAccessToken()
  }
}

// Authenticated fetch wrapper — injects Bearer token automatically.
export async function apiFetch(path, options = {}) {
  const token = await getValidToken()

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers })

  if (res.status === 402) {
    // Subscription expired — surface to UI
    throw new Error('SUBSCRIPTION_EXPIRED')
  }

  return res
}

// Sign out from cloud mode: clear stored token.
// The app will reload and fall through to the Activation screen.
export async function cloudSignOut() {
  const stored = await loadToken()
  if (stored?.refresh_token) {
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: stored.refresh_token }),
      })
    } catch { /* best-effort */ }
  }
  await window.stocka.cloud.clearToken()
  window.location.reload()
}
