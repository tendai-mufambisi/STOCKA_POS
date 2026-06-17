const w = window.stocka.products

export const getProducts = () => w.getAll()
export const getProductById = (id) => w.getById(id)
export const addProduct = (product) => w.add(product)
export const updateProduct = (id, product) => w.update(id, product)
export const deleteProduct = (id) => w.delete(id)
export const updateProductQuantity = (id, qty) => w.updateQty(id, qty)
export const updateProductImage = (id, data) => w.updateImage(id, data)
export const updateProductLastSoldDate = (id) => w.updateLastSold(id)
export const getLatestProductPrice = (id) => w.getLatestPrice(id)
export const getAllLatestCostPrices = () => w.getAllCostPrices()
export const getMostSoldProducts = (limit) => w.getMostSold(limit)
export const addProductsBatch    = (rows)  => w.importBatch(rows)
