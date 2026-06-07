const w = window.stocka.holds

export const createHold = (shiftId, productId, quantity) => w.create(shiftId, productId, quantity)
export const getHoldsByShift = (shiftId) => w.getByShift(shiftId)
export const deleteHoldsOnLogout = (shiftId) => w.deleteOnLogout(shiftId)
export const releaseHold = (holdId) => w.release(holdId)
