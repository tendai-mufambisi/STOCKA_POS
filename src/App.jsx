import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ShopSetup from './pages/ShopSetup'
import Activation from './pages/Activation'
import ErrorBoundary from './components/ErrorBoundary'
import { getShop } from './database/db'
import iconPng from './assets/icon.png'

function App() {
  const [setupComplete, setSetupComplete] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingError, setLoadingError] = useState(false)
  const [licenseValid, setLicenseValid] = useState(null)
  const isLoggedIn = localStorage.getItem('stocka_user')

  useEffect(() => {
    const init = async () => {
      try {
        // License check — Electron only, skip in dev/web mode
        if (window.stocka?.license) {
          const lic = await window.stocka.license.check()
          if (!lic?.valid) {
            setLicenseValid(false)
            setLoading(false)
            return
          }
        }
        setLicenseValid(true)

        // Database / setup check
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database initialization timeout')), 8000)
        )
        const shop = await Promise.race([getShop(), timeoutPromise])
        setSetupComplete(shop?.setup_complete === 1)
        setLoadingError(false)
      } catch (error) {
        console.error('Setup check failed:', error)
        setSetupComplete(true)
        setLoadingError(true)
        setLicenseValid(true)
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #2e7d32 0%, #1a5c2a 100%)',
        fontSize: '16px',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <img src={iconPng} alt="Stocka" style={{ width: '72px', height: '72px', borderRadius: '18px', marginBottom: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.2)', display: 'block', margin: '0 auto 20px' }} />
        <h1 style={{ marginBottom: '10px' }}>Stocka</h1>
        <p style={{ marginBottom: '30px', opacity: 0.9 }}>Initializing database...</p>
        <div style={{
          width: '200px',
          height: '4px',
          background: 'rgba(255,255,255,0.3)',
          borderRadius: '2px',
          overflow: 'hidden'
        }}>
          <div style={{
            height: '100%',
            background: '#fff',
            width: '60%',
            animation: 'pulse 1.5s ease-in-out infinite',
            borderRadius: '2px'
          }} />
        </div>
        <p style={{ marginTop: '32px', opacity: 0.4, fontSize: '12px' }}>v1.0 — Proudly Zimbabwean</p>
      </div>
    )
  }

  // License not activated — show activation screen
  if (licenseValid === false) {
    return <Activation onActivated={() => window.location.reload()} />
  }

  // If there was an error, show a fallback
  if (loadingError) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f0f4f0',
        color: '#c62828',
        fontSize: '18px',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h2>Database Error</h2>
          <p>Unable to initialize database. Please restart the application.</p>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={
            setupComplete === null || setupComplete === false ? <Navigate to="/setup" /> : isLoggedIn ? <Navigate to="/dashboard" /> : <Navigate to="/login" />
          } />
          <Route path="/setup" element={setupComplete ? <Navigate to="/login" /> : <ShopSetup onSetupComplete={() => setSetupComplete(true)} />} />
          <Route path="/login" element={isLoggedIn ? <Navigate to="/dashboard" /> : <Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  )
}

export default App
