// How a closed shift's reconciliation status is described to a human.
//
// Every badge in the app used to fall through to "Balanced" for anything that
// wasn't 'short' or 'over'. That was harmless while those were the only other
// value — but a drawer that was never counted (auto-closed overnight) or one
// closed while its till was unreachable now has its own status, and showing
// either of those as a green tick is exactly the lie the statuses exist to stop.

// Closed, but the figures were never confirmed against a physical count.
export const UNVERIFIED_STATUSES = new Set(['unreconciled', 'unverified'])

export const isUnverified = (status) => UNVERIFIED_STATUSES.has(status)

// Short label for badges. `variance` is only used by the short/over cases.
export function shiftStatusLabel(status, variance = 0) {
  switch (status) {
    case 'short':        return `Short — $${Math.abs(variance || 0).toFixed(2)}`
    case 'over':         return `Over — $${Math.abs(variance || 0).toFixed(2)}`
    case 'unverified':   return 'Unverified'
    case 'unreconciled': return 'Not counted'
    case 'balanced':     return 'Balanced'
    default:             return status ? 'Closed' : ''
  }
}

// One-word badge text where the amount is shown separately.
export function shiftStatusShort(status) {
  switch (status) {
    case 'short':        return 'Short'
    case 'over':         return 'Over'
    case 'unverified':   return 'Unverified'
    case 'unreconciled': return 'Not counted'
    default:             return 'Balanced'
  }
}

// Why a status is flagged, for tooltips.
export function shiftStatusHint(status) {
  switch (status) {
    case 'unverified':
      return 'Closed while the cashier\'s till was not connected — these figures may be missing sales still on that machine.'
    case 'unreconciled':
      return 'Auto-closed after being left open overnight. The drawer was never counted, so these are expected amounts, not a verified count.'
    default:
      return ''
  }
}
