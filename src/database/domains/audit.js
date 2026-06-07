const w = window.stocka.audit

export const logAuditAction = (username, actionType, entityType, entityId, description, oldValue = null, newValue = null) =>
  w.log(username, actionType, entityType, entityId, description, oldValue, newValue)
export const getAuditLog = (startDate, endDate) => w.getLog(startDate, endDate)
export const getEntityAuditTrail = (entityType, entityId) => w.getEntity(entityType, entityId)
export const getRecentAuditActions = () => w.getRecent()
export const cleanupOldAuditLogs = () => w.cleanup()
