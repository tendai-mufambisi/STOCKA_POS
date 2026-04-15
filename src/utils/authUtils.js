import bcrypt from 'bcryptjs'

/**
 * Auth utilities for password hashing and verification
 * Using bcryptjs for client-side password security
 */

// Configuration
const SALT_ROUNDS = 10

/**
 * Hash a password asynchronously
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 */
export const hashPassword = async (password) => {
  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS)
    const hashedPassword = await bcrypt.hash(password, salt)
    return hashedPassword
  } catch (error) {
    console.error('Error hashing password:', error)
    throw new Error('Failed to hash password')
  }
}

/**
 * Compare a plain text password with a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} - True if password matches
 */
export const comparePassword = async (password, hash) => {
  try {
    const isMatch = await bcrypt.compare(password, hash)
    return isMatch
  } catch (error) {
    console.error('Error comparing passwords:', error)
    return false
  }
}

/**
 * Hash a password synchronously (for initial setup)
 * Note: bcryptjs has a sync method, but it's blocking and slower
 * Only use for initial admin user creation
 * @param {string} password - Plain text password
 * @returns {string} - Hashed password
 */
export const hashPasswordSync = (password) => {
  try {
    const salt = bcrypt.genSaltSync(SALT_ROUNDS)
    const hashedPassword = bcrypt.hashSync(password, salt)
    return hashedPassword
  } catch (error) {
    console.error('Error hashing password (sync):', error)
    throw new Error('Failed to hash password')
  }
}

/**
 * Compare a plain text password with a hash synchronously
 * Only use when async is not available
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {boolean} - True if password matches
 */
export const comparePasswordSync = (password, hash) => {
  try {
    const isMatch = bcrypt.compareSync(password, hash)
    return isMatch
  } catch (error) {
    console.error('Error comparing passwords (sync):', error)
    return false
  }
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} - { isValid: boolean, message: string }
 */
export const validatePasswordStrength = (password) => {
  const errors = []

  if (password.length < 6) {
    errors.push('Password must be at least 6 characters long')
  }

  if (!/\d/.test(password)) {
    errors.push('Password should contain at least one number')
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password should contain at least one lowercase letter')
  }

  return {
    isValid: errors.length === 0,
    message: errors.length > 0 ? errors.join(', ') : 'Password is strong'
  }
}
