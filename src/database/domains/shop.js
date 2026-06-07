const w = window.stocka.shop

export const getShop = () => w.get()
export const initializeShop = (data) => w.init(data)
export const updateShop = (id, data) => w.update(id, data)
export const resetOwnerPin = (username, newPin) => w.resetPin(username, newPin)
