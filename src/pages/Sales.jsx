import { useState, useEffect } from 'react'
import { getProducts, addSale, getLatestProductPrice, getMostSoldProducts, getHeldSales, holdSale, recallHeldSale, discardHeldSale, voidSale, getSaleById, getSaleItems, getCurrentShift, openShift, getShop, getLastReceiptNumber, updateSaleReceiptNumber, getReceiptBySaleId } from '../database/db'
import { hasPermission } from '../utils/permissions'
import { generateReceiptNumber, getNextReceiptCounter } from '../utils/printerUtils'
import './Sales.css'
import {
  FiChevronLeft, FiChevronRight, FiPackage, FiDollarSign, FiCreditCard, FiSmartphone, FiCheck, FiPause, FiX, FiTrash2
} from 'react-icons/fi'

function Sales({ user }) {
  // Product & Cart State
  const [products, setProducts] = useState([])
  const [mostSoldProducts, setMostSoldProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  
  // Held Sales State
  const [heldSales, setHeldSales] = useState([])
  const [showHeldModal, setShowHeldModal] = useState(false)
  const [showHeldPanel, setShowHeldPanel] = useState(false)
  
  // Checkout Flow State
  const [checkoutStep, setCheckoutStep] = useState(null) // null | 'paymentMethod' | 'cashTendered'
  const [selectedPaymentForCheckout, setSelectedPaymentForCheckout] = useState(null)
  const [checkoutCashTendered, setCheckoutCashTendered] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Legacy State (for compatibility during transition)
  const [cashTendered, setCashTendered] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('USD Cash')
  const [currency, setCurrency] = useState('USD')
  
  // UI State
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [lastSale, setLastSale] = useState(null)
  const [error, setError] = useState('')
  const [voidSaleId, setVoidSaleId] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [showVoidModal, setShowVoidModal] = useState(false)

  // Shift State
  const [currentShift, setCurrentShift] = useState(null)
  const [shiftWarning, setShiftWarning] = useState('')

  // Printer State
  const [shopInfo, setShopInfo] = useState(null)
  const [printerSettings, setPrinterSettings] = useState(null)

  useEffect(() => {
    loadProducts()
    loadHeldSales()
    loadCurrentShift()
    loadShopInfo()
  }, [])

  const loadHeldSales = async () => {
    try {
      const held = await getHeldSales()
      setHeldSales(held)
    } catch (err) {
      console.error('Failed to load held sales:', err)
    }
  }

  const loadCurrentShift = async () => {
    try {
      const shift = await getCurrentShift(user.id)
      setCurrentShift(shift)
      if (!shift) {
        setShiftWarning('No active shift. Sales will not be linked to a shift.')
      }
    } catch (err) {
      console.error('Failed to load current shift:', err)
    }
  }

  const loadShopInfo = async () => {
    try {
      const shop = await getShop()
      console.log('📋 Shop info loaded:', { printer_name: shop?.printer_name, printer_port: shop?.printer_port, auto_print: shop?.auto_print })
      setShopInfo(shop)
      const settings = {
        printer_name: shop?.printer_name,
        printer_port: shop?.printer_port,
        auto_print: shop?.auto_print ?? 1,
        print_duplicate: shop?.print_duplicate ?? 0
      }
      console.log('🖨️ Printer settings configured:', settings)
      setPrinterSettings(settings)
    } catch (err) {
      console.error('❌ Failed to load shop info:', err)
    }
  }

 useEffect(() => {
    if (showConfirmation) {
      const timer = setTimeout(() => setShowConfirmation(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [showConfirmation])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const productsData = await getProducts()
      const mostSold = await getMostSoldProducts(10)
      
      // Load prices for each product
      const enrichedProducts = []
      for (const product of productsData) {
        const price = await getLatestProductPrice(product.id)
        enrichedProducts.push({
          ...product,
          selling_price: price?.selling_price_per_unit || 0,
          cost_price: price?.cost_per_unit || 0
        })
      }
      
      // Enrich most sold products with prices
      const enrichedMostSold = []
      for (const product of mostSold) {
        const price = await getLatestProductPrice(product.id)
        enrichedMostSold.push({
          ...product,
          selling_price: price?.selling_price_per_unit || 0,
          cost_price: price?.cost_per_unit || 0
        })
      }
      
      enrichedProducts.sort((a, b) => (b.current_quantity || 0) - (a.current_quantity || 0))
      setProducts(enrichedProducts)
      setMostSoldProducts(enrichedMostSold)
    } catch (err) {
      setError('Failed to load products')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const searchResults = search.trim()
    ? products.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 10)
    : []

  const addToCart = (product) => {
    if (product.current_quantity <= 0) {
      setError('Product out of stock')
      setTimeout(() => setError(''), 3000)
      return
    }

    const existingItem = cart.find(item => item.product_id === product.id)

    if (existingItem) {
      setCart(cart.map(item =>
        item.product_id === product.id
          ? {
              ...item,
              quantity: item.quantity + 1,
              subtotal: (item.quantity + 1) * item.selling_price
            }
          : item
      ))
    } else {
      setCart([...cart, {
        product_id: product.id,
        product_name: product.name,
        selling_price: product.selling_price,
        cost_price: product.cost_price,
        quantity: 1,
        subtotal: product.selling_price
      }])
    }

    setSearch('')
  }

  const updateCartQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(productId)
    } else {
      setCart(cart.map(item =>
        item.product_id === productId
          ? {
              ...item,
              quantity,
              subtotal: quantity * item.selling_price
            }
          : item
      ))
    }
  }

  const removeFromCart = (productId) => {
    setCart(cart.filter(item => item.product_id !== productId))
  }

  // Checkout Flow Handlers
  const handleChargeClick = () => {
    if (cart.length === 0) {
      setError('Cart is empty')
      setTimeout(() => setError(''), 3000)
      return
    }
    setCheckoutStep('paymentMethod')
    setError('')
  }

  const handleHoldSale = async () => {
    if (cart.length === 0) {
      setError('Cart is empty, nothing to hold')
      setTimeout(() => setError(''), 3000)
      return
    }

    setIsProcessing(true)
    try {
      // Create a pending sale (not completed yet)
      const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
      
      const sale = {
        cashier: user.username,
        total: cartTotal,
        cash_tendered: 0,
        change_given: 0,
        payment_method: 'HELD',
        currency: 'USD',
        shift_id: currentShift?.id || null
      }

      const saleId = await addSale(sale, cart)
      
      // Auto-generate hold label with sale ID
      const holdLabel = `Hold-${saleId}`
      
      // Then hold it
      await holdSale(saleId, holdLabel)
      
      // Reload held sales
      await loadHeldSales()
      
      setCart([])
      setSearch('')
      
      // Show success with hold ID
      setError(`✓ Sale held as "${holdLabel}" - Total: $${cartTotal.toFixed(2)}`)
      setTimeout(() => setError(''), 4000)
      
      await loadProducts()
    } catch (err) {
      setError('Failed to hold sale')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRecallSale = async (heldSaleId) => {
    try {
      // If cart has items, automatically hold them first
      if (cart.length > 0) {
        const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
        
        const sale = {
          cashier: user.username,
          total: cartTotal,
          cash_tendered: 0,
          change_given: 0,
          payment_method: 'HELD',
          currency: 'USD',
          shift_id: currentShift?.id || null
        }

        const saleId = await addSale(sale, cart)
        const holdLabel = `Hold-${saleId}`
        await holdSale(saleId, holdLabel)
      }

      // Get the held sale details
      const heldSale = await getSaleById(heldSaleId)
      const items = await getSaleItems(heldSaleId)
      
      // Restore the cart with the items
      const cartItemsWithPrices = items.map(item => ({
        product_id: item.product_id,
        product_name: item.product_name,
        selling_price: item.selling_price,
        cost_price: item.cost_price,
        quantity: item.quantity,
        subtotal: item.subtotal
      }))
      
      setCart(cartItemsWithPrices)
      
      // Mark as recalled
      await recallHeldSale(heldSaleId)
      
      // Reload held sales
      await loadHeldSales()
      
      setShowHeldPanel(false)
      setError(`Sale "${heldSale.id}" recalled ✓`)
      setTimeout(() => setError(''), 3000)
    } catch (err) {
      setError('Failed to recall sale')
      console.error(err)
    }
  }

  const handleDiscardHeldSale = async (heldSaleId) => {
    if (!window.confirm('Are you sure you want to discard this held sale?')) {
      return
    }

    try {
      await discardHeldSale(heldSaleId)
      await loadHeldSales()
      setError('Held sale discarded ✓')
      setTimeout(() => setError(''), 3000)
    } catch (err) {
      setError('Failed to discard sale')
      console.error(err)
    }
  }

  const handleVoidSaleClick = async () => {
    if (!voidReason.trim()) {
      setError('Please enter a reason for voiding')
      return
    }

    setIsProcessing(true)
    try {
      await voidSale(voidSaleId, voidReason, user.username)
      setShowVoidModal(false)
      setVoidSaleId(null)
      setVoidReason('')
      setError('Sale voided successfully ✓')
      setTimeout(() => setError(''), 3000)
      await loadProducts()
    } catch (err) {
      setError(err.message || 'Failed to void sale')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handlePaymentMethodSelect = (method) => {
    setSelectedPaymentForCheckout(method)
    // If payment method contains "Cash", go to cash tendered step
    if (method.includes('Cash')) {
      setCheckoutStep('cashTendered')
    } else {
      // For non-cash (Card, EcoCash), skip to completion
      handleCompleteCheckout(method, 0)
    }
  }

  const handleCashTenderedChange = (e) => {
    setCheckoutCashTendered(e.target.value)
  }

  const handleBackNavigation = () => {
    if (checkoutStep === 'paymentMethod') {
      setCheckoutStep(null)
      setSelectedPaymentForCheckout(null)
    } else if (checkoutStep === 'cashTendered') {
      setCheckoutStep('paymentMethod')
    }
  }

  const handleCompleteCheckout = async (method, cashAmount) => {
    const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
    
    // Validate cash if payment method is cash
    if (method.includes('Cash')) {
      const cash = parseFloat(cashAmount)
      if (!cashAmount || cash < cartTotal) {
        setError('Insufficient cash tendered')
        return
      }
    }

    setIsProcessing(true)
    try {
      const cashAmount_ = method.includes('Cash') ? parseFloat(cashAmount) : 0
      const change = Math.max(0, cashAmount_ - cartTotal)

      const sale = {
        cashier: user.username,
        total: cartTotal,
        cash_tendered: cashAmount_,
        change_given: change,
        payment_method: method,
        currency: 'USD',
        shift_id: currentShift?.id || null
      }

      // Add sale and get the ID
      const saleId = await addSale(sale, cart)

      // Generate and store receipt number
      try {
        const lastReceipt = await getLastReceiptNumber()
        const nextCounter = getNextReceiptCounter(lastReceipt)
        const receiptNumber = generateReceiptNumber(nextCounter)
        await updateSaleReceiptNumber(saleId, receiptNumber)

        // Prepare receipt data for printing
        const receiptData = {
          ...sale,
          id: saleId,
          receipt_number: receiptNumber,
          items: cart,
          created_at: new Date().toISOString()
        }

        // Auto-print if enabled and printer is configured
        if (printerSettings?.auto_print === 1 && printerSettings?.printer_port) {
          console.log('🖨️ Auto-print triggered for receipt:', receiptNumber, 'to port:', printerSettings.printer_port)
          try {
            // Send to printer via IPC
            const printResult = await window.stocka.printer.printReceipt(
              printerSettings.printer_port,
              receiptData,
              shopInfo,
              false // not a duplicate
            )

            if (!printResult.success) {
              // Show error with details from printer
              const errorMsg = printResult.error 
                ? `Print failed: ${printResult.error}`
                : 'Print failed — sale was still recorded successfully'
              setError(`⚠️ ${errorMsg}`)
              setTimeout(() => setError(''), 5000)
            }

            // If print_duplicate is enabled, print again
            if (printResult.success && printerSettings?.print_duplicate === 1) {
              try {
                await window.stocka.printer.printReceipt(
                  printerSettings.printer_port,
                  receiptData,
                  shopInfo,
                  false // not duplicate on second print either
                )
              } catch (err) {
                console.warn('Failed to print duplicate:', err)
              }
            }
          } catch (err) {
            console.error('Printer communication error:', err)
            // Don't block the sale for printer errors
            setError(`⚠️ Printer error: ${err.message || 'Sale recorded but print failed'}`)
            setTimeout(() => setError(''), 5000)
          }
        } else {
          console.log('⚠️ Auto-print disabled or not configured:', {
            auto_print: printerSettings?.auto_print,
            printer_port: printerSettings?.printer_port
          })
        }
      } catch (err) {
        console.error('Receipt number or print error:', err)
        // Don't fail the sale due to receipt/print errors
      }
      
      setLastSale({
        id: saleId,
        total: cartTotal,
        change: change,
        payment_method: method,
        currency: 'USD',
        timestamp: new Date()
      })
      setShowConfirmation(true)
      
      // Reset checkout flow
      setCheckoutStep(null)
      setSelectedPaymentForCheckout(null)
      setCheckoutCashTendered('')
      setCart([])
      setSearch('')
      await loadProducts()
    } catch (err) {
      setError('Failed to complete sale')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
  const change = Math.max(0, parseFloat(cashTendered || 0) - cartTotal)

  if (loading) {
    return <div className="sales-page"><div className="loading">Loading...</div></div>
  }

  return (
    <div className="sales-page">
      {/* Held Sales Drawer Toggle Button - Only show when there are held sales */}
      {heldSales.length > 0 && (
        <button 
          className={`held-sales-drawer-toggle ${showHeldPanel ? 'active' : ''}`}
          onClick={() => setShowHeldPanel(!showHeldPanel)}
          title={`${heldSales.length} held sales`}
        >
          <div className="toggle-arrow">
            {showHeldPanel ? '◀' : '▶'}
          </div>
          <div className="toggle-badge">{heldSales.length}</div>
        </button>
      )}

      {/* Held Sales Drawer Panel */}
      {heldSales.length > 0 && (
        <div className={`held-sales-drawer ${showHeldPanel ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3>Held Sales Queue ({heldSales.length})</h3>
          <button 
            className="drawer-close"
            onClick={() => setShowHeldPanel(false)}
            title="Close"
          >
            ✕
          </button>
        </div>
        
        {heldSales.length === 0 ? (
          <div className="drawer-empty">No held sales</div>
        ) : (
          <div className="drawer-content">
            {heldSales.map(sale => (
              <div key={sale.id} className="held-sale-item">
                <div className="item-header">
                  <div className="item-id">{sale.id}</div>
                  <div className="item-total">${sale.total?.toFixed(2) || '0.00'}</div>
                </div>
                <div className="item-qty">Items: {sale.items?.length || 0}</div>
                <div className="item-time">{new Date(sale.held_at).toLocaleTimeString()}</div>
                
                <div className="item-actions">
                  <button
                    className="recall-action-btn"
                    onClick={() => {
                      handleRecallSale(sale.id)
                      setShowHeldPanel(false)
                    }}
                  >
                    <FiCheck size={16} /> Recall
                  </button>
                  <button
                    className="discard-action-btn"
                    onClick={() => handleDiscardHeldSale(sale.id)}
                  >
                    <FiTrash2 size={16} /> Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
      
      <div className="sales-container" style={{ gridTemplateColumns: sidebarOpen ? '1fr 1fr' : '0fr 1fr' }}>
        {/* Left Panel - Product Search & Selection */}
        <div className="sales-left" style={{ display: sidebarOpen ? 'flex' : 'none' }}>
          <div className="search-section">
            <h2>Products</h2>
            <input
              type="text"
              placeholder="Search product name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="product-search"
              autoFocus
            />

            {error && <div className="error-message">{error}</div>}

            <div className="search-results">
              {!search ? (
                mostSoldProducts.length > 0 ? (
                  <>
                    <div className="most-sold-title">Top Selling Products</div>
                    {mostSoldProducts.map(product => (
                      <button
                        key={product.id}
                        className="product-result"
                        onClick={() => addToCart(product)}
                        disabled={product.current_quantity <= 0}
                      >
                        <div className="result-image-wrapper">
                          {product.image_data ? (
                            <img src={product.image_data} alt={product.name} className="result-image" />
                          ) : (
                            <div className="result-image-placeholder"><FiPackage size={32} /></div>
                          )}
                        </div>
                        <div className="result-info">
                          <div className="result-name">{product.name}</div>
                          <div className="result-price">${product.selling_price.toFixed(2)}</div>
                          <div className="result-qty">Stock: {product.current_quantity}</div>
                        </div>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="no-search">No products available yet</div>
                )
              ) : searchResults.length === 0 ? (
                <div className="no-results">No products found</div>
              ) : (
                searchResults.map(product => (
                  <button
                    key={product.id}
                    className="product-result"
                    onClick={() => addToCart(product)}
                    disabled={product.current_quantity <= 0}
                  >
                    <div className="result-image-wrapper">
                      {product.image_data ? (
                        <img src={product.image_data} alt={product.name} className="result-image" />
                      ) : (
                        <div className="result-image-placeholder"><FiPackage size={32} /></div>
                      )}
                    </div>
                    <div className="result-info">
                      <div className="result-name">{product.name}</div>
                      <div className="result-price">${product.selling_price.toFixed(2)}</div>
                      <div className="result-qty">Stock: {product.current_quantity}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Cart & Payment */}
        <div className="sales-right">
          <div className="cart-section">
            <h2>Shopping Cart</h2>

            {cart.length === 0 ? (
              <div className="empty-cart">
                <p>No items in cart</p>
                <small>Search and add products to begin</small>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map(item => (
                    <div key={item.product_id} className="cart-item">
                      <div className="item-info">
                        <div className="item-name">{item.product_name}</div>
                        <div className="item-price">${item.selling_price.toFixed(2)} x {item.quantity}</div>
                      </div>
                      <div className="item-quantity">
                        <button
                          className="qty-btn"
                          onClick={() => updateCartQuantity(item.product_id, item.quantity - 1)}
                        >
                          −
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          className="qty-btn"
                          onClick={() => updateCartQuantity(item.product_id, item.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <div className="item-subtotal">${item.subtotal.toFixed(2)}</div>
                      <button
                        className="item-remove"
                        onClick={() => removeFromCart(item.product_id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <div className="cart-summary">
                  <div className="summary-row">
                    <span>Total:</span>
                    <span>${cartTotal.toFixed(2)}</span>
                  </div>
                </div>

                <div className="payment-section">
                  <button
                    className="charge-btn"
                    onClick={handleChargeClick}
                    disabled={cart.length === 0 || isProcessing}
                  >
                    💳 Charge Customer
                  </button>
                  <button
                    className="hold-btn"
                    onClick={handleHoldSale}
                    disabled={cart.length === 0 || isProcessing}
                    title="Pause this sale to complete later"
                  >
                    <FiPause size={20} /> Hold Sale
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Payment Method Modal */}
      {checkoutStep === 'paymentMethod' && (
        <div className="checkout-modal-overlay">
          <div className="checkout-modal">
            <div className="modal-header">
              <h2>Select Payment Method</h2>
              <p className="modal-total">Total: ${cartTotal.toFixed(2)}</p>
            </div>
            
            <div className="payment-methods-grid">
              <button
                className="payment-method-card"
                onClick={() => handlePaymentMethodSelect('USD Cash')}
              >
                <FiDollarSign size={32} />
                <span>USD Cash</span>
              </button>
              <button
                className="payment-method-card"
                onClick={() => handlePaymentMethodSelect('ZWG Cash')}
              >
                <FiDollarSign size={32} />
                <span>ZWG Cash</span>
              </button>
              <button
                className="payment-method-card"
                onClick={() => handlePaymentMethodSelect('USD Swipe')}
              >
                <FiCreditCard size={32} />
                <span>Card (USD)</span>
              </button>
              <button
                className="payment-method-card"
                onClick={() => handlePaymentMethodSelect('ZWG Swipe')}
              >
                <FiCreditCard size={32} />
                <span>Card (ZWG)</span>
              </button>
              <button
                className="payment-method-card"
                onClick={() => handlePaymentMethodSelect('USD EcoCash')}
              >
                <FiSmartphone size={32} />
                <span>EcoCash (USD)</span>
              </button>
              <button
                className="payment-method-card"
                onClick={() => handlePaymentMethodSelect('ZWG EcoCash')}
              >
                <FiSmartphone size={32} />
                <span>EcoCash (ZWG)</span>
              </button>
            </div>

            <button className="modal-back-btn" onClick={handleBackNavigation}>
              ← Back to Cart
            </button>
          </div>
        </div>
      )}

      {/* Cash Tendered Modal */}
      {checkoutStep === 'cashTendered' && selectedPaymentForCheckout && (
        <div className="checkout-modal-overlay">
          <div className="checkout-modal cash-modal">
            <div className="modal-header">
              <h2>Enter Amount Tendered</h2>
              <p className="modal-payment-method">{selectedPaymentForCheckout}</p>
            </div>

            <div className="cash-section">
              <div className="cash-row">
                <span className="cash-label">Total Amount:</span>
                <span className="cash-value">${cartTotal.toFixed(2)}</span>
              </div>

              <input
                type="number"
                placeholder="0.00"
                value={checkoutCashTendered}
                onChange={handleCashTenderedChange}
                className="cash-input-large"
                step="0.01"
                autoFocus
              />

              {checkoutCashTendered && (
                <div className="change-section">
                  <div className="change-row">
                    <span className="change-label">Change:</span>
                    <span className={`change-value ${parseFloat(checkoutCashTendered) < cartTotal ? 'insufficient' : ''}`}>
                      ${Math.max(0, parseFloat(checkoutCashTendered) - cartTotal).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="modal-actions">
              <button
                className="modal-back-btn"
                onClick={handleBackNavigation}
              >
                ← Back
              </button>
              <button
                className="modal-complete-btn"
                onClick={() => handleCompleteCheckout(selectedPaymentForCheckout, checkoutCashTendered)}
                disabled={!checkoutCashTendered || parseFloat(checkoutCashTendered) < cartTotal || isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Complete Sale'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmation && lastSale && (
        <div className="confirmation-modal">
          <div className="confirmation-content">
              <div className="confirmation-icon"><FiCheck size={48} color="#4CAF50" /></div>
            <h3>Sale Completed!</h3>
            <div className="confirmation-details">
              <p>Total: <strong>${lastSale.total.toFixed(2)}</strong></p>
              <p>Payment: <strong>{lastSale.payment_method}</strong></p>
              <p>Change: <strong>${lastSale.change.toFixed(2)}</strong></p>
            </div>
            <small>Auto-closing in 3 seconds...</small>
          </div>
        </div>
      )}

      {/* Held Sales Queue Modal */}
      {showHeldModal && (
        <div className="checkout-modal-overlay">
          <div className="checkout-modal held-sales-modal">
            <div className="modal-header">
              <h2>Held Sales Queue</h2>
              <p>{heldSales.length} sale(s) on hold</p>
            </div>

            <div className="held-sales-list">
              {heldSales.length === 0 ? (
                <div className="no-held-sales">No sales on hold</div>
              ) : (
                heldSales.map(sale => (
                  <div key={sale.id} className="held-sale-item">
                    <div className="held-sale-info">
                      <div className="held-sale-name">{sale.held_name}</div>
                      <div className="held-sale-date">
                        {new Date(sale.held_at).toLocaleString('en-ZA')}
                      </div>
                      <div className="held-sale-amount">
                        Total: ${sale.total.toFixed(2)}
                      </div>
                    </div>
                    <div className="held-sale-actions">
                      <button
                        className="recall-btn"
                        onClick={() => handleRecallSale(sale.id)}
                        title="Load this sale back into cart"
                      >
                        Recall
                      </button>
                      <button
                        className="discard-btn"
                        onClick={() => handleDiscardHeldSale(sale.id)}
                        title="Remove this held sale permanently"
                      >
                        <FiTrash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              className="modal-back-btn"
              onClick={() => setShowHeldModal(false)}
            >
              ← Close
            </button>
          </div>
        </div>
      )}

      {/* Void Sale Modal */}
      {showVoidModal && (
        <div className="checkout-modal-overlay">
          <div className="checkout-modal">
            <div className="modal-header">
              <h2>Void Sale</h2>
              <p>Enter reason for voiding this sale</p>
            </div>

            <div className="void-input-section">
              <textarea
                placeholder="e.g., Wrong price charged, Customer refund request, etc."
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="void-textarea"
                rows={3}
                autoFocus
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="modal-actions">
              <button
                className="modal-back-btn"
                onClick={() => {
                  setShowVoidModal(false)
                  setVoidSaleId(null)
                  setVoidReason('')
                  setError('')
                }}
              >
                ← Cancel
              </button>
              <button
                className="modal-void-btn"
                onClick={handleVoidSaleClick}
                disabled={!voidReason.trim() || isProcessing}
              >
                {isProcessing ? 'Processing...' : '⚠️ Void Sale'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Sales
