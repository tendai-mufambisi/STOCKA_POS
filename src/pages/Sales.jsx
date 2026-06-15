import { useState, useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import {
  getProducts, addSale, completeHeldSale, getAllLatestCostPrices, getMostSoldProducts,
  getHeldSales, holdSale, recallHeldSale, discardHeldSale, voidSale,
  getSaleItems, getShop, getLastReceiptNumber, updateSaleReceiptNumber
} from '../database/db'
import { hasPermission } from '../utils/permissions'
import { validateCurrency } from '../utils/validation'
import { generateReceiptNumber, getNextReceiptCounter } from '../utils/receiptUtils'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'
import { useAuthStore } from '../store/useAuthStore'
import { useShiftStore } from '../store/useShiftStore'
import './Sales.css'
import {
  FiSearch, FiPackage, FiShoppingCart, FiTrash2, FiPause,
  FiCheck, FiX, FiChevronLeft, FiAlertTriangle
} from 'react-icons/fi'

function Sales() {
  const { user }         = useAuthStore()
  const { currentShift } = useShiftStore()

  // ── Product & Cart state ─────────────────────────
  const [products, setProducts]           = useState([])
  const [mostSoldProducts, setMostSoldProducts] = useState([])
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [cart, setCart]                   = useState([])

  // ── Held sales state ─────────────────────────────
  const [heldSales, setHeldSales]         = useState([])
  const [showHeldPanel, setShowHeldPanel] = useState(false)
  const [recalledSaleId, setRecalledSaleId] = useState(null)

  // ── Checkout state ────────────────────────────────
  const [checkoutStep, setCheckoutStep]               = useState(null) // null | 'cashTendered'
  const [checkoutCashTendered, setCheckoutCashTendered] = useState('')
  const [isProcessing, setIsProcessing]               = useState(false)

  // ── UI state ──────────────────────────────────────
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [lastSale, setLastSale]                 = useState(null)
  const [message, setMessage]                   = useState({ text: '', type: '' }) // type: 'error' | 'info'
  const [showVoidModal, setShowVoidModal]       = useState(false)
  const [voidSaleId, setVoidSaleId]             = useState(null)
  const [isHoldingForNav, setIsHoldingForNav]   = useState(false)
  const [voidReason, setVoidReason]             = useState('')

  // ── Printer & shop state ──────────────────────────
  const [shopInfo, setShopInfo]           = useState(null)
  const [printerSettings, setPrinterSettings] = useState(null)
  const { printReceipt } = useReceiptPrinter()

  // Block navigation away when the cart has items
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      cart.length > 0 && !showConfirmation && currentLocation.pathname !== nextLocation.pathname
  )

  // ── Refs ──────────────────────────────────────────
  const searchRef   = useRef(null)
  const cashInputRef = useRef(null)

  // ── Load on mount ─────────────────────────────────
  useEffect(() => {
    loadProducts()
    loadHeldSales()
    loadShopInfo()
  }, [])

  // Auto-focus cash input when modal opens
  useEffect(() => {
    if (checkoutStep === 'cashTendered') {
      setTimeout(() => cashInputRef.current?.focus(), 80)
    }
  }, [checkoutStep])

  // Auto-close confirmation, then return focus to search
  useEffect(() => {
    if (showConfirmation) {
      const t = setTimeout(() => {
        setShowConfirmation(false)
        setTimeout(() => searchRef.current?.focus(), 50)
      }, 3200)
      return () => clearTimeout(t)
    }
  }, [showConfirmation])

  // ── Cart total (must be before keyboard useEffect so deps array evaluates correctly) ──
  const cartTotal = cart.reduce((s, i) => s + i.subtotal, 0)

  // ── Keyboard shortcuts ────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName

      // Escape: close whatever is open
      if (e.key === 'Escape') {
        e.preventDefault()
        if (checkoutStep) { setCheckoutStep(null); setCheckoutCashTendered('') }
        else if (showVoidModal) { setShowVoidModal(false); setVoidSaleId(null); setVoidReason('') }
        else if (showHeldPanel) setShowHeldPanel(false)
        return
      }

      // Enter in cash input: complete sale
      if (e.key === 'Enter' && checkoutStep === 'cashTendered' && tag === 'INPUT') {
        e.preventDefault()
        const amt = parseFloat(checkoutCashTendered)
        if (!isNaN(amt) && amt >= cartTotal && !isProcessing) {
          handleCompleteCheckout(checkoutCashTendered)
        }
        return
      }

      // F9 fires even when the cursor is in the search bar
      if (e.key === 'F9') {
        e.preventDefault()
        if (!checkoutStep && cart.length > 0 && !isProcessing) handleChargeClick()
        return
      }

      // Don't fire other shortcuts when typing in inputs
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      switch (e.key) {
        case 'F2':
          e.preventDefault()
          searchRef.current?.focus()
          break
        case 'F3':
          e.preventDefault()
          if (cart.length > 0 && !checkoutStep && !isProcessing) handleHoldSale()
          break
        case 'F4':
          e.preventDefault()
          if (heldSales.length > 0) setShowHeldPanel(p => !p)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [checkoutStep, showHeldPanel, showVoidModal, cart, cartTotal, checkoutCashTendered, isProcessing, heldSales.length])

  // ── Loaders ───────────────────────────────────────
  const loadProducts = async () => {
    try {
      setLoading(true)
      const [productsData, mostSold, costPrices] = await Promise.all([
        getProducts(),
        getMostSoldProducts(10),
        getAllLatestCostPrices()
      ])
      const enrich = p => ({ ...p, selling_price: p.selling_price || 0, cost_price: costPrices[p.id] || 0 })
      const enriched = productsData.map(enrich)
      enriched.sort((a, b) => (b.current_quantity || 0) - (a.current_quantity || 0))
      setProducts(enriched)
      setMostSoldProducts(mostSold.map(enrich))
    } catch { flash('Failed to load products', 'error') }
    finally { setLoading(false) }
  }

  const loadHeldSales = async () => {
    try { setHeldSales(await getHeldSales()) } catch { /* silent */ }
  }

  const loadShopInfo = async () => {
    try {
      const shop = await getShop()
      if (!shop) {
        setShopInfo(null)
        setPrinterSettings({ printer_name: '', printer_port: '', auto_print: 0, print_duplicate: 0 })
        return
      }
      setShopInfo(shop)
      setPrinterSettings({
        printer_name: shop.printer_name || '',
        printer_port: shop.printer_port || '',
        auto_print: shop.auto_print ?? 1,
        print_duplicate: shop.print_duplicate ?? 0,
      })
    } catch { /* silent */ }
  }

  // ── Flash message ──────────────────────────────────
  const flash = (text, type = 'error', duration = 4000) => {
    setMessage({ text, type })
    setTimeout(() => setMessage({ text: '', type: '' }), duration)
  }

  // ── Cart helpers ───────────────────────────────────

  const addToCart = (product) => {
    if (product.current_quantity <= 0) { flash(`"${product.name}" is out of stock`); return }
    if (!product.selling_price || product.selling_price <= 0) {
      flash(`"${product.name}" has no price — update it in Products first`); return
    }
    const existing = cart.find(i => i.product_id === product.id)
    if (existing) {
      const newQty = existing.quantity + 1
      if (newQty > product.current_quantity) {
        flash(`Only ${product.current_quantity} units of "${product.name}" available`); return
      }
      setCart(cart.map(i => i.product_id === product.id
        ? { ...i, quantity: newQty, subtotal: newQty * i.selling_price }
        : i
      ))
    } else {
      setCart([...cart, {
        product_id: product.id, product_name: product.name,
        selling_price: product.selling_price, cost_price: product.cost_price,
        quantity: 1, subtotal: product.selling_price
      }])
    }
    // Select-all so the cashier can immediately type the next product without clearing the view
    setTimeout(() => {
      if (searchRef.current) {
        searchRef.current.focus()
        searchRef.current.select()
      }
    }, 0)
  }

  const updateQty = (productId, qty) => {
    const product = products.find(p => p.id === productId)
    if (!product) return
    if (qty > product.current_quantity) {
      flash(`Only ${product.current_quantity} units available`); return
    }
    setCart(cart.map(i => i.product_id === productId
      ? { ...i, quantity: qty, subtotal: qty > 0 ? qty * i.selling_price : 0 }
      : i
    ))
  }

  const removeFromCart = (productId) => setCart(cart.filter(i => i.product_id !== productId))

  const clearCart = () => {
    setCart([])
    setRecalledSaleId(null)
    setSearch('')
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  // ── Checkout ───────────────────────────────────────
  const handleChargeClick = () => {
    if (cart.length === 0) { flash('Cart is empty'); return }
    if (cart.some(i => !i.quantity || i.quantity <= 0)) {
      flash('All items must have a valid quantity'); return
    }
    setCheckoutStep('cashTendered')
    setCheckoutCashTendered('')
    setMessage({ text: '', type: '' })
  }

  const handleBackNavigation = () => {
    setCheckoutStep(null)
    setCheckoutCashTendered('')
  }

  const handleCompleteCheckout = async (cashAmount) => {
    const validation = validateCurrency(cashAmount, 'Cash amount')
    if (!validation.valid) { flash(validation.error); return }
    const cash = parseFloat(cashAmount)
    if (cash < cartTotal) { flash('Insufficient cash tendered'); return }

    setIsProcessing(true)
    try {
      const change = Math.max(0, cash - cartTotal)
      let saleId
      const saleBase = {
        cashier: user.username,
        total: cartTotal,
        cash_tendered: cash,
        change_given: change,
        shift_id: currentShift?.id || null
      }

      if (recalledSaleId) {
        saleId = await completeHeldSale(recalledSaleId, cash, change, currentShift?.id || null)
        setRecalledSaleId(null)
      } else {
        saleId = await addSale(saleBase, cart)
      }

      // Receipt number + print
      try {
        const lastReceipt = await getLastReceiptNumber()
        const receiptNumber = generateReceiptNumber(getNextReceiptCounter(lastReceipt))
        await updateSaleReceiptNumber(saleId, receiptNumber)

        const receiptData = { ...saleBase, id: saleId, receipt_number: receiptNumber, items: cart, created_at: new Date().toISOString() }

        if (printerSettings?.auto_print && shopInfo) {
          await printReceipt(receiptData, shopInfo, {
            isDuplicate: false,
            printerName: printerSettings.printer_name || '',
            portPath: printerSettings.printer_port || ''
          }).catch(() => {})

          if (printerSettings.print_duplicate === 1) {
            await printReceipt(receiptData, shopInfo, {
              isDuplicate: true,
              printerName: printerSettings.printer_name || '',
              portPath: printerSettings.printer_port || ''
            }).catch(() => {})
          }
        }
      } catch { /* Don't block sale for print errors */ }

      setLastSale({ id: saleId, total: cartTotal, change, timestamp: new Date() })
      setShowConfirmation(true)
      setCheckoutStep(null)
      setCheckoutCashTendered('')
      setCart([])
      setSearch('')
      loadProducts()
      loadHeldSales()
    } catch { flash('Failed to complete sale') }
    finally { setIsProcessing(false) }
  }

  // ── Hold / Recall ──────────────────────────────────
  const handleHoldSale = async () => {
    if (cart.length === 0) { flash('Nothing in cart to hold'); return }
    setIsProcessing(true)
    try {
      const total = cartTotal
      if (recalledSaleId) {
        await holdSale(recalledSaleId, `Hold-${recalledSaleId}`)
        setRecalledSaleId(null)
      } else {
        const saleId = await addSale({ cashier: user.username, total, cash_tendered: 0, change_given: 0, shift_id: currentShift?.id || null }, cart)
        await holdSale(saleId, `Hold-${saleId}`)
        await loadProducts()
      }
      setCart([])
      setSearch('')
      await loadHeldSales()
      flash(`Sale held — $${total.toFixed(2)}`, 'info', 3000)
    } catch { flash('Failed to hold sale') }
    finally { setIsProcessing(false) }
  }

  const handleRecallSale = async (heldSaleId) => {
    try {
      if (cart.length > 0) {
        if (recalledSaleId) {
          await holdSale(recalledSaleId, `Hold-${recalledSaleId}`)
        } else {
          const total = cartTotal
          const saleId = await addSale({ cashier: user.username, total, cash_tendered: 0, change_given: 0, shift_id: currentShift?.id || null }, cart)
          await holdSale(saleId, `Hold-${saleId}`)
          await loadProducts()
        }
      }
      const items = await getSaleItems(heldSaleId)
      setCart(items.map(i => ({ product_id: i.product_id, product_name: i.product_name, selling_price: i.selling_price, cost_price: i.cost_price, quantity: i.quantity, subtotal: i.subtotal })))
      setRecalledSaleId(heldSaleId)
      await recallHeldSale(heldSaleId)
      await loadHeldSales()
      setShowHeldPanel(false)
      flash(`Hold #${heldSaleId} recalled`, 'info', 2500)
    } catch { flash('Failed to recall sale') }
  }

  const handleDiscardHeld = async (heldSaleId) => {
    if (!window.confirm('Discard this held sale permanently?')) return
    try {
      await discardHeldSale(heldSaleId)
      await loadHeldSales()
      flash('Held sale discarded', 'info', 2500)
    } catch { flash('Failed to discard') }
  }

  // ── Void ──────────────────────────────────────────
  const handleVoidConfirm = async () => {
    if (!voidReason.trim() || voidReason.length < 3) { flash('Enter a reason (at least 3 characters)'); return }
    setIsProcessing(true)
    try {
      await voidSale(voidSaleId, voidReason, user.username)
      setShowVoidModal(false); setVoidSaleId(null); setVoidReason('')
      flash('Sale voided', 'info', 2500)
      loadProducts()
    } catch (err) { flash(err.message || 'Failed to void sale') }
    finally { setIsProcessing(false) }
  }

  // ── Search / display lists ────────────────────────
  const displayProducts = search.trim()
    ? products.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 25)
    : searchFocused ? products.slice(0, 30) : []

  const showProducts = searchFocused || search.trim()

  // ── Quick amounts for payment modal ───────────────
  const quickAmounts = (() => {
    const fixed = [5, 10, 20, 50, 100]
    const valid = fixed.filter(a => a >= cartTotal)
    return [
      { label: 'Exact', value: cartTotal.toFixed(2), isExact: true },
      ...valid.slice(0, 4).map(a => ({ label: `$${a}`, value: String(a) }))
    ]
  })()

  // ── Change calculation ────────────────────────────
  const tenderedNum  = parseFloat(checkoutCashTendered) || 0
  const changeAmount = Math.max(0, tenderedNum - cartTotal)
  const isInsufficient = checkoutCashTendered && tenderedNum < cartTotal

  if (loading) {
    return (
      <div className="pos-loading">
        <div className="pos-spinner" />
        <span>Loading inventory…</span>
      </div>
    )
  }

  return (
    <div className="pos-page">

      {/* ── Keyboard shortcut bar ── */}
      <div className="pos-shortcuts">
        <div className="pos-shortcut">
          <span className="pos-key">F2</span>
          <span>Search</span>
        </div>
        <div className="pos-shortcut">
          <span className="pos-key">F3</span>
          <span>Hold</span>
        </div>
        <div className="pos-shortcut">
          <span className="pos-key">F4</span>
          <span>Recall {heldSales.length > 0 ? `(${heldSales.length})` : ''}</span>
        </div>
        <div className="pos-shortcut">
          <span className="pos-key">F9</span>
          <span>Pay</span>
        </div>
        <div className="pos-shortcut">
          <span className="pos-key">Esc</span>
          <span>Cancel</span>
        </div>
        {recalledSaleId && (
          <div className="pos-shortcut pos-shortcut--recalled">
            <span className="recalled-badge">RECALLED #{recalledSaleId}</span>
          </div>
        )}
        <div className="pos-shift-indicator">
          {currentShift && <><div className="pos-shift-dot" /><span>Shift active</span></>}
        </div>
      </div>

      {/* ── Two-panel body ── */}
      <div className="pos-body">

        {/* ════ LEFT — Products ════ */}
        <div className="pos-left">

          {/* Search bar */}
          <div className="pos-search-wrap">
            <FiSearch size={18} className="pos-search-icon" />
            <input
              ref={searchRef}
              className="pos-search-input"
              type="text"
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const eligible = displayProducts.filter(p => p.current_quantity > 0)
                  if (eligible.length === 1) {
                    e.preventDefault()
                    addToCart(eligible[0])
                  }
                }
              }}
              autoFocus
            />
            <span className="pos-search-badge">F2</span>
          </div>

          {/* Error / info strip */}
          {message.text && (
            <div className={`pos-message ${message.type}`}>
              {message.type === 'error' ? <FiAlertTriangle size={14} /> : <FiCheck size={14} />}
              {message.text}
            </div>
          )}

          {/* Section label */}
          <div className="pos-section-label">
            {search.trim() ? `Results for "${search}"` : showProducts ? 'All Products' : 'Top Selling'}
          </div>

          {/* Product list */}
          <div className="pos-products">
            {showProducts ? (
              displayProducts.length === 0 ? (
                <div className="pos-empty">
                  <FiPackage size={32} />
                  <p>No products found</p>
                  <small>Try a different search</small>
                </div>
              ) : (
                displayProducts.map(product => {
                  const stockClass = product.current_quantity === 0 ? 'out' : product.current_quantity <= (product.reorder_level || 5) ? 'low' : ''
                  return (
                    <button
                      key={product.id}
                      className="pos-product"
                      onClick={() => addToCart(product)}
                      disabled={product.current_quantity <= 0}
                    >
                      <div className="pos-product-thumb">
                        {product.image_data
                          ? <img src={product.image_data} alt={product.name} />
                          : <FiPackage size={22} />}
                      </div>
                      <div className="pos-product-info">
                        <div className="pos-product-name">{product.name}</div>
                        <div className="pos-product-meta">
                          <span className="pos-product-price">${product.selling_price.toFixed(2)}</span>
                          <span className={`pos-product-stock ${stockClass}`}>
                            {product.current_quantity === 0 ? 'Out of stock' : `${product.current_quantity} in stock`}
                          </span>
                        </div>
                      </div>
                      <div className="pos-product-add" aria-hidden="true">+</div>
                    </button>
                  )
                })
              )
            ) : (
              mostSoldProducts.length > 0 ? mostSoldProducts.map(product => {
                const stockClass = product.current_quantity === 0 ? 'out' : product.current_quantity <= (product.reorder_level || 5) ? 'low' : ''
                return (
                  <button
                    key={product.id}
                    className="pos-product"
                    onClick={() => addToCart(product)}
                    disabled={product.current_quantity <= 0}
                  >
                    <div className="pos-product-thumb">
                      {product.image_data
                        ? <img src={product.image_data} alt={product.name} />
                        : <FiPackage size={22} />}
                    </div>
                    <div className="pos-product-info">
                      <div className="pos-product-name">{product.name}</div>
                      <div className="pos-product-meta">
                        <span className="pos-product-price">${product.selling_price.toFixed(2)}</span>
                        <span className={`pos-product-stock ${stockClass}`}>
                          {product.current_quantity === 0 ? 'Out of stock' : `${product.current_quantity} in stock`}
                        </span>
                      </div>
                    </div>
                    <div className="pos-product-add" aria-hidden="true">+</div>
                  </button>
                )
              }) : (
                <div className="pos-empty">
                  <FiPackage size={32} />
                  <p>No products yet</p>
                  <small>Add products in the Products module</small>
                </div>
              )
            )}
          </div>
        </div>

        {/* ════ RIGHT — Cart ════ */}
        <div className="pos-right">

          {/* Cart header */}
          <div className="cart-header">
            <div className="cart-header-left">
              <FiShoppingCart size={16} />
              <span className="cart-title">Current Sale</span>
              {cart.length > 0 && <span className="cart-count">{cart.length}</span>}
            </div>
            {cart.length > 0 && (
              <button className="cart-clear-btn" onClick={clearCart}>
                <FiX size={11} /> Clear
              </button>
            )}
          </div>

          {/* Cart body */}
          {cart.length === 0 ? (
            <div className="cart-empty">
              <div className="cart-empty-icon"><FiShoppingCart size={28} /></div>
              <p>Cart is empty</p>
              <small>Search or select a product to begin</small>
            </div>
          ) : (
            <>
              <div className="cart-items">
                {cart.map(item => {
                  const product = products.find(p => p.id === item.product_id)
                  const maxQty  = product?.current_quantity || 0
                  return (
                    <div key={item.product_id} className="cart-item">
                      <div className="cart-item-info">
                        <div className="cart-item-name">{item.product_name}</div>
                        <div className="cart-item-unit">${item.selling_price.toFixed(2)} each</div>
                      </div>

                      <div className="cart-qty">
                        <button
                          className="cart-qty-btn"
                          onClick={() => item.quantity > 1 ? updateQty(item.product_id, item.quantity - 1) : removeFromCart(item.product_id)}
                          title={item.quantity <= 1 ? 'Remove item' : 'Decrease'}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          className="cart-qty-input"
                          value={item.quantity || ''}
                          onChange={e => {
                            const v = e.target.value
                            if (v === '') updateQty(item.product_id, 0)
                            else {
                              const n = parseInt(v, 10)
                              if (!isNaN(n) && n > 0) updateQty(item.product_id, n)
                            }
                          }}
                          onClick={e => e.target.select()}
                        />
                        <button
                          className="cart-qty-btn"
                          onClick={() => updateQty(item.product_id, item.quantity + 1)}
                          disabled={item.quantity >= maxQty}
                          title={`Max: ${maxQty}`}
                        >
                          +
                        </button>
                      </div>

                      <div className="cart-item-right">
                        <span className="cart-item-subtotal">${item.subtotal.toFixed(2)}</span>
                        <button className="cart-item-remove" onClick={() => removeFromCart(item.product_id)} title="Remove">
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Totals */}
              <div className="cart-totals">
                <div className="cart-total-row">
                  <span>{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
                  <span>${cartTotal.toFixed(2)}</span>
                </div>
                <div className="cart-grand-total">
                  <span className="cart-grand-label">Total Due</span>
                  <span className="cart-grand-value">${cartTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="cart-actions">
                <button
                  className="pos-hold-btn"
                  onClick={handleHoldSale}
                  disabled={isProcessing}
                  title="Hold this sale [F3]"
                >
                  <FiPause size={15} />
                  <span>Hold</span>
                  <span className="pos-charge-shortcut pos-charge-shortcut--hold">F3</span>
                </button>
                <button
                  className="pos-charge-btn"
                  onClick={handleChargeClick}
                  disabled={isProcessing}
                  title="Proceed to payment [F9]"
                >
                  Charge ${cartTotal.toFixed(2)}
                  <span className="pos-charge-shortcut">F9</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Held sales drawer toggle ── */}
      {heldSales.length > 0 && (
        <button
          className="held-drawer-toggle"
          onClick={() => setShowHeldPanel(p => !p)}
          title={`${heldSales.length} held sale${heldSales.length !== 1 ? 's' : ''} [F4]`}
        >
          <div className="held-toggle-badge">{heldSales.length}</div>
          <div className="held-toggle-label">HELD</div>
        </button>
      )}

      {/* ── Held sales drawer ── */}
      <div className={`held-drawer ${showHeldPanel ? 'open' : ''}`}>
        <div className="held-drawer-header">
          <span className="held-drawer-title">Held Sales ({heldSales.length})</span>
          <button className="held-drawer-close" onClick={() => setShowHeldPanel(false)}>
            <FiX size={16} />
          </button>
        </div>
        <div className="held-drawer-body">
          {heldSales.map(sale => (
            <div key={sale.id} className="held-item">
              <div className="held-item-top">
                <span className="held-item-id">Hold-{sale.id}</span>
                <span className="held-item-total">${sale.total?.toFixed(2) || '0.00'}</span>
              </div>
              <div className="held-item-meta">
                {sale.items?.length || 0} item{(sale.items?.length || 0) !== 1 ? 's' : ''} · {new Date(sale.held_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="held-item-actions">
                <button className="held-recall-btn" onClick={() => handleRecallSale(sale.id)}>
                  <FiCheck size={13} /> Recall
                </button>
                <button className="held-discard-btn" onClick={() => handleDiscardHeld(sale.id)}>
                  <FiTrash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Payment modal ── */}
      {checkoutStep === 'cashTendered' && (
        <div className="pay-overlay" onClick={e => { if (e.target === e.currentTarget) handleBackNavigation() }}>
          <div className="pay-modal">
            {/* Green header with total */}
            <div className="pay-modal-top">
              <div className="pay-modal-label">Amount Due</div>
              <div className="pay-modal-total">${cartTotal.toFixed(2)}</div>
            </div>

            <div className="pay-modal-body">
              {/* Quick amount buttons */}
              <div className="pay-quick-label">Quick Cash</div>
              <div className="pay-quick-row">
                {quickAmounts.map(({ label, value, isExact }) => (
                  <button
                    key={label}
                    className={`pay-quick-btn ${isExact ? 'exact' : ''}`}
                    onClick={() => setCheckoutCashTendered(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Cash input */}
              <div className="pay-input-label">Cash Tendered</div>
              <div className="pay-input-wrap">
                <span className="pay-input-symbol">$</span>
                <input
                  ref={cashInputRef}
                  type="number"
                  className="pay-cash-input"
                  placeholder="0.00"
                  value={checkoutCashTendered}
                  onChange={e => setCheckoutCashTendered(e.target.value)}
                  onClick={e => e.target.select()}
                  step="any"
                  min="0"
                />
              </div>

              {/* Change display */}
              {checkoutCashTendered && (
                <div className={`pay-change ${isInsufficient ? 'insufficient' : ''}`}>
                  <span className="pay-change-label">{isInsufficient ? 'Short by' : 'Change'}</span>
                  <span className="pay-change-value">
                    {isInsufficient
                      ? `$${(cartTotal - tenderedNum).toFixed(2)}`
                      : `$${changeAmount.toFixed(2)}`}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="pay-actions">
                <button className="pay-cancel-btn" onClick={handleBackNavigation}>
                  <FiChevronLeft size={15} /> Back
                </button>
                <button
                  className="pay-complete-btn"
                  onClick={() => handleCompleteCheckout(checkoutCashTendered)}
                  disabled={!checkoutCashTendered || isInsufficient || isProcessing}
                >
                  {isProcessing ? 'Processing…' : 'Complete Sale'}
                  {!isProcessing && <span className="pay-enter-hint">↵</span>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Sale success flash ── */}
      {showConfirmation && lastSale && (
        <div className="sale-success-overlay">
          <div className="sale-success-card">
            <div className="sale-success-icon">
              <FiCheck size={32} color="white" strokeWidth={3} />
            </div>
            <div className="sale-success-title">Sale Complete!</div>
            <div className="sale-success-amounts">
              <div className="sale-success-amount">
                <div className="sale-success-amount-label">Total</div>
                <div className="sale-success-amount-value">${lastSale.total.toFixed(2)}</div>
              </div>
              <div className="sale-success-amount">
                <div className="sale-success-amount-label">Change</div>
                <div className="sale-success-amount-value change">${lastSale.change.toFixed(2)}</div>
              </div>
            </div>
            <div className="sale-success-sub">Closing in 3 seconds…</div>
          </div>
        </div>
      )}

      {/* ── Void modal ── */}
      {showVoidModal && (
        <div className="void-overlay">
          <div className="void-modal">
            <div className="void-modal-header">
              <div className="void-modal-header-icon"><FiAlertTriangle size={17} /></div>
              <div>
                <div className="void-modal-title">Void Sale</div>
                <div className="void-modal-sub">This action cannot be undone</div>
              </div>
            </div>
            <div className="void-modal-body">
              <textarea
                className="void-reason"
                placeholder="Reason for voiding (e.g. Wrong price, Customer refund…)"
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                rows={3}
                autoFocus
              />
              <div className="void-actions">
                <button className="void-cancel-btn" onClick={() => { setShowVoidModal(false); setVoidSaleId(null); setVoidReason('') }}>
                  Cancel
                </button>
                <button
                  className="void-confirm-btn"
                  onClick={handleVoidConfirm}
                  disabled={!voidReason.trim() || isProcessing}
                >
                  {isProcessing ? 'Processing…' : 'Void Sale'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Navigation guard ── */}
      {blocker.state === 'blocked' && (
        <div className="nav-block-overlay">
          <div className="nav-block-modal">
            <div className="nav-block-icon"><FiShoppingCart size={30} /></div>
            <h3 className="nav-block-title">Active sale in progress</h3>
            <p className="nav-block-sub">
              You have {cart.length} item{cart.length !== 1 ? 's' : ''} worth <strong>${cartTotal.toFixed(2)}</strong> in the cart.
              What would you like to do?
            </p>
            <div className="nav-block-actions">
              <button
                className="nav-block-btn-hold"
                disabled={isHoldingForNav}
                onClick={async () => {
                  setIsHoldingForNav(true)
                  try { await handleHoldSale() } catch { /* flash shown inside */ }
                  setIsHoldingForNav(false)
                  blocker.proceed()
                }}
              >
                <FiPause size={15} />
                {isHoldingForNav ? 'Holding…' : 'Hold Sale & Leave'}
              </button>
              <button
                className="nav-block-btn-discard"
                disabled={isHoldingForNav}
                onClick={() => { clearCart(); blocker.proceed() }}
              >
                <FiTrash2 size={15} /> Discard & Leave
              </button>
              <button
                className="nav-block-btn-stay"
                disabled={isHoldingForNav}
                onClick={() => blocker.reset()}
              >
                Stay on Sales
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default Sales
