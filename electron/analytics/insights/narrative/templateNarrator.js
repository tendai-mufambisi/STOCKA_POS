// The executive summary, written from the figures.
//
// Deterministic prose assembled from metrics and insights — no network, works
// offline, and the same data always produces the same words, so it can be
// snapshot-tested like any other output.
//
// This is also the contract an AI narrator will later have to satisfy. When
// aiNarrator ships it receives exactly this input — the resolved bundle and the
// insight set — and is forbidden from producing figures of its own; every
// numeral in its prose must match a value it was given. It writes the sentences
// about numbers it did not compute. Until then, this does the same job with
// less risk.

function narrate({ bundle, insights, health, ctx }) {
  const paragraphs = []
  const period = ctx.period.label()
  const m = (id) => bundle.value(id)
  const money = (v) =>
    v == null ? null : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ── Opening: what happened ─────────────────────────────────────────────────
  const net = m('sales.net')
  const txns = m('sales.transactionCount')
  const growth = bundle.delta('sales.net')

  if (net == null || !txns) {
    paragraphs.push(`No sales were recorded for ${period}.`)
  } else {
    let s = `In ${period} the business took ${money(net)} across ${txns.toLocaleString('en-US')} sale${txns === 1 ? '' : 's'}`
    const basket = m('sales.averageBasket')
    if (basket != null) s += `, an average of ${money(basket)} per sale`
    s += '.'
    if (growth.comparable && growth.percentChange != null && Math.abs(growth.percentChange) >= 0.01) {
      const dir = growth.percentChange > 0 ? 'up' : 'down'
      s += ` That is ${dir} ${Math.abs(growth.percentChange * 100).toFixed(1)}% on ${growth.comparisonPeriod.label}.`
    } else if (!growth.comparable) {
      // Stated plainly rather than omitted — an owner looking for a comparison
      // should be told why there isn't one.
      s += ' There is no earlier period to compare against yet.'
    }
    paragraphs.push(s)
  }

  // ── Profit, with the caveat attached where it belongs ──────────────────────
  const gross = m('profit.gross')
  const grossMargin = m('profit.grossMargin')
  const coverage = m('cogs.coverage')

  if (gross != null && grossMargin != null) {
    let s = `Gross profit was ${money(gross)}, a margin of ${(grossMargin * 100).toFixed(1)}%.`
    const expenses = m('expenses.total')
    const netProfit = m('profit.net')
    if (expenses != null && netProfit != null) {
      s += ` After ${money(expenses)} of operating expenses, that leaves ${money(netProfit)}.`
    }
    // The caveat goes in the same paragraph as the figure it qualifies. A
    // footnote at the end of a report is a footnote nobody reads.
    if (coverage != null && coverage < 0.9) {
      s +=
        ` Treat these figures with caution: only ${(coverage * 100).toFixed(0)}% of what was sold has a cost price` +
        ` recorded, so the true margin is lower than this.`
    }
    paragraphs.push(s)
  }

  // ── Where the money is ─────────────────────────────────────────────────────
  const stock = m('inventory.valueAtCost')
  const dead = m('inventory.deadStockValue')
  if (stock != null) {
    let s = `You are holding ${money(stock)} of stock at cost`
    if (dead != null && stock > 0 && dead / stock > 0.1) {
      s += `, of which ${money(dead)} has not sold recently`
    }
    s += '.'
    const outOfStock = m('inventory.outOfStockCount')
    if (outOfStock) s += ` ${outOfStock} product${outOfStock === 1 ? ' is' : 's are'} out of stock.`
    paragraphs.push(s)
  }

  // ── Health ────────────────────────────────────────────────────────────────
  if (health?.computable && health.score != null) {
    let s = `Overall business health scores ${Math.round(health.score * 100)} out of 100 — ${health.grade.toLowerCase()}.`
    const weak = health.pillars
      .filter((p) => p.score != null && p.score < 0.5)
      .sort((a, b) => a.score - b.score)
    if (weak.length) s += ` The weakest area is ${weak[0].label.toLowerCase()}.`
    if (health.coverage < 0.8) {
      s += ` This score covers ${Math.round(health.coverage * 100)}% of what it normally measures; the rest could not be assessed from this period's data.`
    }
    paragraphs.push(s)
  }

  // ── What to do ────────────────────────────────────────────────────────────
  const actionable = (insights || []).filter(
    (i) => i.recommendedAction?.text && ['critical', 'warning', 'opportunity'].includes(i.severity)
  )
  if (actionable.length) {
    const top = actionable.slice(0, 3)
    paragraphs.push(
      top.length === 1
        ? `The one thing worth acting on: ${lowerFirst(top[0].recommendedAction.text)}.`
        : `The most useful things you could do next: ${top
            .map((t) => lowerFirst(t.recommendedAction.text))
            .join('; ')}.`
    )
  } else if (net != null) {
    paragraphs.push('Nothing in this period needs immediate attention.')
  }

  return {
    executiveSummary: paragraphs.join(' '),
    paragraphs,
    source: 'template',
    model: null,
  }
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

module.exports = { narrate }
