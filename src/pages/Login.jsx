import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './Login.css'
import { getUserByUsername, addUser, updateUser, validateUserPassword } from '../database/db'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const navigate = useNavigate()

  // Initialize default admin user on first load
  useEffect(() => {
    const initializeDefaultAdmin = async () => {
      try {
        const existingAdmin = await getUserByUsername('admin')
        if (!existingAdmin) {
          // Create default admin user
          await addUser({
            username: 'admin',
            password: 'admin123',
            role: 'Admin',
            created_by: 'system'
          })
        }
        setInitialized(true)
      } catch (err) {
        console.error('Failed to initialize default admin:', err)
        setInitialized(true)
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
        role: user.role
      }
      localStorage.setItem('stocka_user', JSON.stringify(userToStore))
      
      // TODO: Implement opening float modal here
      // For Cashier role: Check if there's an open shift for today
      // If yes: Show modal asking to confirm opening float amount
      // If no: Admin needs to allocate float before cashier can open shift
      // await getCurrentShift(user.id) or await getShiftsByDate(today, user.id)
      // Display modal with opening float confirmation
      
      navigate('/dashboard')
    } catch (err) {
      console.error('Login failed:', err)
      setError('An error occurred during login. Please try again.')
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLogin()
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