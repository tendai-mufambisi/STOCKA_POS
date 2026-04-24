import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    console.error('❌ Error Boundary caught an error:', error)
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('❌ Error Boundary componentDidCatch:', error)
    console.error('❌ Error Info:', errorInfo)
    this.setState({
      error: error,
      errorInfo: errorInfo
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#f0f0f0',
          padding: '20px',
          fontFamily: 'monospace'
        }}>
          <h1 style={{ color: '#c62828', marginBottom: '20px' }}>⚠️ Error</h1>
          <p style={{ marginBottom: '10px', color: '#333' }}>Something went wrong:</p>
          <pre style={{
            background: '#fff',
            padding: '15px',
            borderRadius: '5px',
            overflow: 'auto',
            maxWidth: '600px',
            border: '1px solid #ccc',
            color: '#c62828'
          }}>
            {this.state.error && this.state.error.toString()}
          </pre>
          {this.state.errorInfo && (
            <pre style={{
              background: '#fff',
              padding: '15px',
              borderRadius: '5px',
              overflow: 'auto',
              maxWidth: '600px',
              marginTop: '10px',
              border: '1px solid #ccc',
              fontSize: '12px',
              color: '#666'
            }}>
              {this.state.errorInfo.componentStack}
            </pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
