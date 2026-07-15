// Single source of truth for "which sales belong to today".
//
// DB timestamps arrive in two shapes:
//   - SQLite datetime('now')  → 'YYYY-MM-DD HH:MM:SS'  (UTC, no zone marker)
//   - JS   toISOString()      → 'YYYY-MM-DDTHH:MM:SS.mmmZ'
// JS Date parses the first form as LOCAL time, silently shifting every timestamp
// by the timezone offset. Every page must parse through here so all machines
// bucket a sale into the same local calendar day.

export function parseDbDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const s = String(value)
  // Pure date (e.g. expenses.date) — treat as a local calendar day
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  // SQLite UTC datetime without zone — force UTC before parsing
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z')
  }
  return new Date(s)
}

export function localDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isToday(value) {
  const d = parseDbDate(value)
  return !!d && !isNaN(d) && localDateStr(d) === localDateStr()
}

// Display helpers — ALWAYS use these to show a DB timestamp to the user.
// `new Date('YYYY-MM-DD HH:MM:SS')` reads the stored UTC digits as local time,
// which shows Zimbabwe sales 2 hours in the past (e.g. a 19:00 sale as 17:00).
export function formatDbTime(value, opts = { hour: '2-digit', minute: '2-digit' }) {
  const d = parseDbDate(value)
  return d && !isNaN(d) ? d.toLocaleTimeString('en-ZA', opts) : '—'
}

export function formatDbDate(value, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  const d = parseDbDate(value)
  return d && !isNaN(d) ? d.toLocaleDateString('en-ZA', opts) : '—'
}

export function formatDbDateTime(value, opts = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) {
  const d = parseDbDate(value)
  return d && !isNaN(d) ? d.toLocaleString('en-ZA', opts) : '—'
}

export function todayCompletedSales(sales) {
  return (sales || []).filter(s => s.status === 'completed' && isToday(s.created_at))
}

export function sumTodayCompleted(sales) {
  return todayCompletedSales(sales).reduce((sum, s) => sum + (s.total || 0), 0)
}
