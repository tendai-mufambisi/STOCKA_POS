import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './Login.css'
import { getUserByUsername, addUser, updateUser, validateUserPassword, getExistingOpenShift, startShift } from '../database/db'
import OpeningFloatModal from '../components/OpeningFloatModal'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [showOpeningModal, setShowOpeningModal] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [existingShift, setExistingShift] = useState(null)
  const navigate = useNavigate()

  // Initialize default admin user on first load
  useEffect(() => {
    const initializeDefaultAdmin = async () => {
      try {
        let existingAdmin = null
        try {
          existingAdmin = await getUserByUsername('admin')
        } catch (err) {
          console.warn('Could not check for existing admin user:', err)
        }
        
        if (!existingAdmin) {
          // Create default admin user
          try {
            await addUser({
              username: 'admin',
              password: 'admin123',
              role: 'Admin',
              created_by: 'system'
            })
            console.log('Default admin user created')
          } catch (addErr) {
            // If UNIQUE constraint error, admin already exists (just ignore)
            const errorStr = addErr.toString ? addErr.toString() : String(addErr)
            if (errorStr.includes('UNIQUE constraint')) {
              console.log('Default admin user already exists')
            } else {
              console.warn('Failed to create default admin:', addErr)
            }
          }
        }
        setInitialized(true)
      } catch (err) {
        console.error('Failed to initialize default admin:', err)
        setInitialized(true) // Still mark as initialized even on error
      }
    }
    initializeDefaultAdmin()
  }, [])

  const handleLogin = async () => {
    setError('')
    if (!username || !password) {
      setError('Please enter your username and password')
      return
    }
    setLoading(true)
    try {
      const user = await getUserByUsername(username)
      
      if (!user) {
        setError('Incorrect username or password')
        setLoading(false)
        return
      }

      if (user.is_active === 0) {
        setError('This account has been deactivated. Contact your administrator.')
        setLoading(false)
        return
      }

      // Validate password (supports both hashed and plain text for migration)
      const isPasswordValid = await validateUserPassword(user, password)
      if (!isPasswordValid) {
        setError('Incorrect username or password')
        setLoading(false)
        return
      }

      // Update last login
      await updateUser(user.id, {
        last_login: new Date().toISOString()
      })

      // Store user in localStorage (without sensitive data)
      const userToStore = {
        id: user.id,
        username: user.username,
        name: user.username, // Use username as display name if no name field
        role: user.role
      }
      localStorage.setItem('stocka_user', JSON.stringify(userToStore))
      
      // For Cashier role: Show opening float modal
      if (user.role === 'Cashier') {
        // Check if there's an existing open shift for this cashier
        const openShift = await getExistingOpenShift(user.username)
        if (openShift) {
          setExistingShift(openShift)
          // For now, just navigate. In future, offer option to resume or start fresh
          setLoading(false)
          navigate('/dashboard')
        } else {
          setCurrentUser(userToStore)
          setShowOpeningModal(true)
          setLoading(false)  // Reset loading so modal inputs are active
        }
      } else {
        // Admin and Manager: Skip opening float, go straight to dashboard
        setLoading(false)
        navigate('/dashboard')
      }
    } catch (err) {
      console.error('Login failed:', err)
      setError('An error occurred during login. Please try again.')
      setLoading(false)
    }
  }

  const handleOpeningFloatSubmit = async (openingFloat) => {
    setLoading(true)
    try {
      // Start the shift in database
      await startShift(currentUser, openingFloat)
      
      setShowOpeningModal(false)
      setLoading(false)
      navigate('/dashboard')
    } catch (err) {
      console.error('Failed to start shift:', err)
      setError('Failed to start shift. Please try again.')
      setLoading(false)
    }
  }

  const handleOpeningFloatCancel = () => {
    setShowOpeningModal(false)
    setCurrentUser(null)
    setLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLogin()
  }

  if (showOpeningModal && currentUser) {
    return <OpeningFloatModal 
      user={currentUser} 
      onConfirm={handleOpeningFloatSubmit}
      onCancel={handleOpeningFloatCancel}
      isLoading={loading}
    />
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-circle">S</div>
          <h1>Stocka</h1>
          <p>Smart retail management for Zimbabwe</p>
        </div>

        <div className="login-form">
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button
            className="login-btn"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>

        <div className="login-footer">
          <p>Stocka v1.0 — Proudly Zimbabwean 🇿🇼</p>
        </div>
      </div>
    </div>
  )
}

export default Login