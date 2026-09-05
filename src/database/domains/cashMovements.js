const w = window.stocka.cash

export const addCashMovement = (m) => w.add(m)
export const getCashMovements = (filters) => w.getAll(filters)
export const deleteCashMovement = (id, by) => w.delete(id, by)
export const getCashPosition = (range) => w.position(range)
export const getMovementTypes = () => w.types()
export const getTenders = () => w.tenders()
