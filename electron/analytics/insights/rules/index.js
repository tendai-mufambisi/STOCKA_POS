const { defineRule } = require('../index')

// The initial rule set.
//
// Each rule answers one of the five questions a report exists to answer:
// how much did I make, where is my money, where am I losing it, what is making
// it, and what should I do next. A rule that does not help answer one of those
// does not belong.
//
// Thresholds live at the top as named constants rather than buried in the
// logic, so they can be reviewed and tuned by someone who is not reading code.

const T = {
  marginDropPoints: 0.02, // gross margin fall that counts as compression
  growthNotable: 0.05, // ±5% before growth is worth remarking on
  expenseRatioHigh: 0.35, // expenses above this share of sales
  deadStockShare: 0.25, // dead stock above this share of inventory
  varianceMaterial: 5, // cash variance in currency units
  voidRateHigh: 0.05, // voided value above this share of sales
  concentrationHigh: 0.4, // one product above this share of revenue
  lowCoverage: 0.9, // cost coverage below which margin is unreliable
  stockoutDaysUrgent: 7,
}

// ── How much did I make? ─────────────────────────────────────────────────────

defineRule({
  id: 'growth.revenue',
  appliesTo: { granularities: ['week', 'month', 'quarter', 'year'], requires: ['sales.net'] },
  evaluate(m, ctx) {
    const d = m.delta('sales.net')
    if (!d.comparable || d.percentChange == null) return null
    if (Math.abs(d.percentChange) < T.growthNotable) return null
    const up = d.percentChange > 0
    return {
      severity: up ? 'opportunity' : 'warning',
      title: `Sales ${up ? 'rose' : 'fell'} ${Math.abs(d.percentChange * 100).toFixed(1)}% versus ${d.comparisonPeriod.label}`,
      body: up
        ? 'Worth knowing what drove this so it can be repeated.'
        : 'Worth understanding before it becomes a trend.',
      evidence: [
        { label: ctx.period.label(), value: d.current, unit: 'currency' },
        { label: d.comparisonPeriod.label, value: d.previous, unit: 'currency' },
      ],
      tags: ['growth'],
    }
  },
})

defineRule({
  id: 'margin.compression',
  minConfidence: 'medium', // never claim a margin trend over unreliable cost data
  appliesTo: {
    granularities: ['week', 'month', 'quarter', 'year'],
    requires: ['profit.grossMargin', 'cogs.total'],
  },
  evaluate(m, ctx) {
    const d = m.delta('profit.grossMargin')
    if (!d.comparable || d.absoluteChange == null) return null
    if (d.absoluteChange > -T.marginDropPoints) return null
    return {
      severity: 'warning',
      title: `Gross margin fell ${Math.abs(d.absoluteChange * 100).toFixed(1)} points versus ${d.comparisonPeriod.label}`,
      body: 'Either buying prices rose or selling prices slipped. Both are fixable, but only once you know which.',
      evidence: [
        { label: 'Margin now', value: d.current, unit: 'ratio' },
        { label: 'Margin before', value: d.previous, unit: 'ratio' },
        { label: 'Cost of goods', value: m.value('cogs.total'), unit: 'currency' },
      ],
      recommendedAction: { text: 'Compare supplier costs on your highest-volume products' },
      confidence: m.confidenceOf('profit.grossMargin'),
      tags: ['margin'],
    }
  },
})

// ── Where am I losing money? ─────────────────────────────────────────────────

defineRule({
  id: 'expenses.ratioHigh',
  appliesTo: { requires: ['profit.expenseRatio', 'expenses.total', 'sales.net'] },
  evaluate(m) {
    const ratio = m.value('profit.expenseRatio')
    if (ratio == null || ratio < T.expenseRatioHigh) return null
    const top = m.value('expenses.largestCategory')
    return {
      severity: 'warning',
      title: `Expenses are ${(ratio * 100).toFixed(0)}% of sales`,
      body: top
        ? `${top.label} is the largest single category at ${(top.share * 100).toFixed(0)}% of expenses.`
        : 'Operating costs are taking a large share of turnover.',
      evidence: [
        { label: 'Expenses', value: m.value('expenses.total'), unit: 'currency' },
        { label: 'Net sales', value: m.value('sales.net'), unit: 'currency' },
      ],
      recommendedAction: { text: 'Review the largest expense categories for anything recurring that could be cut' },
      tags: ['expenses'],
    }
  },
})

