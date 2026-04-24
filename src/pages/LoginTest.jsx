function LoginTest() {
  console.log('🔍 LoginTest component rendered!')
  console.log('🔍 LoginTest: About to return JSX')
  
  const content = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#2e7d32',
      color: 'white',
      fontSize: '24px',
      fontFamily: 'system-ui',
      flexDirection: 'column'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '48px', marginBottom: '20px' }}>✅ LOGIN PAGE WORKS!</h1>
        <p style={{ fontSize: '18px' }}>If you see this, the LoginTest component is rendering correctly.</p>
        <p style={{ fontSize: '14px', marginTop: '20px', opacity: 0.8 }}>Check the console for debug logs.</p>
      </div>
    </div>
  )
  
  console.log('🔍 LoginTest: JSX content created, returning now')
  return content
}

export default LoginTest
