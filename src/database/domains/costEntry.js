const w = window.stocka.cost

export const getProductsMissingCost = (opts) => w.missing(opts)
export const getCostCoverageSummary = (opts) => w.coverage(opts)
export const setProductCost = (productId, cost, by) => w.set(productId, cost, by)
export const setProductCosts = (entries, by) => w.setMany(entries, by)
export const backfillSaleItemCosts = (opts) => w.backfill(opts)