defineRule({
  id: 'cash.variance',
  appliesTo: { requires: ['cash.variance'] },
  evaluate(m) {
    const v = m.value('cash.variance')
    if (v == null || Math.abs(v) < T.varianceMaterial) return null
    const short = v < 0
    return {
      severity: short ? 'critical' : 'warning',
      title: `Cash drawers were ${short ? 'short' : 'over'} by ${fmtMoney(Math.abs(v))} this period`,
      body: short
        ? 'A persistent shortfall is either a counting habit or a leak. Both are worth finding early.'
        : 'Consistent overages usually mean change is being given incorrectly.',
      evidence: [
        { label: 'Total variance', value: v, unit: 'currency' },
        { label: 'Counted', value: m.value('cash.countedAtClose'), unit: 'currency' },
        { label: 'Expected', value: m.value('cash.expectedAtClose'), unit: 'currency' },
      ],
      recommendedAction: { text: 'Check which shifts account for the variance in Cashier Sessions' },
      tags: ['cash'],
    }
  },
})

defineRule({
  id: 'cash.unverified',
  appliesTo: { requires: ['cash.unverifiedShiftCount'] },
  evaluate(m) {
    const n = m.value('cash.unverifiedShiftCount')
    if (!n) return null
    return {
      severity: 'warning',
      title: `${n} drawer${n === 1 ? '' : 's'} closed without a verified count`,
      // These read as zero variance only because nothing was compared. Left
      // unsaid, a clean-looking reconciliation page hides them entirely.
      body: 'Their variance shows as zero because there was nothing to compare against, not because they balanced.',
      evidence: [{ label: 'Unverified drawers', value: n, unit: 'count' }],
      recommendedAction: { text: 'Make sure drawers are counted before the till is shut down' },
      tags: ['cash', 'control'],
    }
  },
})

defineRule({
  id: 'voids.rate',
  appliesTo: { requires: ['sales.voidedValue', 'sales.net'] },
  evaluate(m) {
    const voided = m.value('sales.voidedValue')
    const net = m.value('sales.net')
    if (!voided || !net) return null
    const rate = voided / net
    if (rate < T.voidRateHigh) return null
    return {
      severity: 'warning',
      title: `Voided sales are ${(rate * 100).toFixed(1)}% of turnover`,
      body: 'A high void rate is sometimes training, sometimes something else. Either way it is worth a look at who is voiding.',
      evidence: [
        { label: 'Voided', value: voided, unit: 'currency' },
        { label: 'Voids', value: m.value('sales.voidedCount'), unit: 'count' },
      ],
      recommendedAction: { text: 'Review voids by cashier in Loss Prevention' },
      tags: ['control'],
    }
  },
})

// ── Where is my money? ───────────────────────────────────────────────────────

defineRule({
  id: 'inventory.deadStock',
  appliesTo: { requires: ['inventory.deadStockValue', 'inventory.valueAtCost'] },
  evaluate(m) {
    const dead = m.value('inventory.deadStockValue')
    const total = m.value('inventory.valueAtCost')
    if (!dead || !total) return null
    const share = dead / total
    if (share < T.deadStockShare) return null
    return {
      severity: 'opportunity',
      title: `${fmtMoney(dead)} is tied up in stock that is not selling`,
      body: `That is ${(share * 100).toFixed(0)}% of your inventory sitting still. Cash on the shelf earns nothing.`,
      evidence: [
        { label: 'Dead stock', value: dead, unit: 'currency' },
        { label: 'Total inventory', value: total, unit: 'currency' },
      ],
      recommendedAction: { text: 'Discount or return the slowest lines to release the cash' },
      tags: ['inventory'],
    }
  },
})

