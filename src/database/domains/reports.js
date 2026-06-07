const w = window.stocka.reports

export const getDashboardStats = () => w.getDashboard()
export const getSalesForDay = (date) => w.getSalesForDay(date)
export const getDailyRevenue = (date) => w.getDailyRevenue(date)
export const getDailyCOGS = (date) => w.getDailyCOGS(date)
export const getMonthlyData = (year, month) => w.getMonthlyData(year, month)
export const getRecentTransactions = (limit) => w.getRecentTransactions(limit)
export const getLowStockItems = () => w.getLowStockItems()
export const getStockValue = () => w.getStockValue()
export const getManagerAnalytics = () => w.getManagerAnalytics()
