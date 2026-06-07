const w = window.stocka.branches

export const getBranches = () => w.getAll()
export const getBranchById = (id) => w.getById(id)
export const addBranch = (b) => w.add(b)
export const updateBranch = (id, b) => w.update(id, b)
export const deleteBranch = (id) => w.delete(id)
