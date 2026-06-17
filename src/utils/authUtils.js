/**
 * Validate a login PIN — must be exactly 4 digits
 * @param {string} pin - PIN to validate
 * @returns {Object} - { isValid: boolean, message: string }
 */
export const validatePin = (pin) => {
  if (!/^\d{4}$/.test(pin || '')) {
    return { isValid: false, message: 'PIN must be exactly 4 digits' }
  }
  return { isValid: true, message: 'PIN is valid' }
}
