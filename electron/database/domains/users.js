const bcrypt = require('bcryptjs')
const { getDb, saveDb } = require('../index')
const { extractResults, getScalar } = require('../utils')
const { logAuditAction } = require('./audit')

function getUsers() {
  return extractResults(getDb().exec(
    'SELECT id, username, role, is_active, created_by, last_login, created_at FROM users ORDER BY created_at DESC'
  ))
}

function getUserByUsername(username) {
  const rows = extractResults(getDb().exec('SELECT * FROM users WHERE username = ?', [username]))
  return rows[0] || null
}

function loginUser(username, password) {
  if (!username || !password) return null
  const user = getUserByUsername(username)
  if (!user) {
    try { logAuditAction('system', 'LOGIN_FAILED', 'USER', username, 'User not found') } catch (_) {}
    return null
  }
  if (!user.is_active) {
    try { logAuditAction('system', 'LOGIN_FAILED', 'USER', username, 'User inactive') } catch (_) {}
    return null
  }

  const match = validateUserPassword(user, password)
  if (!match) {
    try { logAuditAction('system', 'LOGIN_FAILED', 'USER', username, 'Invalid password') } catch (_) {}
    return null
  }

  getDb().run(`UPDATE users SET last_login = ? WHERE id = ?`, [new Date().toISOString(), user.id])
  saveDb()
  try { logAuditAction(username, 'LOGIN', 'USER', String(user.id), `${user.role} user ${username} logged in`) } catch (_) {}

  return { id: user.id, username: user.username, role: user.role, is_active: user.is_active }
}

function validateUserPassword(user, password) {
  if (!user) return false
  if (user.password_hash) {
    try { return bcrypt.compareSync(password, user.password_hash) } catch (_) { return false }
  }
  if (user.password && user.password === password) {
    // Auto-migrate to hashed
    try { addUser({ username: user.username, password, role: user.role, created_by: 'migration' }) } catch (_) {}
    return true
  }
  return false
}

function addUser(user) {
  const hash = bcrypt.hashSync(user.password, 10)
  getDb().run(
    `INSERT INTO users (username, password, password_hash, role, is_active, created_by) VALUES (?, ?, ?, ?, 1, ?)`,
    [user.username, '', hash, user.role, user.created_by || 'admin']
  )
  saveDb()
}

function updateUser(id, user) {
  const db = getDb()
  const fields = []
  const values = []

  if (user.password !== undefined) {
    const hash = bcrypt.hashSync(user.password, 10)
    fields.push('password_hash = ?', 'password = ?')
    values.push(hash, '')
  }
  if (user.role !== undefined) { fields.push('role = ?'); values.push(user.role) }
  if (user.is_active !== undefined) { fields.push('is_active = ?'); values.push(user.is_active) }
  if (user.last_login !== undefined) { fields.push('last_login = ?'); values.push(user.last_login) }

  if (!fields.length) return
  values.push(id)
  db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values)
  saveDb()
}

function deactivateUser(id) {
  getDb().run('UPDATE users SET is_active = 0 WHERE id = ?', [id])
  saveDb()
}

function getActiveAdminCount() {
  return getScalar(getDb().exec("SELECT COUNT(*) FROM users WHERE role = 'Admin' AND is_active = 1"), 0)
}

module.exports = { getUsers, getUserByUsername, loginUser, validateUserPassword, addUser, updateUser, deactivateUser, getActiveAdminCount }
