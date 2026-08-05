const { parseDay, addDays, today } = require('./time')

// A Period is an inclusive range of LOCAL calendar days plus the granularity it
// was built at. Every metric is computed against one, and comparison metrics
// simply re-run the same metric against period.previous() or .priorYear().
//
// That is the whole mechanism behind every "↑ 14% vs last month" figure in the
// reports: no metric is ever comparison-aware, so growth, trend and forecast
// cost nothing to add and cannot drift from the headline number they compare.
//
// Both ends are inclusive: `start` and `end` are days the period contains.
// Storing an exclusive end would mean every call site had to remember which
// convention applied, and one of them eventually would not.

const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year', 'custom']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

class Period {
  constructor(start, end, granularity = 'custom', anchor = null) {
    if (!isDayStr(start) || !isDayStr(end)) {
      throw new Error(`Period expects 'YYYY-MM-DD' days, got '${start}'..'${end}'`)
    }
    if (end < start) {
      throw new Error(`Period end '${end}' is before start '${start}'`)
    }
    if (!GRANULARITIES.includes(granularity)) {
      throw new Error(`Unknown granularity '${granularity}'`)
    }
    this.start = start
    this.end = end
    this.granularity = granularity
    // What the period was built from (e.g. {year, month}), so previous() can be
    // calendar-aware rather than merely subtracting a day count.
    this.anchor = anchor
    Object.freeze(this)
  }

  // ── Constructors ───────────────────────────────────────────────────────────

  static day(d = today()) {
    return new Period(d, d, 'day')
  }

  static month(year, month) {
    const start = `${year}-${pad(month)}-01`
    const end = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`
    return new Period(start, end, 'month', { year, month })
  }

  static quarter(year, quarter) {
    const firstMonth = (quarter - 1) * 3 + 1
    const lastMonth = firstMonth + 2
    return new Period(
      `${year}-${pad(firstMonth)}-01`,
      `${year}-${pad(lastMonth)}-${pad(daysInMonth(year, lastMonth))}`,
      'quarter',
      { year, quarter }
    )
  }

  static year(year) {
    return new Period(`${year}-01-01`, `${year}-12-31`, 'year', { year })
  }

  /** Week containing `d`, Monday-based (the retail convention here). */
  static week(d = today()) {
    const date = parseDay(d)
    const dow = (date.getDay() + 6) % 7 // Mon = 0
    const start = addDays(d, -dow)
    return new Period(start, addDays(start, 6), 'week')
  }

  static range(start, end) {
    return new Period(start, end, 'custom')
  }

  /** The month `d` falls in. */
  static monthOf(d = today()) {
    const date = parseDay(d)
    return Period.month(date.getFullYear(), date.getMonth() + 1)
  }

  // ── Comparison periods ─────────────────────────────────────────────────────

  /**
   * The immediately preceding period.
   *
   * Calendar-aware for month/quarter/year — June has 30 days and July 31, so
   * "last month" must mean the whole of June, not "the 31 days before July".
   * Anything else steps back by its own exact length.
   */
  previous() {
    const a = this.anchor
    if (this.granularity === 'month' && a) {
      return a.month === 1 ? Period.month(a.year - 1, 12) : Period.month(a.year, a.month - 1)
    }
    if (this.granularity === 'quarter' && a) {
      return a.quarter === 1 ? Period.quarter(a.year - 1, 4) : Period.quarter(a.year, a.quarter - 1)
    }
    if (this.granularity === 'year' && a) return Period.year(a.year - 1)

    const len = this.lengthDays()
    return new Period(addDays(this.start, -len), addDays(this.end, -len), this.granularity)
  }

  /**
   * The same period one year earlier.
   *
   * Calendar-aware so that Feb 2028 (29 days) compares against Feb 2027
   * (28 days) rather than against a 29-day window ending on the wrong day.
   */
  priorYear() {
    const a = this.anchor
    if (this.granularity === 'month' && a) return Period.month(a.year - 1, a.month)
    if (this.granularity === 'quarter' && a) return Period.quarter(a.year - 1, a.quarter)
    if (this.granularity === 'year' && a) return Period.year(a.year - 1)

    return new Period(shiftYear(this.start, -1), shiftYear(this.end, -1), this.granularity)
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get key() {
    return `${this.start}..${this.end}#${this.granularity}`
  }

  lengthDays() {
    return Math.round((parseDay(this.end) - parseDay(this.start)) / 86400000) + 1
  }

  /** Every local day in the period, ascending. */
  days() {
    const out = []
    for (let d = this.start; d <= this.end; d = addDays(d, 1)) out.push(d)
    return out
  }

  contains(dayStr) {
    return dayStr >= this.start && dayStr <= this.end
  }

  /** True if the period extends into the future — its figures are provisional. */
  isPartial() {
    return this.end >= today()
  }

  label() {
    const a = this.anchor
    if (this.granularity === 'month' && a) return `${MONTH_NAMES[a.month - 1]} ${a.year}`
    if (this.granularity === 'quarter' && a) return `Q${a.quarter} ${a.year}`
    if (this.granularity === 'year' && a) return String(a.year)
    if (this.granularity === 'day') return formatDay(this.start)
    return `${formatDay(this.start)} – ${formatDay(this.end)}`
  }

  toJSON() {
    return {
      start: this.start,
      end: this.end,
      granularity: this.granularity,
      label: this.label(),
      days: this.lengthDays(),
      partial: this.isPartial(),
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isDayStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function formatDay(dayStr) {
  const d = parseDay(dayStr)
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
}

// Clamp rather than roll over: 29 Feb one year back is 28 Feb, not 1 March.
function shiftYear(dayStr, delta) {
  const [y, m, d] = dayStr.split('-').map(Number)
  const targetYear = y + delta
  const maxDay = daysInMonth(targetYear, m)
  return `${targetYear}-${pad(m)}-${pad(Math.min(d, maxDay))}`
}

module.exports = { Period, GRANULARITIES }
