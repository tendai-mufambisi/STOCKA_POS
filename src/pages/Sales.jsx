import { useState, useEffect, useRef } from 'react'
import { useLanSync } from '../hooks/useLanSync'
import ConfirmModal from '../components/ConfirmModal'
import {
  getProducts, addSale, completeHeldSale, getAllLatestCostPrices, getMostSoldProducts,
  getHeldSales, holdSale, recallHeldSale, discardHeldSale, voidSale,
  getSaleItems, getShop, updateSaleReceiptNumber,
  getShiftsByCashier
} from '../database/db'
import { updateProduct } from '../database/domains/products'
import { logAuditAction } from '../database/domains/audit'
import { createNotification } from '../database/domains/notifications'
import { hasPermission } from '../utils/permissions'
import { validateCurrency } from '../utils/validation'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'
import { useAuthStore } from '../store/useAuthStore'
import { useShiftStore } from '../store/useShiftStore'
import { useSaleStore } from '../store/useSaleStore'
import './Sales.css'
import {
  FiSearch, FiPackage, FiShoppingCart, FiTrash2, FiPause,
  FiCheck, FiX, FiChevronLeft, FiAlertTriangle, FiTag,
  FiBriefcase, FiCreditCard, FiSmartphone, FiPlay, FiClock, FiLock
} from 'react-icons/fi'

function FlyParticle({ startX, startY, endX, endY, onDone }) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const raf   = requestAnimationFrame(() => setActive(true))
    const timer = setTimeout(onDone, 650)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [])
  const dx = endX - startX
  const dy = endY - startY
  return (
    <div style={{
      position: 'fixed',
      left: startX, top: startY,
      width: 22, height: 22,
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #2e7d32, #66bb6a)',
      boxShadow: '0 2px 10px rgba(46,125,50,0.55)',
      pointerEvents: 'none',
      zIndex: 9999,
      transform: active
        ? `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.12)`
        : 'translate(-50%, -50%) scale(1)',
      opacity: active ? 0 : 0.92,
      transition: active
        ? 'transform 0.52s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-in 0.12s'
        : 'none',
    }} />
  )
}

