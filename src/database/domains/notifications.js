const w = window.stocka.notifications

export const createNotification            = (n)  => w.create(n)
export const getActiveNotifications        = ()   => w.getActive()
export const getAllNotifications            = ()   => w.getAll()
export const clearNotificationsForProduct  = (id) => w.clearForProduct(id)
export const markNotificationAsRead        = (id) => w.markRead(id)
export const markAllNotificationsAsRead    = ()   => w.markAllRead()
export const deleteNotification            = (id) => w.delete(id)
export const deleteAllReadNotifications    = ()   => w.deleteAllRead()
