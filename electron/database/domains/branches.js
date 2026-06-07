const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')

function getBranches() {
  return extractResults(getDb().exec('SELECT * FROM branches ORDER BY name ASC'))
}

function getBranchById(id) {
  const rows = extractResults(getDb().exec('SELECT * FROM branches WHERE id = ?', [id]))
  return rows[0] || null
}

function addBranch(branch) {
  getDb().run(
    `INSERT INTO branches (name, address, phone, manager_name) VALUES (?, ?, ?, ?)`,
    [branch.name, branch.address || '', branch.phone || '', branch.manager_name || '']
  )
  saveDb()
}

function updateBranch(id, branch) {
  getDb().run(
    `UPDATE branches SET name = ?, address = ?, phone = ?, manager_name = ? WHERE id = ?`,
    [branch.name, branch.address || '', branch.phone || '', branch.manager_name || '', id]
  )
  saveDb()
}

function deleteBranch(id) {
  getDb().run('DELETE FROM branches WHERE id = ?', [id])
  saveDb()
}

module.exports = { getBranches, getBranchById, addBranch, updateBranch, deleteBranch }