function Sales({ onRequestStartShift, onRequestCloseShift }) {
  const { user }         = useAuthStore()
  const { currentShift } = useShiftStore()
  const { setSaleInProgress, pendingForceClose } = useSaleStore()

  // ── Product & Cart state ─────────────────────────
  const [products, setProducts]           = useState([])
  const [mostSoldProducts, setMostSoldProducts] = useState([])
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState('')
  const [cart, setCart]                   = useState([])

  // ── Held sales state ─────────────────────────────
  const [heldSales, setHeldSales]         = useState([])
  const [showHeldPanel, setShowHeldPanel] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(null) // heldSaleId
  const [recalledSaleId, setRecalledSaleId] = useState(null)

  // ── Checkout state ────────────────────────────────
  const [checkoutStep, setCheckoutStep]               = useState(null) // null | 'paymentSelect' | 'cashTendered' | 'splitTendered'
  const [paymentMethod, setPaymentMethod]             = useState('Cash')
  const [checkoutCashTendered, setCheckoutCashTendered] = useState('')
  const [splitCashAmt, setSplitCashAmt]               = useState('')
  const [isProcessing, setIsProcessing]               = useState(false)

  // ── UI state ──────────────────────────────────────
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [lastSale, setLastSale]                 = useState(null)
  const [message, setMessage]                   = useState({ text: '', type: '' }) // type: 'error' | 'info'
  const [showVoidModal, setShowVoidModal]       = useState(false)
  const [voidSaleId, setVoidSaleId]             = useState(null)
  const [isHoldingForNav, setIsHoldingForNav]   = useState(false)
  const [voidReason, setVoidReason]             = useState('')

  // ── No-price modal state ──────────────────────────
  const [priceRequiredProduct, setPriceRequiredProduct] = useState(null)
  const [priceInput, setPriceInput]             = useState('')
  const [isSavingPrice, setIsSavingPrice]       = useState(false)

  // ── Printer & shop state ──────────────────────────
  const [shopInfo, setShopInfo]           = useState(null)
  const [printerSettings, setPrinterSettings] = useState(null)
  const { printReceipt } = useReceiptPrinter()

  // ── Selling gates ─────────────────────────────────
  // Admins can only sell when the shop-level toggle allows it (Settings → Business Rules)
  const adminBlocked = user?.role === 'Admin' && !shopInfo?.allow_admin_sales
  const shiftReady   = !!currentShift
  const canSell      = shiftReady && !adminBlocked

  // Recent shifts shown in the "shift not started" panel
  const [recentShifts, setRecentShifts] = useState([])
  useEffect(() => {
    if (shiftReady || !user?.username) return
    getShiftsByCashier(user.username)
      .then(list => setRecentShifts((list || []).slice(0, 5)))
      .catch(() => setRecentShifts([]))
  }, [shiftReady, user?.username])

  // Navigation guard state (useBlocker requires a data router; not compatible
  // with HashRouter, so we manage the blocked modal manually via setNavBlocked)
  const [navBlocked, setNavBlocked] = useState(false)
  const blocker = {
    state: navBlocked ? 'blocked' : 'idle',
    proceed: () => setNavBlocked(false),
    reset:   () => setNavBlocked(false),
  }

  // ── Keyboard nav & fly animation state ───────────
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [flyingItems, setFlyingItems] = useState([])

  // ── Refs ──────────────────────────────────────────
  const searchRef        = useRef(null)
  const cashInputRef     = useRef(null)
  const cartIconRef      = useRef(null)
  const productListRef   = useRef(null)
  // Tracks the stable display order so reloads never reorder the list mid-sale.
  // Set once on first load; subsequent loads sort to match it instead of re-sorting.
  const productOrderRef  = useRef([])
  // Timestamp of the last Space keydown — powers the double-tap-Space checkout gesture
  const lastSpaceRef     = useRef(0)

  // ── Till identity (local-only; scopes this till's receipt numbers) ──
  const [tillCode, setTillCode] = useState(null)
  useEffect(() => {
    window.stocka?.till?.getIdentity()
      .then(id => setTillCode(id?.code || null))
      .catch(() => setTillCode(null))
  }, [])

  // ── Load on mount ─────────────────────────────────
  useEffect(() => {
    loadProducts()
    loadHeldSales()
    loadShopInfo()
  }, [])

  // Reload product prices whenever data syncs (satellite: lan:synced; main: lan:data-changed)
  useLanSync(() => loadProducts())

  // Auto-focus cash input when modal opens
  useEffect(() => {
    if (checkoutStep === 'cashTendered') {
      setTimeout(() => cashInputRef.current?.focus(), 80)
    }
  }, [checkoutStep, paymentMethod])

  // Close the success flash and get the cashier straight back into the search box
  const dismissConfirmation = () => {
    setShowConfirmation(false)
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  // Auto-close confirmation, then return focus to search.
  // Cash-with-change stays up longer so the cashier can count change;
  // exact/transfer sales clear fast. Tap or any key dismisses instantly.
  useEffect(() => {
    if (showConfirmation) {
      const hasChange = (lastSale?.change || 0) > 0
      const t = setTimeout(dismissConfirmation, hasChange ? 3000 : 1600)
      return () => clearTimeout(t)
    }
  }, [showConfirmation])

  // Keep the global sale-in-progress flag in sync so shift-guard can check it
  useEffect(() => {
    setSaleInProgress(cart.length > 0 || checkoutStep !== null)
  }, [cart.length, checkoutStep, setSaleInProgress])

  // Scroll the keyboard-selected product into view whenever it changes
  useEffect(() => {
    if (selectedIdx !== null && productListRef.current) {
      const items = productListRef.current.querySelectorAll('.pos-product')
      items[selectedIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIdx])

  // ── Cart total (must be before keyboard useEffect so deps array evaluates correctly) ──
  const cartTotal = cart.reduce((s, i) => s + i.subtotal, 0)

  // ── Keyboard shortcuts ────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName

      // Any key dismisses the sale-complete flash so the next sale starts immediately
      if (showConfirmation) {
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') e.preventDefault()
        dismissConfirmation()
        return
      }

      // Escape: close whatever is open
      if (e.key === 'Escape') {
        e.preventDefault()
        if (checkoutStep === 'cashTendered') { setCheckoutStep('paymentSelect'); setCheckoutCashTendered('') }
        else if (checkoutStep === 'splitTendered') { setCheckoutStep('paymentSelect'); setSplitCashAmt('') }
        else if (checkoutStep === 'paymentSelect') { setCheckoutStep(null) }
        else if (showVoidModal) { setShowVoidModal(false); setVoidSaleId(null); setVoidReason('') }
        else if (showHeldPanel) setShowHeldPanel(false)
        return
      }

      // Payment-method screen is fully keyboard-driven:
      // Enter = exact cash, C = cash (count change), T = transfer, S = split
      if (checkoutStep === 'paymentSelect' && !isProcessing) {
        if (e.key === 'Enter') { e.preventDefault(); handleExactCash(); return }
        const k = e.key.toLowerCase()
        if (k === 'c') { e.preventDefault(); handleSelectPaymentMethod('Cash'); return }
        if (k === 't') { e.preventDefault(); handleSelectPaymentMethod('Transfer'); return }
        if (k === 's') { e.preventDefault(); handleSelectPaymentMethod('Split'); return }
      }

      // Enter in cash input: complete sale
      if (e.key === 'Enter' && checkoutStep === 'cashTendered' && tag === 'INPUT') {
        e.preventDefault()
        const amt = parseFloat(checkoutCashTendered)
        if (!isNaN(amt) && amt >= cartTotal && !isProcessing) handleCompleteCheckout()
        return
      }
      if (e.key === 'Enter' && checkoutStep === 'splitTendered' && tag === 'INPUT') {
        e.preventDefault()
        const cash = parseFloat(splitCashAmt) || 0
        if (cash > 0 && cash < cartTotal && !isProcessing) handleCompleteSplitCheckout()
        return
      }

      // F9 fires even when the cursor is in the search bar
      if (e.key === 'F9') {
        e.preventDefault()
        if (!checkoutStep && cart.length > 0 && !isProcessing) handleChargeClick()
        return
      }

      // Double-tap Space: open checkout, even mid-typing in the search box.
      // Two spaces within 350ms is a deliberate gesture — typing a product
      // name with spaces ("coca cola") never produces that. Excluded in
      // textareas (void reason) where double spaces are legitimate text.
      if (e.key === ' ' && !e.repeat && tag !== 'TEXTAREA' && !checkoutStep && !showVoidModal) {
        const now = Date.now()
        const isDoubleTap = now - lastSpaceRef.current < 350
        lastSpaceRef.current = now
        if (isDoubleTap && cart.length > 0 && !isProcessing) {
          e.preventDefault()
          lastSpaceRef.current = 0
          // Drop the space the first tap typed into the search box
          setSearch(s => s.replace(/\s+$/, ''))
          handleChargeClick()
          return
        }
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
  }, [checkoutStep, showHeldPanel, showVoidModal, cart, cartTotal, checkoutCashTendered, splitCashAmt, isProcessing, heldSales.length, showConfirmation])

  // ── Loaders ───────────────────────────────────────
  const loadProducts = async () => {
    try {
      // loading starts true; we only call setLoading(true) again after explicit reset.
      // Subsequent background reloads (after a sale, hold, void) are silent — no spinner.
      const isFirstLoad = productOrderRef.current.length === 0

      const [productsData, mostSold, costPrices] = await Promise.all([
        getProducts(),
        getMostSoldProducts(10),
        getAllLatestCostPrices()
      ])
      const enrich = p => ({ ...p, selling_price: p.selling_price || 0, cost_price: costPrices[p.id] || 0 })
      const enriched = productsData.map(enrich)

      if (isFirstLoad) {
        // First load: sort by stock level so high-stock items appear first
        enriched.sort((a, b) => (b.current_quantity || 0) - (a.current_quantity || 0))
        setMostSoldProducts(mostSold.map(enrich))
      } else {
        // Reload after sale/hold/void: preserve the existing display order so the list
        // does not jump while the cashier is mid-session
        const orderMap = new Map(productOrderRef.current.map((p, i) => [p.id, i]))
        enriched.sort((a, b) => (orderMap.get(a.id) ?? enriched.length) - (orderMap.get(b.id) ?? enriched.length))
        // Update mostSoldProducts quantities (for stock checks) without changing order
        const dataMap = new Map(enriched.map(p => [p.id, p]))
        setMostSoldProducts(prev => prev.map(p => ({ ...p, ...(dataMap.get(p.id) || {}) })))
      }

      productOrderRef.current = enriched
      setProducts(enriched)
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

  const triggerFly = (srcRect) => {
    if (!cartIconRef.current) return
    const tgt = cartIconRef.current.getBoundingClientRect()
    const id  = Date.now() + Math.random()
    setFlyingItems(prev => [...prev, {
      id,
      startX: srcRect.left + srcRect.width  / 2,
      startY: srcRect.top  + srcRect.height / 2,
      endX:   tgt.left     + tgt.width      / 2,
      endY:   tgt.top      + tgt.height     / 2,
    }])
    setTimeout(() => setFlyingItems(prev => prev.filter(f => f.id !== id)), 700)
  }

  const addToCart = (product) => {
    if (adminBlocked) { flash('Selling is disabled for admin accounts — enable it in Settings → Business Rules'); return }
    if (!shiftReady) {
      flash('Start your shift to begin selling')
      onRequestStartShift?.()
      return
    }
    if (product.current_quantity <= 0) { flash(`"${product.name}" is out of stock`); return }
    if (!product.selling_price || product.selling_price <= 0) {
      setPriceRequiredProduct(product)
      setPriceInput('')
      return
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
    setSelectedIdx(null)
    // Select-all so the cashier can immediately type the next product without clearing the view
    setTimeout(() => {
      if (searchRef.current) {
        searchRef.current.focus()
        searchRef.current.select()
      }
    }, 0)
  }

  const handleSetPriceConfirm = async () => {
    const price = parseFloat(priceInput)
    if (!price || price <= 0) return
    const product = priceRequiredProduct
    setIsSavingPrice(true)
    try {
      await updateProduct(product.id, {
        name:          product.name,
        category:      product.category || null,
        supplier_id:   product.supplier_id || null,
        unit:          product.unit || 'each',
        selling_price: price,
        reorder_level: product.reorder_level || 5,
        description:   product.description || '',
        image_data:    product.image_data || null,
      })
      await createNotification({
        type: 'PRICE_SET',
        message: `${user?.username || 'Cashier'} set the selling price of "${product.name}" to $${price.toFixed(2)} via the Sales screen`,
        product_id: product.id,
      })
      await logAuditAction(
        user?.username || 'cashier', 'UPDATE_PRODUCT', 'PRODUCT', String(product.id),
        `Selling price set via Sales screen: "${product.name}" → $${price.toFixed(2)}`,
        '0', String(price)
      )
      // Update local products state so the cards now show the price without a reload
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, selling_price: price } : p))
      setMostSoldProducts(prev => prev.map(p => p.id === product.id ? { ...p, selling_price: price } : p))
      const updatedProduct = { ...product, selling_price: price }
      setPriceRequiredProduct(null)
      setPriceInput('')
      addToCart(updatedProduct)
    } catch (err) {
      flash(`Failed to save price: ${err.message}`)
    } finally {
      setIsSavingPrice(false)
    }
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
    if (!canSell) {
      flash(adminBlocked
        ? 'Selling is disabled for admin accounts — enable it in Settings → Business Rules'
        : 'Start your shift before charging a sale')
      if (!shiftReady && !adminBlocked) onRequestStartShift?.()
      return
    }
    if (cart.length === 0) { flash('Cart is empty'); return }
    if (cart.some(i => !i.quantity || i.quantity <= 0)) {
      flash('All items must have a valid quantity'); return
    }
    setCheckoutStep('paymentSelect')
    setCheckoutCashTendered('')
    setMessage({ text: '', type: '' })
  }

  const handleSelectPaymentMethod = (method) => {
    setPaymentMethod(method)
    if (method === 'Cash') {
      setCheckoutStep('cashTendered')
    } else if (method === 'Split') {
      setSplitCashAmt('')
      setCheckoutStep('splitTendered')
    } else {
      // Transfer — complete immediately, no tendering needed
      handleCompleteCheckoutDirect(method)
    }
  }

  const handleBackNavigation = () => {
    if (checkoutStep === 'cashTendered' || checkoutStep === 'splitTendered') {
      setCheckoutStep('paymentSelect')
      setCheckoutCashTendered('')
      setSplitCashAmt('')
    } else {
      setCheckoutStep(null)
    }
  }

  const finaliseSale = async (method, cashTendered, changeGiven, cashPortion = null, transferPortion = null) => {
    // Transfer sales: no physical cash, so cash_amount = 0 and usd_amount = total.
    // Cash: full total is cash. Split: cashPortion/transferPortion set explicitly by caller.
    const isTransfer = method === 'Transfer'
    const paymentData = {
      payment_method: method,
      cash_amount: cashPortion !== null ? cashPortion : (isTransfer ? 0 : cartTotal),
      usd_amount: transferPortion !== null ? transferPortion : (isTransfer ? cartTotal : 0),
      cash_tendered: cashTendered,
      change_given: changeGiven,
    }
    const saleBase = {
      cashier: user.username,
      total: cartTotal,
      shift_id: currentShift?.id || null,
      till_code: tillCode,
      ...paymentData,
    }

    // Generate the receipt number BEFORE saving so it travels inside the sale record —
    // an offline (queued) sale has no id yet, so a separate receipt update could never
    // find it. Allocated from THIS till's own local counter (till:next-receipt-number),
    // never by reading "the last number" from a shared/synced table — that's what let
    // two machines race each other onto the same number.
    let receiptNumber = null
    try {
      receiptNumber = await window.stocka.till.nextReceiptNumber()
    } catch { /* don't block on receipt number failure */ }

    const wasRecalled = !!recalledSaleId
    let raw
    if (wasRecalled) {
      raw = await completeHeldSale(recalledSaleId, paymentData, currentShift?.id || null)
      setRecalledSaleId(null)
    } else {
      raw = await addSale({ ...saleBase, receipt_number: receiptNumber }, cart)
    }
    // Offline: the write is queued for Main and there is no sale id yet
    const wasQueued = !!(raw && typeof raw === 'object' && raw.__queued)
    const saleId = wasQueued ? null : raw

    // Recalled sales already exist in the DB, so their receipt number is attached by id
    if (wasRecalled && !wasQueued && saleId && receiptNumber) {
      try { await updateSaleReceiptNumber(saleId, receiptNumber) } catch { /* non-blocking */ }
    }

    let receiptData = { ...saleBase, id: saleId, items: cart, created_at: new Date().toISOString() }
    if (receiptNumber) receiptData = { ...receiptData, receipt_number: receiptNumber }

    setLastSale({ id: saleId, total: cartTotal, change: changeGiven, paymentMethod: method, timestamp: new Date(), queued: wasQueued })
    setShowConfirmation(true)
    setCheckoutStep(null)
    setCheckoutCashTendered('')
    setSplitCashAmt('')
    setCart([])
    setSearch('')
    loadProducts()
    loadHeldSales()

    if (printerSettings?.auto_print && shopInfo) {
      const printOpts = { printerName: printerSettings.printer_name || '', portPath: printerSettings.printer_port || '' }
      printReceipt(receiptData, shopInfo, { ...printOpts, isDuplicate: false }).catch(() => {})
      if (printerSettings.print_duplicate === 1) {
        printReceipt(receiptData, shopInfo, { ...printOpts, isDuplicate: true }).catch(() => {})
      }
    }
  }

  // Cash payment — validates tendered amount
  const handleCompleteCheckout = async () => {
    const validation = validateCurrency(checkoutCashTendered, 'Cash amount')
    if (!validation.valid) { flash(validation.error); return }
    const tendered = parseFloat(checkoutCashTendered)
    if (tendered < cartTotal) { flash('Insufficient cash tendered'); return }
    setIsProcessing(true)
    try {
      await finaliseSale('Cash', tendered, Math.max(0, tendered - cartTotal))
    } catch { flash('Failed to complete sale') }
    finally { setIsProcessing(false) }
  }

  // Transfer — no tendering required
  const handleCompleteCheckoutDirect = async (method) => {
    setIsProcessing(true)
    try {
      await finaliseSale(method, cartTotal, 0)
    } catch { flash('Failed to complete sale') }
    finally { setIsProcessing(false) }
  }

  // Exact cash — one tap from the payment-method screen, no tendering step
  const handleExactCash = async () => {
    setIsProcessing(true)
    try {
      await finaliseSale('Cash', cartTotal, 0)
    } catch { flash('Failed to complete sale') }
    finally { setIsProcessing(false) }
  }

  // Split — cash portion entered, transfer covers the rest
  const handleCompleteSplitCheckout = async () => {
    const cash = parseFloat(splitCashAmt)
    if (isNaN(cash) || cash <= 0) { flash('Enter the cash amount'); return }
    if (cash >= cartTotal) { flash('Cash covers the full amount — use Cash payment instead'); return }
    const transfer = parseFloat((cartTotal - cash).toFixed(2))
    setIsProcessing(true)
    try {
      await finaliseSale('Split', cash, 0, cash, transfer)
    } catch { flash('Failed to complete sale') }
    finally { setIsProcessing(false) }
  }

  // ── Hold / Recall ──────────────────────────────────
  // Holding works by inserting a sale then flipping it to 'held' by id. A queued
  // offline sale has no id yet, so the flip can't happen — and the queued insert
  // would later replay on Main as a phantom COMPLETED sale. Block holds offline.
  const isOfflineSatellite = async () => {
    try {
      const st = await window.stocka?.lan?.getStatus()
      return st?.mode === 'client' && !st.clientOnline
    } catch { return false }
  }

  const handleHoldSale = async () => {
    if (cart.length === 0) { flash('Nothing in cart to hold'); return }
    if (await isOfflineSatellite()) {
      flash('Offline — holding sales needs the Main computer. Complete the sale now, or wait for reconnection.')
      return
    }
    setIsProcessing(true)
    try {
      const total = cartTotal
      if (recalledSaleId) {
        await holdSale(recalledSaleId, `Hold-${recalledSaleId}`)
        setRecalledSaleId(null)
      } else {
        const saleId = await addSale({ cashier: user.username, total, cash_tendered: 0, change_given: 0, shift_id: currentShift?.id || null, till_code: tillCode }, cart)
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
    if (!canSell) {
      flash(adminBlocked
        ? 'Selling is disabled for admin accounts — enable it in Settings → Business Rules'
        : 'Start your shift before recalling a held sale')
      if (!shiftReady && !adminBlocked) onRequestStartShift?.()
      return
    }
    // Recall may hold the current cart first (same insert-then-flip as Hold) — see isOfflineSatellite
    if (await isOfflineSatellite()) {
      flash('Offline — recalling held sales needs the Main computer. Wait for reconnection.')
      return
    }
    try {
      if (cart.length > 0) {
        if (recalledSaleId) {
          await holdSale(recalledSaleId, `Hold-${recalledSaleId}`)
        } else {
          const total = cartTotal
          const saleId = await addSale({ cashier: user.username, total, cash_tendered: 0, change_given: 0, shift_id: currentShift?.id || null, till_code: tillCode }, cart)
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

  const handleDiscardHeld = (heldSaleId) => {
    setConfirmDiscard(heldSaleId)
  }

  const handleConfirmDiscard = async () => {
    const heldSaleId = confirmDiscard
    setConfirmDiscard(null)
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
  // showProducts is true only when the cashier has typed something — focusing
  // the search input alone must NOT switch the view away from Top Selling,
  // otherwise clicking a product causes the whole list to reorder mid-sale.
  const showProducts = search.trim().length > 0
  const displayProducts = showProducts
    ? products.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 25)
    : []

  // ── Quick amounts for payment modal ───────────────
  // Round the total up to the next multiple of each common note so useful
  // suggestions exist at ANY total (e.g. $7.30 → $8, $10, $20, $50;
  // $123.40 → $124, $125, $130, $140). The old fixed list showed nothing
  // beyond "Exact" once the total passed $100.
  const quickAmounts = (() => {
    const denoms = [1, 5, 10, 20, 50, 100]
    const ups = denoms
      .map(d => Math.ceil((cartTotal + 0.001) / d) * d)
      .filter(a => a > cartTotal)
    const unique = [...new Set(ups)].sort((a, b) => a - b)
    return [
      { label: 'Exact', value: cartTotal.toFixed(2), isExact: true },
      ...unique.slice(0, 4).map(a => ({ label: `$${a}`, value: String(a) }))
    ]
  })()

  // ── Change calculation ────────────────────────────
  const tenderedNum    = parseFloat(checkoutCashTendered) || 0
  const changeAmount   = Math.max(0, tenderedNum - cartTotal)
  const isInsufficient = checkoutCashTendered !== '' && tenderedNum < cartTotal


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

      {/* ── Shift force-closed warning banner (visible while a sale is in progress) ── */}
      {pendingForceClose && (
        <div className="pos-force-close-banner">
          <FiAlertTriangle size={16} />
          <span>Your shift has been closed by the manager. Please complete this sale, then log out.</span>
        </div>
      )}

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
          <span className="pos-key">Space ×2</span>
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
          {currentShift?.__provisional ? (
            <span
              title="Still connecting to Main to confirm your shift — you can keep selling; sales made now will be reattached automatically once it confirms."
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 12,
                background: '#fffbeb', color: '#92400e', fontSize: 12, fontWeight: 700,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d97706' }} />
              Shift pending sync
            </span>
          ) : currentShift ? (
            <>
              <div className="pos-shift-dot" /><span>Shift active</span>
              {onRequestCloseShift && (
                <button
                  onClick={onRequestCloseShift}
                  title="Count your drawer and close this shift (you stay logged in)"
                  style={{
                    marginLeft: 8, padding: '3px 10px', border: '1px solid #cbd5e1',
                    borderRadius: 12, background: 'transparent', color: '#64748b',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  End Shift
                </button>
              )}
            </>
          ) : !adminBlocked ? (
            <button
              onClick={() => onRequestStartShift?.()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', border: 'none', borderRadius: 20,
                background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <FiPlay size={12} /> Start Shift
            </button>
          ) : null}
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
              onChange={e => { setSearch(e.target.value); setSelectedIdx(null) }}
              onKeyDown={(e) => {
                if (!showProducts || displayProducts.length === 0) return

                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSelectedIdx(prev => prev === null ? 0 : Math.min(prev + 1, displayProducts.length - 1))
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelectedIdx(prev => prev === null ? 0 : Math.max(prev - 1, 0))
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (selectedIdx !== null) {
                    const product = displayProducts[selectedIdx]
                    if (product && product.current_quantity > 0) {
                      if (productListRef.current) {
                        const els = productListRef.current.querySelectorAll('.pos-product')
                        if (els[selectedIdx]) triggerFly(els[selectedIdx].getBoundingClientRect())
                      }
                      addToCart(product)
                      setSearch('')
                    }
                  } else {
                    const eligible = displayProducts.filter(p => p.current_quantity > 0)
                    if (eligible.length === 1) {
                      addToCart(eligible[0])
                    } else if (displayProducts.length > 0) {
                      setSelectedIdx(0)
                    }
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
            {search.trim() ? `Results for "${search}"` : 'Top Selling'}
          </div>

          {/* Product list */}
          <div className="pos-products" ref={productListRef}>
            {showProducts ? (
              displayProducts.length === 0 ? (
                <div className="pos-empty">
                  <FiPackage size={32} />
                  <p>No products found</p>
                  <small>Try a different search</small>
                </div>
              ) : (
                displayProducts.map((product, idx) => {
                  const stockClass = product.current_quantity === 0 ? 'out' : product.current_quantity <= (product.reorder_level || 5) ? 'low' : ''
                  return (
                    <button
                      key={product.id}
                      className={`pos-product${selectedIdx === idx ? ' pos-product--selected' : ''}${!product.selling_price ? ' pos-product--no-price' : ''}`}
                      onClick={(e) => { triggerFly(e.currentTarget.getBoundingClientRect()); addToCart(product) }}
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
                          {product.selling_price > 0
                            ? <span className="pos-product-price">${product.selling_price.toFixed(2)}</span>
                            : <span className="pos-product-price pos-product-price--unset"><FiTag size={11} /> Set price</span>}
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
                    className={`pos-product${!product.selling_price ? ' pos-product--no-price' : ''}`}
                    onClick={(e) => { triggerFly(e.currentTarget.getBoundingClientRect()); addToCart(product) }}
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
                        {product.selling_price > 0
                          ? <span className="pos-product-price">${product.selling_price.toFixed(2)}</span>
                          : <span className="pos-product-price pos-product-price--unset"><FiTag size={11} /> Set price</span>}
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
            <div className="cart-header-left" ref={cartIconRef}>
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
          {adminBlocked ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 10 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FiLock size={24} color="#dc2626" />
              </div>
              <p style={{ fontWeight: 700, margin: 0 }}>Selling is disabled for admin accounts</p>
              <small style={{ color: '#64748b' }}>
                Admins handle admin tasks. To allow this account to sell, turn on
                “Allow admin to make sales” in Settings → Business Rules.
              </small>
            </div>
          ) : !shiftReady ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 14, overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, paddingTop: 8 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FiClock size={24} color="#16a34a" />
                </div>
                <p style={{ fontWeight: 700, margin: 0 }}>Shift not started</p>
                <small style={{ color: '#64748b' }}>You can browse products, but selling opens once your shift starts.</small>
                <button
                  onClick={() => onRequestStartShift?.()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
                    padding: '12px 28px', border: 'none', borderRadius: 8,
                    background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                  }}
                >
                  <FiPlay size={16} /> Start Shift
                </button>
              </div>

              {recentShifts.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '10px 0 8px' }}>
                    Your recent shifts
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {recentShifts.map(s => (
                      <div key={s.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ color: '#475569' }}>
                          {String(s.started_at).slice(0, 10)}
                          {s.status === 'open' ? ' · open' : ''}
                        </span>
                        <span style={{ fontWeight: 700, color: '#334155' }}>
                          {s.total_sales_count || 0} sales · ${(s.total_sales_value || 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : cart.length === 0 ? (
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
                  title="Proceed to payment [double-tap Space, or F9]"
                >
                  Charge ${cartTotal.toFixed(2)}
                  <span className="pos-charge-shortcut">Space ×2</span>
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

      {/* ── Payment method selection ── */}
      {checkoutStep === 'paymentSelect' && (
        <div className="pay-overlay" onClick={e => { if (e.target === e.currentTarget) handleBackNavigation() }}>
          <div className="pay-modal">
            <div className="pay-modal-top pay-modal-top--cash">
              <div className="pay-modal-label">Select Payment Method</div>
              <div className="pay-modal-total">${cartTotal.toFixed(2)}</div>
            </div>
            <div className="pay-modal-body">
              <button
                className="pay-exact-cash-btn"
                onClick={handleExactCash}
                disabled={isProcessing}
              >
                <FiCheck size={18} />
                {isProcessing ? 'Processing…' : <>Exact Cash — ${cartTotal.toFixed(2)}</>}
                {!isProcessing && <span className="pay-enter-hint">↵</span>}
              </button>
              <div className="pay-method-label">How is the customer paying?</div>
              <div className="pay-method-row">
                <button
                  className="pay-method-btn pay-method-cash"
                  onClick={() => handleSelectPaymentMethod('Cash')}
                  disabled={isProcessing}
                >
                  <div className="pay-method-icon"><FiBriefcase size={26} color="#16a34a" /></div>
                  <div className="pay-method-name">Cash</div>
                  <div className="pay-method-sub">Count change</div>
                  <span className="pay-method-key">C</span>
                </button>
                <button
                  className="pay-method-btn pay-method-transfer"
                  onClick={() => handleSelectPaymentMethod('Transfer')}
                  disabled={isProcessing}
                >
                  <div className="pay-method-icon"><FiCreditCard size={26} color="#1d4ed8" /></div>
                  <div className="pay-method-name">Transfer</div>
                  <div className="pay-method-sub">EcoCash / Card</div>
                  <span className="pay-method-key">T</span>
                </button>
                <button
                  className="pay-method-btn pay-method-split"
                  onClick={() => handleSelectPaymentMethod('Split')}
                  disabled={isProcessing}
                >
                  <div className="pay-method-icon"><FiSmartphone size={26} color="#b45309" /></div>
                  <div className="pay-method-name">Split</div>
                  <div className="pay-method-sub">Cash + Transfer</div>
                  <span className="pay-method-key">S</span>
                </button>
              </div>
              <div className="pay-actions" style={{ marginTop: 16 }}>
                <button className="pay-cancel-btn" onClick={handleBackNavigation} style={{ width: '100%' }}>
                  <FiChevronLeft size={15} /> Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cash tendered ── */}
      {checkoutStep === 'cashTendered' && (
        <div className="pay-overlay" onClick={e => { if (e.target === e.currentTarget) handleBackNavigation() }}>
          <div className="pay-modal">
            <div className="pay-modal-top pay-modal-top--cash">
              <div className="pay-modal-label">Cash Payment</div>
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

              <div className="pay-input-label">Cash Tendered</div>
              <div className="pay-input-wrap">
                <span className="pay-input-symbol">$</span>
                <input
                  ref={cashInputRef}
                  type="text"
                  inputMode="decimal"
                  className="pay-cash-input"
                  placeholder="0.00"
                  value={checkoutCashTendered}
                  onChange={e => {
                    const v = e.target.value
                    if (/^\d*\.?\d{0,2}$/.test(v)) setCheckoutCashTendered(v)
                  }}
                  onClick={e => e.target.select()}
                />
              </div>

              {checkoutCashTendered !== '' && (
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
                  <FiChevronLeft size={15} /> Cancel
                </button>
                <button
                  className="pay-complete-btn"
                  onClick={() => handleCompleteCheckout()}
                  disabled={isProcessing || !checkoutCashTendered || isInsufficient}
                >
                  {isProcessing ? 'Processing…' : 'Complete Sale'}
                  {!isProcessing && <span className="pay-enter-hint">↵</span>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Split tendered ── */}
      {checkoutStep === 'splitTendered' && (() => {
        const cash = parseFloat(splitCashAmt) || 0
        const transfer = parseFloat((cartTotal - cash).toFixed(2))
        const splitValid = cash > 0 && cash < cartTotal
        return (
          <div className="pay-overlay" onClick={e => { if (e.target === e.currentTarget) handleBackNavigation() }}>
            <div className="pay-modal">
              <div className="pay-modal-top pay-modal-top--split">
                <div className="pay-modal-label">Split Payment</div>
                <div className="pay-modal-total">${cartTotal.toFixed(2)}</div>
              </div>
              <div className="pay-modal-body">
                <div className="pay-input-label">Cash Amount</div>
                <div className="pay-input-wrap">
                  <span className="pay-input-symbol">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="pay-cash-input"
                    placeholder="0.00"
                    value={splitCashAmt}
                    onChange={e => {
                      const v = e.target.value
                      if (/^\d*\.?\d{0,2}$/.test(v)) setSplitCashAmt(v)
                    }}
                    onClick={e => e.target.select()}
                    autoFocus
                  />
                </div>
                {splitCashAmt !== '' && (
                  <div className="pay-change" style={{ color: splitValid ? '#1d4ed8' : '#dc2626' }}>
                    <span className="pay-change-label">
                      {cash <= 0 ? 'Enter cash amount' : cash >= cartTotal ? 'Use Cash payment instead' : 'Transfer'}
                    </span>
                    {splitValid && <span className="pay-change-value">${transfer.toFixed(2)}</span>}
                  </div>
                )}

                <div className="pay-actions">
                  <button className="pay-cancel-btn" onClick={handleBackNavigation}>
                    <FiChevronLeft size={15} /> Back
                  </button>
                  <button
                    className="pay-complete-btn"
                    onClick={handleCompleteSplitCheckout}
                    disabled={isProcessing || !splitValid}
                  >
                    {isProcessing ? 'Processing…' : 'Complete Sale'}
                    {!isProcessing && <span className="pay-enter-hint">↵</span>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Sale success flash ── */}
      {showConfirmation && lastSale && (
        <div className="sale-success-overlay" onClick={dismissConfirmation}>
          <div className="sale-success-card">
            <div className="sale-success-icon">
              <FiCheck size={32} color="white" strokeWidth={3} />
            </div>
            <div className="sale-success-title">Sale Complete!</div>
            <div className="sale-success-pay-badge">
              {lastSale.paymentMethod === 'Transfer'
                ? <><FiCreditCard size={12} /> Transfer</>
                : lastSale.paymentMethod === 'Split'
                  ? <><FiSmartphone size={12} /> Split</>
                  : <><FiBriefcase size={12} /> Cash</>}
            </div>
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
            <div className="sale-success-sub">Tap anywhere to continue</div>
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

      {/* ── Set price modal (no-price products) ── */}
      {priceRequiredProduct && (
        <div className="set-price-overlay" onClick={e => { if (e.target === e.currentTarget) setPriceRequiredProduct(null) }}>
          <div className="set-price-modal">
            <div className="set-price-icon"><FiTag size={28} /></div>
            <h3 className="set-price-title">Set Selling Price</h3>
            <p className="set-price-product-name">{priceRequiredProduct.name}</p>
            <p className="set-price-hint">This product has no price. Set one now to add it to the cart.</p>
            <div className="set-price-input-wrap">
              <span className="set-price-symbol">$</span>
              <input
                className="set-price-input"
                type="number"
                placeholder="0.00"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSetPriceConfirm() }}
                step="0.01"
                min="0.01"
                autoFocus
              />
            </div>
            <div className="set-price-actions">
              <button className="set-price-cancel" onClick={() => setPriceRequiredProduct(null)}>Cancel</button>
              <button
                className="set-price-confirm"
                onClick={handleSetPriceConfirm}
                disabled={!priceInput || parseFloat(priceInput) <= 0 || isSavingPrice}
              >
                {isSavingPrice ? 'Saving…' : 'Set Price & Add to Cart'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fly-to-cart particles ── */}
      {flyingItems.map(f => (
        <FlyParticle
          key={f.id}
          startX={f.startX} startY={f.startY}
          endX={f.endX}     endY={f.endY}
          onDone={() => setFlyingItems(prev => prev.filter(p => p.id !== f.id))}
        />
      ))}

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

    {confirmDiscard && (
      <ConfirmModal
        message="Discard this held sale?"
        detail="This sale will be permanently removed and stock will be returned."
        confirmLabel="Discard"
        danger
        onConfirm={handleConfirmDiscard}
        onCancel={() => setConfirmDiscard(null)}
      />
    )}
    </div>
  )
}

export default Sales
