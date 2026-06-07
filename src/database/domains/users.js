const w = window.stocka.users

export const getUsers = () => w.getAll()
export const getUserByUsername = (username) => w.getByUsername(username)
export const loginUser = (username, password) => w.login(username, password)
export const addUser = (user) => w.add(user)
export const updateUser = (id, user) => w.update(id, user)
export const deactivateUser = (id) => w.deactivate(id)
export const getActiveAdminCount = () => w.getAdminCount()
export const validateUserPassword = (user, password) => w.validatePassword(user, password)
