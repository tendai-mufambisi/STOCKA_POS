import { useState } from 'react'
import { loginUser } from '../database/db'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setError('')
    if (!username || !password) {
      setError('Please enter your username and password')
      return
    }
    setLoading(true)
    try {
      console.log('Login attempted with:', username)
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

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#f0f4f0',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
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
            fontWeight: 'bold',
            margin: '0 auto 15px'
          }}>S</div>
          <h1 style={{ margin: '0 0 5px', fontSize: '28px', color: '#1a1a1a' }}>Stocka</h1>
          <p style={{ margin: '0', color: '#666', fontSize: '14px' }}>Smart retail management for Zimbabwe</p>
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
          <p style={{ margin: '0', fontSize: '12px', color: '#666' }}>Stocka v1.0 — Proudly Zimbabwean 🇿🇼</p>
        </div>
      </div>
    </div>
  )
}

export default Login