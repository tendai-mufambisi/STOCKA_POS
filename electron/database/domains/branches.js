const { getDb } = require('../index')

function getBranches() {
  return getDb().prepare('SELECT * FROM branches ORDER BY name ASC').all()
}

function getBranchById(id) {
  return getDb().prepare('SELECT * FROM branches WHERE id = ?').get(id) || null
}

function addBranch(branch) {
  getDb().prepare(
    `INSERT INTO branches (name, address, phone, manager_name) VALUES (?, ?, ?, ?)`
  ).run(branch.name, branch.address || '', branch.phone || '', branch.manager_name || '')
}

function updateBranch(id, branch) {
  getDb().prepare(
    `UPDATE branches SET name = ?, address = ?, phone = ?, manager_name = ? WHERE id = ?`
  ).run(branch.name, branch.address || '', branch.phone || '', branch.manager_name || '', id)
}

function deleteBranch(id) {
  getDb().prepare('DELETE FROM branches WHERE id = ?').run(id)
}

module.exports = { getBranches, getBranchById, addBranch, updateBranch, deleteBranch }