defineRule({
  id: 'inventory.reconciliation',
  appliesTo: { requires: ['inventory.reconciles'] },
  evaluate(m) {
    const r = m.value('inventory.reconciles')
    if (!r || r.reconciles) return null
    return {
      severity: 'critical',
      title: `${fmtMoney(Math.abs(r.residual))} of stock movement is unexplained`,
      body:
        'Opening stock plus purchases, less what was sold and written off, does not arrive at closing stock. ' +
        'That gap is either a counting error or stock leaving without being recorded.',
      evidence: [
        { label: 'Unexplained', value: r.residual, unit: 'currency' },
        { label: 'Tolerance', value: r.tolerance, unit: 'currency' },
      ],
      recommendedAction: { text: 'Run a stock count on your highest-value lines' },
      tags: ['inventory', 'control'],
    }
  },
})

defineRule({
  id: 'inventory.outOfStock',
  appliesTo: { requires: ['inventory.outOfStockCount'] },
  evaluate(m) {
    const n = m.value('inventory.outOfStockCount')
    if (!n) return null
    return {
      severity: n > 10 ? 'warning' : 'info',
      title: `${n} product${n === 1 ? ' is' : 's are'} out of stock`,
      body: 'Every one is a sale you cannot make.',
      evidence: [{ label: 'Out of stock', value: n, unit: 'count' }],
      recommendedAction: { text: 'Check Restock Needed for what to order first' },
      tags: ['inventory'],
    }
  },
})

// ── What is making me money? ─────────────────────────────────────────────────

defineRule({
  id: 'products.concentration',
  appliesTo: { requires: ['cogs.byProduct', 'sales.net'] },
  evaluate(m) {
    const rows = m.value('cogs.byProduct')
    const net = m.value('sales.net')
    if (!rows?.length || !net) return null
    const top = rows[0]
    const share = top.revenue / net
    if (share < T.concentrationHigh) return null
    return {
      severity: 'info',
      title: `${top.label} alone is ${(share * 100).toFixed(0)}% of your sales`,
      body: 'A single product carrying this much turnover is a risk if its supply or price changes.',
      evidence: [{ label: top.label, value: top.revenue, unit: 'currency' }],
      tags: ['products'],
    }
  },
})

defineRule({
  id: 'products.highMargin',
  minConfidence: 'medium',
  appliesTo: { requires: ['cogs.byProduct'] },
  evaluate(m) {
    const rows = (m.value('cogs.byProduct') || []).filter((r) => r.costKnown && r.margin != null && r.revenue > 0)
    if (rows.length < 3) return null
    const best = [...rows].sort((a, b) => b.profit - a.profit).slice(0, 3)
    if (best[0].profit <= 0) return null
    return {
      severity: 'opportunity',
      title: `${best[0].label} is your most profitable line`,
      body: `Your top three by profit are ${best.map((b) => b.label).join(', ')}. Selling more of these moves the bottom line fastest.`,
      evidence: best.map((b) => ({ label: b.label, value: b.profit, unit: 'currency' })),
      recommendedAction: { text: 'Give these products better shelf position and keep them in stock' },
      tags: ['products', 'margin'],
    }
  },
})

// ── Can I trust this report? ─────────────────────────────────────────────────

defineRule({
  id: 'quality.costCoverage',
  appliesTo: { requires: ['cogs.coverage'] },
  evaluate(m) {
    const cov = m.value('cogs.coverage')
    if (cov == null || cov >= T.lowCoverage) return null
    return {
      severity: 'critical',
      title: `Only ${(cov * 100).toFixed(0)}% of your sales have a cost price recorded`,
      // Surfaced as a first-class insight, not just a footnote: at low coverage
      // the profit figures on this report are largely fiction, and that is the
      // single most useful thing it can tell the owner.
      body:
        'Products with no cost recorded are counted as pure profit, so the margin and profit figures ' +
        'in this report are overstated. This is the most valuable thing you can fix.',
      evidence: [
        { label: 'Cost coverage', value: cov, unit: 'ratio' },
        { label: 'Revenue with no cost', value: m.value('cogs.zeroCostExposure'), unit: 'currency' },
      ],
      recommendedAction: { text: 'Enter cost prices under Inventory → Cost Prices' },
      tags: ['quality'],
    }
  },
})

function fmtMoney(v) {
  return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

module.exports = { THRESHOLDS: T }
