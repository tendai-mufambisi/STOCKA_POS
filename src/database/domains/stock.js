const w = window.stocka.stock

export const addStockReceiving = (r) => w.addReceiving(r)
export const getStockReceivings = () => w.getAll()
export const getStockReceivingById = (id) => w.getById(id)
export const getAllPurchaseHistory = () => w.getAllPurchases()
export const recordDirectPurchase = (p) => w.recordDirect(p)
export const getDeadStockProducts = (days) => w.getDeadStock(days)
export const getRestockNeeded = () => w.getRestock()
export const getProductSalesVelocity = (days) => w.getVelocity(days)
export const getExpiringProducts = (days) => w.getExpiring(days)
export const getExpiredProducts = () => w.getExpired()
export const getExpiryReport = () => w.getExpiryReport()
