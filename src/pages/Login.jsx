import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginUser } from '../database/db'
function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showLoginForm, setShowLoginForm] = useState(false)

  const handleLogin = async () => {
    setError('')
    if (!username || !password) {
      setError('Please enter your username and password')
      return
    }
    setLoading(true)
    try {
      const user = await loginUser(username, password)
      
      if (user) {
        // Store user in localStorage
        localStorage.setItem('stocka_user', JSON.stringify(user))
        // Redirect to dashboard
        window.location.hash = '#/dashboard'
      } else {
        setError('Invalid username or password')
      }
      setLoading(false)
    } catch (err) {
      setError('Login error: ' + err.message)
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLogin()
  }

  const handleSetupRedirect = () => {
    window.location.hash = '#/setup'
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#f0f4f0',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {!showLoginForm ? (
        // Welcome Screen
        <div style={{
          background: 'white',
          padding: '60px 40px',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          width: '100%',
          maxWidth: '500px',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '64px',
            marginBottom: '20px'
          }}>
            📦
          </div>
          <h1 style={{ margin: '0 0 8px 0', fontSize: '32px', color: '#333' }}>
            Stocka
          </h1>
          <p style={{ margin: '0 0 30px 0', color: '#666', fontSize: '16px' }}>
            Smart Retail Management for Zimbabwe 🇿🇼
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button
              onClick={handleSetupRedirect}
              style={{
                padding: '14px 24px',
                background: 'linear-gradient(135deg, #2e7d32 0%, #1a5c2a 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => e.target.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
            >
              🚀 Set Up My Business
            </button>
            <button
              onClick={() => setShowLoginForm(true)}
              style={{
                padding: '14px 24px',
                background: 'white',
                color: '#2e7d32',
                border: '2px solid #2e7d32',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#f0f7f0'
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'white'
              }}
            >
              ← I Have An Account — Sign In
            </button>
          </div>

          <p style={{ margin: '30px 0 0 0', fontSize: '12px', color: '#999' }}>
            v1.0.0 — Proudly Zimbabwean 🇿🇼
          </p>
        </div>
      ) : (
        // Login Form
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          width: '100%',
          maxWidth: '400px'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <div style={{
              width: '60px',
              height: '60px',
              background: '#2e7d32',
              color: 'white',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              margin: '0 auto 20px'
            }}>
              📦
            </div>
            <h1 style={{ margin: '0 0 5px 0', fontSize: '24px', color: '#333' }}>
              Sign In
            </h1>
            <p style={{ margin: '0', color: '#666', fontSize: '13px' }}>
              Welcome back to Stocka
            </p>
          </div>

          <div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>Username</label>
              <input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>Password</label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {error && <div style={{ color: '#c62828', marginBottom: '15px', fontSize: '14px' }}>{error}</div>}

            <button
              onClick={handleLogin}
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px',
                background: '#2e7d32',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                fontWeight: '500',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>

          <div style={{ textAlign: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
            <button
              onClick={() => setShowLoginForm(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2e7d32',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '600',
                textDecoration: 'underline'
              }}
            >
              ← Back to Welcome
            </button>
            <p style={{ margin: '12px 0 0 0', fontSize: '12px', color: '#999' }}>
              Stocka v1.0 — Proudly Zimbabwean 🇿🇼
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default Login