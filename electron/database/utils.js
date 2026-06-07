// Convert sql.js exec() results into plain object arrays
function extractResults(result) {
  if (!result || !result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const obj = {}
    columns.forEach((col, i) => { obj[col] = row[i] })
    return obj
  })
}

// Return the first scalar value from a sql.js exec() result
function getScalar(result, defaultValue = 0) {
  if (!result || !result.length || !result[0].values.length) return defaultValue
  return result[0].values[0][0] ?? defaultValue
}

module.exports = { extractResults, getScalar }
