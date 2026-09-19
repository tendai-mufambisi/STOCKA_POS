import { create } from 'zustand'

// One place for "tell the person what just happened".
//
// Before this, every screen invented its own answer. Settings pushed a banner
// into the document at the top of the page — so pressing a button at the bottom
// of a scrolled Backups screen produced a confirmation the user could not see,
// and the act of showing it shoved the whole layout down a line. Ten stylesheets
// each redefined `.error-banner`. LanSettings had a message that never went away.
//
// A store rather than a context, for one specific reason: BackupsPanel sits three
// levels deep and currently has `flash` drilled into it as a prop. A context still
// requires every caller to be a hook consumer inside the tree. A module-level
// façade can be imported and called from anywhere — a component, an event handler,
// an async service — with no plumbing at all. Zustand is already the house pattern
// (see useAuthStore).

let seq = 0
const timers = new Map()

// A message repeated within this window refreshes the existing toast instead of
// stacking a duplicate. Guards against React StrictMode's double-invoke in dev and
// against an impatient double-click on a save button.
const DEDUPE_MS = 600

const DEFAULT_MS = { success: 4000, info: 4000, error: 7000 }

// More than a handful on screen at once is noise, not information.
const MAX_VISIBLE = 4

export const useToastStore = create((set, get) => ({
  toasts: [],

  push: (type, message, opts = {}) => {
    const { detail = null, action = null, duration } = opts
    const now = Date.now()

    const twin = get().toasts.find(
      (t) => t.type === type && t.message === message && now - t.at < DEDUPE_MS
    )
    if (twin) {
      get()._arm(twin.id, twin.duration)
      return twin.id
    }

    const id = ++seq
    const ms = duration ?? DEFAULT_MS[type] ?? DEFAULT_MS.info

    set((s) => ({
      toasts: [...s.toasts, { id, type, message, detail, action, duration: ms, at: now }]
        .slice(-MAX_VISIBLE),
    }))
    get()._arm(id, ms)
    return id
  },

  // duration <= 0 keeps a toast up until it is dismissed by hand.
  _arm: (id, ms) => {
    clearTimeout(timers.get(id))
    if (ms > 0) timers.set(id, setTimeout(() => get().dismiss(id), ms))
  },

  dismiss: (id) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  clear: () => {
    timers.forEach(clearTimeout)
    timers.clear()
    set({ toasts: [] })
  },
}))

/**
 * Call from anywhere: `toast.success('Backup created and checked.')`
 *
 * opts: { detail, action: { label, onClick }, duration }
 */
export const toast = {
  success: (message, opts) => useToastStore.getState().push('success', message, opts),
  error:   (message, opts) => useToastStore.getState().push('error',   message, opts),
  info:    (message, opts) => useToastStore.getState().push('info',    message, opts),
  dismiss: (id) => useToastStore.getState().dismiss(id),
  clear:   () => useToastStore.getState().clear(),
}
