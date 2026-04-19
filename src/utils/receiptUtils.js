/**
 * Receipt utility functions - Safe for browser and Node.js
 * Does NOT require SerialPort or any Node.js modules
 */

/**
 * Generate receipt number in format YYYYMMDD-XXXX
 * @param {number} dailyCounter - Counter for today (incremented number)
 * @returns {string} Receipt number
 */
export const generateReceiptNumber = (dailyCounter = 1) => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const counter = String(dailyCounter).padStart(4, '0')
  return `${year}${month}${day}-${counter}`
}

/**
 * Get receipt counter for today
 * Extracts the counter from the last receipt number if it's from today
 * @param {string} lastReceiptNumber - Last receipt number
 * @returns {number} Counter for next receipt (or 1 if new day)
 */
export const getNextReceiptCounter = (lastReceiptNumber) => {
  if (!lastReceiptNumber) return 1

  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const todayPrefix = `${year}${month}${day}`

  const parts = lastReceiptNumber.split('-')
  const prefix = parts[0]

  // If the prefix matches today's date, increment the counter
  if (prefix === todayPrefix && parts[1]) {
    const counter = parseInt(parts[1], 10)
    return counter + 1
  }

  // Otherwise start from 1 (new day)
  return 1
}

/**
 * Format date as DD/MM/YYYY
 */
export const formatDate = (date) => {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Format time as HH:MM AM/PM
 */
export const formatTime = (date) => {
  let hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  hours = hours ? hours : 12
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`
}

/**
 * Format number as currency
 */
export const formatMoney = (amount) => {
  const num = parseFloat(amount || 0)
  return `$${num.toFixed(2)}`
}

/**
 * Truncate string to max length
 */
export const truncateString = (str, maxLength) => {
  if (!str) return ''
  return str.length > maxLength ? str.substring(0, maxLength) : str
}
