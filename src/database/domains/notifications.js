const w = window.stocka.notifications

export const createNotification = (n) => w.create(n)
export const getActiveNotifications = () => w.getActive()
export const getAllNotifications = () => w.getAll()
export const clearNotificationsForProduct = (productId) => w.clearForProduct(productId)
export const markNotificationAsRead = (id) => w.markRead(id)
