/**
 * Input Validation Utility
 * Provides reusable validators for form inputs
 * All validators return { valid: boolean, error: string }
 */

/**
 * Validate required field (not empty)
 * @param {any} value - Field value
 * @param {string} fieldName - Display name
 * @returns {Object} - { valid, error }
 */
export const validateRequired = (value, fieldName = 'This field') => {
  if (!value || (typeof value === 'string' && value.trim() === '')) {
    return { valid: false, error: `${fieldName} is required` }
  }
  return { valid: true, error: '' }
}

/**
 * Validate string length
 * @param {string} value - Field value
 * @param {number} minLength - Minimum length
 * @param {number} maxLength - Maximum length
 * @param {string} fieldName - Display name
 * @returns {Object} - { valid, error }
 */
export const validateLength = (value, minLength, maxLength, fieldName = 'This field') => {
  if (!value) return { valid: true, error: '' } // Allow empty if not required
  
  const length = String(value).length
  
  if (minLength && length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters` }
  }
  
  if (maxLength && length > maxLength) {
    return { valid: false, error: `${fieldName} must not exceed ${maxLength} characters` }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate email format
 * @param {string} email - Email value
 * @returns {Object} - { valid, error }
 */
export const validateEmail = (email) => {
  if (!email) return { valid: true, error: '' } // Allow empty if not required
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Please enter a valid email address' }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate number (integer or decimal)
 * @param {any} value - Field value
 * @param {string} fieldName - Display name
 * @returns {Object} - { valid, error }
 */
export const validateNumber = (value, fieldName = 'This field') => {
  if (!value && value !== 0) return { valid: true, error: '' } // Allow empty if not required
  
  const num = Number(value)
  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a valid number` }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate positive number (> 0)
 * @param {any} value - Field value
 * @param {string} fieldName - Display name
 * @returns {Object} - { valid, error }
 */
export const validatePositiveNumber = (value, fieldName = 'This field') => {
  if (!value && value !== 0) return { valid: true, error: '' } // Allow empty if not required
  
  const num = Number(value)
  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a valid number` }
  }
  
  if (num <= 0) {
    return { valid: false, error: `${fieldName} must be greater than 0` }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate non-negative number (>= 0)
 * @param {any} value - Field value
 * @param {string} fieldName - Display name
 * @returns {Object} - { valid, error }
 */
export const validateNonNegativeNumber = (value, fieldName = 'This field') => {
  if (!value && value !== 0) return { valid: true, error: '' } // Allow empty if not required
  
  const num = Number(value)
  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a valid number` }
  }
  
  if (num < 0) {
    return { valid: false, error: `${fieldName} must be 0 or greater` }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate currency amount
 * @param {any} value - Field value
 * @param {string} fieldName - Display name
 * @returns {Object} - { valid, error }
 */
export const validateCurrency = (value, fieldName = 'Amount') => {
  if (!value && value !== 0) return { valid: true, error: '' } // Allow empty if not required
  
  const num = Number(value)
  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a valid amount` }
  }
  
  if (num < 0) {
    return { valid: false, error: `${fieldName} cannot be negative` }
  }
  
  // Check for valid decimal places (max 2 for currency)
  const decimalPlaces = (String(value).split('.')[1] || '').length
  if (decimalPlaces > 2) {
    return { valid: false, error: `${fieldName} cannot have more than 2 decimal places` }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate date format (ISO or MM/DD/YYYY)
 * @param {string} date - Date value
 * @returns {Object} - { valid, error }
 */
export const validateDate = (date) => {
  if (!date) return { valid: true, error: '' } // Allow empty if not required
  
  const parsed = new Date(date)
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: 'Please enter a valid date' }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate password strength
 * @param {string} password - Password value
 * @returns {Object} - { valid, error }
 */
export const validatePassword = (password) => {
  if (!password) {
    return { valid: false, error: 'Password is required' }
  }
  
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters' }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate username
 * @param {string} username - Username value
 * @returns {Object} - { valid, error }
 */
export const validateUsername = (username) => {
  if (!username) {
    return { valid: false, error: 'Username is required' }
  }
  
  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' }
  }
  
  if (!/^[a-zA-Z0-9_\-]+$/.test(username)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' }
  }
  
  return { valid: true, error: '' }
}

/**
 * Validate phone number (basic)
 * @param {string} phone - Phone value
 * @returns {Object} - { valid, error }
 */
export const validatePhone = (phone) => {
  if (!phone) return { valid: true, error: '' } // Allow empty if not required
  
  const phoneRegex = /^[\d\-\+\s\(\)]{7,}$/
  if (!phoneRegex.test(phone)) {
    return { valid: false, error: 'Please enter a valid phone number' }
  }
  
  return { valid: true, error: '' }
}

/**
 * Composite validator - validates multiple fields at once
 * @param {Object} data - Field data { fieldName: value, ... }
 * @param {Object} rules - Validation rules { fieldName: [validators], ... }
 * @returns {Object} - { valid, errors: { fieldName: error, ... } }
 */
export const validateComposite = (data, rules) => {
  const errors = {}
  
  for (const [fieldName, validators] of Object.entries(rules)) {
    const value = data[fieldName]
    
    for (const validator of validators) {
      const result = validator(value)
      if (!result.valid) {
        errors[fieldName] = result.error
        break // Stop at first error for this field
      }
    }
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors
  }
}

/**
 * Helper: Create validators for a field
 * Usage: createFieldValidators(['required', 'length:3:50', 'email'])
 * @param {Array} specs - Array of validator specs
 * @param {string} fieldName - Display name
 * @returns {Array} - Array of validator functions
 */
export const createFieldValidators = (specs, fieldName = '') => {
  return specs.map(spec => {
    if (spec === 'required') {
      return (value) => validateRequired(value, fieldName)
    } else if (spec.startsWith('length:')) {
      const [, min, max] = spec.split(':')
      return (value) => validateLength(value, parseInt(min), parseInt(max), fieldName)
    } else if (spec === 'email') {
      return (value) => validateEmail(value)
    } else if (spec === 'number') {
      return (value) => validateNumber(value, fieldName)
    } else if (spec === 'positiveNumber') {
      return (value) => validatePositiveNumber(value, fieldName)
    } else if (spec === 'nonNegativeNumber') {
      return (value) => validateNonNegativeNumber(value, fieldName)
    } else if (spec === 'currency') {
      return (value) => validateCurrency(value, fieldName)
    } else if (spec === 'date') {
      return (value) => validateDate(value)
    } else if (spec === 'password') {
      return (value) => validatePassword(value)
    } else if (spec === 'username') {
      return (value) => validateUsername(value)
    } else if (spec === 'phone') {
      return (value) => validatePhone(value)
    }
    return (value) => ({ valid: true, error: '' })
  })
}
