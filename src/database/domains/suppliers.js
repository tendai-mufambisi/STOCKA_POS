const w = window.stocka.suppliers

export const getSuppliers = () => w.getAll()
export const getSupplierById = (id) => w.getById(id)
export const addSupplier = (supplier) => w.add(supplier)
export const updateSupplier = (id, supplier) => w.update(id, supplier)
export const deleteSupplier = (id) => w.delete(id)
export const getSupplierPurchaseHistory = (id) => w.getPurchaseHistory(id)
export const getProductPurchaseHistory = (id) => w.getProductHistory(id)
