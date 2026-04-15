import { hashPassword, comparePassword, hashPasswordSync } from '../utils/authUtils'

let db = null
let initPromise = null

// Use window.initSqlJs that was loaded via script tag in index.html
const loadInitSqlJs = async () => {
  // Wait for initSqlJs to be available globally
  let attempts = 0
  while (!window.initSqlJs && attempts < 100) {
    await new Promise(resolve => setTimeout(resolve, 50))
    attempts++
  }
  
  if (!window.initSqlJs) {
    throw new Error('Failed to load sql.js: initSqlJs not found on window')
  }
  
  return window.initSqlJs
}

const DB_KEY = 'stocka_db'
const DB_INIT_KEY = 'stocka_db_init'

// Save database to localStorage
export const saveDb = () => {
  if (!db) return
  try {
    const data = db.export()
    let binary = ''
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i])
    }
    localStorage.setItem(DB_KEY, btoa(binary))
  } catch (err) {
    console.error('Failed to save database:', err)
  }
}

// Load or create the database
export const getDb = async () => {
  if (db) return db
  
  // Prevent multiple initialization attempts
  if (initPromise) return initPromise
  
  initPromise = (async () => {
    try {
      console.log('Initializing database...')
      const start = performance.now()
      
      // Load initSqlJs function
      const initFunc = await loadInitSqlJs()
      
      const SQL = await initFunc({
        locateFile: file => `/${file}`
      })
      
      console.log(`SQL.js loaded in ${performance.now() - start}ms`)

      const saved = localStorage.getItem(DB_KEY)
      
      if (saved) {
        console.log('Loading existing database from storage...')
        const binary = atob(saved)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        db = new SQL.Database(bytes)
      } else {
        console.log('Creating new database...')
        db = new SQL.Database()
        // Mark as initialized
        localStorage.setItem(DB_INIT_KEY, '1')
      }
      
      // Always ensure all tables exist (CREATE TABLE IF NOT EXISTS is safe to run multiple times)
      createTables()
      // Run any necessary schema migrations
      runMigrations()
      saveDb()
      
      console.log(`Database ready in ${performance.now() - start}ms`)
      return db
    } catch (err) {
      console.error('Database initialization failed:', err)
      initPromise = null // Reset on error to allow retry
      throw err
    }
  })()
  
  return initPromise
}

// Create all Stocka tables
const createTables = () => {
  // Shops table (for setup wizard)
  db.run(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      currency TEXT DEFAULT 'USD',
      setup_complete INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Products table
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      supplier_id INTEGER,
      unit TEXT DEFAULT 'each',
      reorder_level INTEGER DEFAULT 5,
      description TEXT,
      current_quantity INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Suppliers table
  db.run(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Stock Receivings table
  db.run(`
    CREATE TABLE IF NOT EXISTS stock_receivings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      date_received TEXT NOT NULL,
      cartons INTEGER NOT NULL,
      units_per_carton INTEGER NOT NULL,
      total_units INTEGER NOT NULL,
      cost_per_carton REAL NOT NULL,
      cost_per_unit REAL NOT NULL,
      selling_price_per_unit REAL NOT NULL,
      total_value REAL NOT NULL,
      recorded_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Stock Movements table
  db.run(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      note TEXT,
      recorded_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Sales table
  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier TEXT NOT NULL,
      branch_id INTEGER,
      total REAL NOT NULL,
      cash_tendered REAL NOT NULL,
      change_given REAL NOT NULL,
      payment_method TEXT DEFAULT 'USD Cash',
      currency TEXT DEFAULT 'USD',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Sale Items table
  db.run(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      cost_price REAL NOT NULL,
      selling_price REAL NOT NULL,
      subtotal REAL NOT NULL
    )
  `)

  // Expenses table
  db.run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      recorded_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Notifications table
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      product_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // End of Day table
  db.run(`
    CREATE TABLE IF NOT EXISTS end_of_day (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      cashier TEXT NOT NULL,
      total_sales REAL NOT NULL,
      total_expenses REAL NOT NULL,
      expected_cash REAL NOT NULL,
      actual_cash REAL NOT NULL,
      difference REAL NOT NULL,
      status TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Branches table
  db.run(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      manager_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Shifts table
  db.run(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier_id INTEGER NOT NULL,
      cashier_name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      start_float REAL NOT NULL,
      opening_confirmed_at TEXT,
      end_time TEXT,
      end_float REAL,
      closing_timestamp TEXT,
      total_sales REAL DEFAULT 0,
      total_expenses REAL DEFAULT 0,
      float_variance REAL,
      status TEXT DEFAULT 'open',
      notes TEXT,
      opening_notes TEXT,
      closing_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (cashier_id) REFERENCES users(id)
    )
  `)

  // Sale holds - session-scoped holds for current shift only
  db.run(`
    CREATE TABLE IF NOT EXISTS sale_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      held_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shift_id) REFERENCES shifts(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `)
}

// Run schema migrations to handle updates to existing databases
const runMigrations = () => {
  try {
    // Get current columns in users table
    const usersResult = db.exec("PRAGMA table_info(users)")
    const usersColumns = extractResults(usersResult).map(col => col.name)
    
    // Define required columns for users table
    const usersRequiredColumns = {
      'is_active': 'INTEGER DEFAULT 1',
      'created_by': 'TEXT',
      'last_login': 'TEXT',
      'password_hash': 'TEXT',
      'current_shift_id': 'INTEGER'
    }
    
    // Add missing columns to users table
    for (const [columnName, columnDef] of Object.entries(usersRequiredColumns)) {
      if (!usersColumns.includes(columnName)) {
        console.log(`Adding ${columnName} column to users table...`)
        db.run(`ALTER TABLE users ADD COLUMN ${columnName} ${columnDef}`)
      }
    }

    // Get current columns in sales table
    const salesResult = db.exec("PRAGMA table_info(sales)")
    const salesColumns = extractResults(salesResult).map(col => col.name)
    
    // Define required columns for sales table
    const salesRequiredColumns = {
      'payment_method': "TEXT DEFAULT 'USD Cash'",
      'currency': "TEXT DEFAULT 'USD'",
      'status': "TEXT DEFAULT 'completed'",
      'held_name': 'TEXT',
      'held_at': 'TEXT',
      'released_from_hold_at': 'TEXT',
      'void_reason': 'TEXT',
      'voided_by': 'TEXT',
      'voided_at': 'TEXT',
      'shift_id': 'INTEGER',
      'receipt_number': 'TEXT'
    }
    
    // Add missing columns to sales table
    for (const [columnName, columnDef] of Object.entries(salesRequiredColumns)) {
      if (!salesColumns.includes(columnName)) {
        console.log(`Adding ${columnName} column to sales table...`)
        db.run(`ALTER TABLE sales ADD COLUMN ${columnName} ${columnDef}`)
      }
    }

    // Get current columns in products table
    const productsResult = db.exec("PRAGMA table_info(products)")
    const productsColumns = extractResults(productsResult).map(col => col.name)
    
    // Define required columns for products table
    const productsRequiredColumns = {
      'image_data': 'TEXT',
      'last_sold_date': 'TEXT'
    }
    
    // Add missing columns to products table
    for (const [columnName, columnDef] of Object.entries(productsRequiredColumns)) {
      if (!productsColumns.includes(columnName)) {
        console.log(`Adding ${columnName} column to products table...`)
        db.run(`ALTER TABLE products ADD COLUMN ${columnName} ${columnDef}`)
      }
    }

    // Get current columns in expenses table
    const expensesResult = db.exec("PRAGMA table_info(expenses)")
    const expensesColumns = extractResults(expensesResult).map(col => col.name)
    
    // Define required columns for expenses table
    const expensesRequiredColumns = {
      'shift_id': 'INTEGER'
    }
    
    // Add missing columns to expenses table
    for (const [columnName, columnDef] of Object.entries(expensesRequiredColumns)) {
      if (!expensesColumns.includes(columnName)) {
        console.log(`Adding ${columnName} column to expenses table...`)
        db.run(`ALTER TABLE expenses ADD COLUMN ${columnName} ${columnDef}`)
      }
    }

    // Get current columns in sale_items table
    const saleItemsResult = db.exec("PRAGMA table_info(sale_items)")
    const saleItemsColumns = extractResults(saleItemsResult).map(col => col.name)
    
    // Define required columns for sale_items table
    const saleItemsRequiredColumns = {
      'expiry_date': 'TEXT'
    }
    
    // Add missing columns to sale_items table
    for (const [columnName, columnDef] of Object.entries(saleItemsRequiredColumns)) {
      if (!saleItemsColumns.includes(columnName)) {
        console.log(`Adding ${columnName} column to sale_items table...`)
        db.run(`ALTER TABLE sale_items ADD COLUMN ${columnName} ${columnDef}`)
      }
    }

    // Get current columns in shifts table
    const shiftsResult = db.exec("PRAGMA table_info(shifts)")
    const shiftsColumns = extractResults(shiftsResult).map(col => col.name)
    
    // Define required columns for shifts table
    const shiftsRequiredColumns = {
      'opening_confirmed_at': 'TEXT',
      'closing_timestamp': 'TEXT',
      'float_variance': 'REAL',
      'opening_notes': 'TEXT',
      'closing_notes': 'TEXT'
    }
    
    // Add missing columns to shifts table
    for (const [columnName, columnDef] of Object.entries(shiftsRequiredColumns)) {
      if (!shiftsColumns.includes(columnName)) {
        console.log(`Adding ${columnName} column to shifts table...`)
        db.run(`ALTER TABLE shifts ADD COLUMN ${columnName} ${columnDef}`)
      }
    }

    // Get current columns in shops table for printer settings
    const shopsResult = db.exec("PRAGMA table_info(shops)")
    const shopsColumns = extractResults(shopsResult).map(col => col.name)
    
    // Define required columns for shops table (printer settings)
    const shopsRequiredColumns = {
      'printer_name': 'TEXT',
      'printer_port': 'TEXT',
      'auto_print': "INTEGER DEFAULT 1",
      'print_duplicate': "INTEGER DEFAULT 0"
    }
    
    // Add missing columns to shops table
    for (const [columnName, columnDef] of Object.entries(shopsRequiredColumns)) {
      if (!shopsColumns.includes(columnName)) {
        console.log(`Adding ${columnName} column to shops table...`)
        db.run(`ALTER TABLE shops ADD COLUMN ${columnName} ${columnDef}`)
      }
    }
  } catch (error) {
    console.warn('Migration error (non-fatal):', error)
  }
}

// Helper to extract results from sql.js
const extractResults = (result) => {
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const obj = {}
    columns.forEach((col, i) => obj[col] = row[i])
    return obj
  })
}

// Helper to get single value
const getScalarValue = (result, defaultValue = 0) => {
  if (!result.length || !result[0].values.length) return defaultValue
  return result[0].values[0][0] ?? defaultValue
}

// ── SHOP FUNCTIONS ──
export const getShop = async () => {
  const database = await getDb()
  const result = database.exec('SELECT * FROM shops LIMIT 1')
  const shops = extractResults(result)
  return shops.length > 0 ? shops[0] : null
}

export const initializeShop = async (shopData) => {
  const database = await getDb()
  database.run(
    `INSERT INTO shops (name, address, phone, email, currency, setup_complete)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [shopData.name, shopData.address, shopData.phone, shopData.email, shopData.currency]
  )
  saveDb()
}

export const updateShop = async (id, shopData) => {
  const database = await getDb()
  database.run(
    `UPDATE shops SET 
      name = ?, 
      address = ?, 
      phone = ?, 
      email = ?,
      printer_name = ?,
      printer_port = ?,
      auto_print = ?,
      print_duplicate = ?
      WHERE id = ?`,
    [
      shopData.name, 
      shopData.address, 
      shopData.phone, 
      shopData.email,
      shopData.printer_name || null,
      shopData.printer_port || null,
      shopData.auto_print !== undefined ? shopData.auto_print : 1,
      shopData.print_duplicate !== undefined ? shopData.print_duplicate : 0,
      id
    ]
  )
  saveDb()
}

// ── PRODUCT FUNCTIONS ──
export const getProducts = async () => {
  const database = await getDb()
  const result = database.exec('SELECT * FROM products ORDER BY name ASC')
  return extractResults(result)
}

export const getProductById = async (id) => {
  const database = await getDb()
  const stmt = database.prepare('SELECT * FROM products WHERE id = ?')
  stmt.bind([id])
  const result = []
  while (stmt.step()) {
    result.push(stmt.getAsObject())
  }
  stmt.free()
  return result[0] || null
}

export const addProduct = async (product) => {
  try {
    const database = await getDb()
    database.run(
      `INSERT INTO products (name, category, supplier_id, unit, reorder_level, description, current_quantity, image_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.name,
        product.category || '',
        product.supplier_id || null,
        product.unit || 'each',
        product.reorder_level || 5,
        product.description || '',
        product.current_quantity || 0,
        product.image_data || null
      ]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to add product:', error)
    throw error
  }
}

export const updateProduct = async (id, product) => {
  try {
    const database = await getDb()
    database.run(
      `UPDATE products SET name = ?, category = ?, supplier_id = ?, unit = ?, reorder_level = ?, description = ?, image_data = ? WHERE id = ?`,
      [
        product.name,
        product.category || '',
        product.supplier_id || null,
        product.unit || 'each',
        product.reorder_level || 5,
        product.description || '',
        product.image_data || null,
        id
      ]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to update product:', error)
    throw error
  }
}

export const deleteProduct = async (id) => {
  try {
    const database = await getDb()
    database.run('DELETE FROM products WHERE id = ?', [id])
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to delete product:', error)
    throw error
  }
}

export const updateProductQuantity = async (productId, quantity) => {
  try {
    const database = await getDb()
    database.run(
      `UPDATE products SET current_quantity = ? WHERE id = ?`,
      [quantity, productId]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to update product quantity:', error)
    throw error
  }
}

export const getLatestProductPrice = async (productId) => {
  const database = await getDb()
  const result = database.exec(
    `SELECT selling_price_per_unit, cost_per_unit FROM stock_receivings 
     WHERE product_id = ? ORDER BY date_received DESC LIMIT 1`,
    [productId]
  )
  const prices = extractResults(result)
  return prices[0] || null
}

export const getMostSoldProducts = async (limit = 10) => {
  try {
    const database = await getDb()
    const result = database.exec(`
      SELECT 
        p.id, 
        p.name, 
        p.category, 
        p.current_quantity, 
        p.image_data,
        SUM(si.quantity) as total_sold
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT ?
    `, [limit])
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get most sold products:', error)
    return []
  }
}

export const updateProductImage = async (productId, imageData) => {
  try {
    const database = await getDb()
    database.run(
      `UPDATE products SET image_data = ? WHERE id = ?`,
      [imageData, productId]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to update product image:', error)
    throw error
  }
}

// ── SUPPLIER FUNCTIONS ──
export const getSuppliers = async () => {
  const database = await getDb()
  const result = database.exec('SELECT * FROM suppliers ORDER BY name ASC')
  return extractResults(result)
}

export const getSupplierById = async (id) => {
  const database = await getDb()
  const stmt = database.prepare('SELECT * FROM suppliers WHERE id = ?')
  stmt.bind([id])
  const result = []
  while (stmt.step()) {
    result.push(stmt.getAsObject())
  }
  stmt.free()
  return result[0] || null
}

export const addSupplier = async (supplier) => {
  try {
    const database = await getDb()
    database.run(
      `INSERT INTO suppliers (name, contact_person, phone, email, address, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        supplier.name,
        supplier.contact_person || '',
        supplier.phone || '',
        supplier.email || '',
        supplier.address || '',
        supplier.notes || ''
      ]
    )
    await new Promise(resolve => setTimeout(resolve, 100)) // Give database time to process
    saveDb()
  } catch (error) {
    console.error('Failed to add supplier:', error)
    throw error
  }
}

export const updateSupplier = async (id, supplier) => {
  try {
    const database = await getDb()
    database.run(
      `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?`,
      [
        supplier.name,
        supplier.contact_person || '',
        supplier.phone || '',
        supplier.email || '',
        supplier.address || '',
        supplier.notes || '',
        id
      ]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to update supplier:', error)
    throw error
  }
}

export const deleteSupplier = async (id) => {
  try {
    const database = await getDb()
    database.run('DELETE FROM suppliers WHERE id = ?', [id])
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to delete supplier:', error)
    throw error
  }
}

// ── STOCK RECEIVING FUNCTIONS ──
export const addStockReceiving = async (receiving) => {
  try {
    const database = await getDb()
    database.run(
      `INSERT INTO stock_receivings 
       (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, 
        cost_per_carton, cost_per_unit, selling_price_per_unit, total_value, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiving.supplier_id,
        receiving.product_id,
        receiving.date_received,
        receiving.cartons,
        receiving.units_per_carton,
        receiving.total_units,
        receiving.cost_per_carton,
        receiving.cost_per_unit,
        receiving.selling_price_per_unit,
        receiving.total_value,
        receiving.recorded_by
      ]
    )
    
    // Update product quantity
    const product = await getProductById(receiving.product_id)
    const newQuantity = (product.current_quantity || 0) + receiving.total_units
    await updateProductQuantity(receiving.product_id, newQuantity)
    
    // Record stock movement
    const productName = product.name
    database.run(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by)
       VALUES (?, ?, 'RECEIVED', ?, ?)`,
      [receiving.product_id, productName, receiving.total_units, receiving.recorded_by]
    )
    
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to add stock receiving:', error)
    throw error
  }
}

export const getStockReceivings = async () => {
  const database = await getDb()
  const result = database.exec(
    `SELECT sr.*, p.name as product_name, s.name as supplier_name FROM stock_receivings sr
     LEFT JOIN products p ON sr.product_id = p.id
     LEFT JOIN suppliers s ON sr.supplier_id = s.id
     ORDER BY sr.date_received DESC`
  )
  return extractResults(result)
}

export const getStockReceivingById = async (id) => {
  const database = await getDb()
  const result = database.exec(
    `SELECT sr.*, p.name as product_name, s.name as supplier_name FROM stock_receivings sr
     LEFT JOIN products p ON sr.product_id = p.id
     LEFT JOIN suppliers s ON sr.supplier_id = s.id
     WHERE sr.id = ?`,
    [id]
  )
  const receivings = extractResults(result)
  return receivings[0] || null
}

// ── SALES FUNCTIONS ──
export const addSale = async (sale, saleItems) => {
  try {
    const database = await getDb()
    
    // Add sale with status 'completed'
    database.run(
      `INSERT INTO sales (cashier, branch_id, total, cash_tendered, change_given, payment_method, currency, note, status, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [sale.cashier, sale.branch_id || null, sale.total, sale.cash_tendered, sale.change_given, sale.payment_method || 'USD Cash', sale.currency || 'USD', sale.note || '', sale.shift_id || null]
    )
    
    // Get the inserted sale id
    const saleResult = database.exec('SELECT last_insert_rowid() as id')
    const saleId = extractResults(saleResult)[0].id
    
    // Add sale items and update product quantities
    const now = new Date().toISOString()
    for (const item of saleItems) {
      database.run(
        `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, cost_price, selling_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [saleId, item.product_id, item.product_name, item.quantity, item.cost_price, item.selling_price, item.subtotal]
      )
      
      // Update product quantity and last_sold_date
      const product = await getProductById(item.product_id)
      const newQuantity = (product.current_quantity || 0) - item.quantity
      await updateProductQuantity(item.product_id, newQuantity)
      
      // Update last_sold_date on product
      database.run(
        `UPDATE products SET last_sold_date = ? WHERE id = ?`,
        [now, item.product_id]
      )
      
      // Record stock movement
      database.run(
        `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by)
         VALUES (?, ?, 'SOLD', ?, ?)`,
        [item.product_id, item.product_name, item.quantity, sale.cashier]
      )
    }
    
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
    return saleId
  } catch (error) {
    console.error('Failed to add sale:', error)
    throw error
  }
}

export const getSales = async () => {
  const database = await getDb()
  const result = database.exec('SELECT * FROM sales ORDER BY created_at DESC')
  return extractResults(result)
}

export const getSaleById = async (id) => {
  const database = await getDb()
  const stmt = database.prepare('SELECT * FROM sales WHERE id = ?')
  stmt.bind([id])
  const result = []
  while (stmt.step()) {
    result.push(stmt.getAsObject())
  }
  stmt.free()
  return result[0] || null
}

export const getSaleItems = async (saleId) => {
  const database = await getDb()
  if (saleId) {
    const stmt = database.prepare('SELECT * FROM sale_items WHERE sale_id = ?')
    stmt.bind([saleId])
    const result = []
    while (stmt.step()) {
      result.push(stmt.getAsObject())
    }
    stmt.free()
    return result
  } else {
    // Return all sale items if no saleId provided (for reports)
    const result = database.exec('SELECT * FROM sale_items ORDER BY id DESC')
    return extractResults(result)
  }
}

/**
 * Hold a sale mid-transaction
 * @param {number} saleId - Sale ID
 * @param {string} heldName - Label/name for the held sale
 * @returns {Promise<void>}
 */
export const holdSale = async (saleId, heldName) => {
  try {
    const database = await getDb()
    database.run(
      `UPDATE sales SET status = 'held', held_name = ?, held_at = ? WHERE id = ?`,
      [heldName || `Hold-${saleId}`, new Date().toISOString(), saleId]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to hold sale:', error)
    throw error
  }
}

/**
 * Retrieve all held sales
 * @returns {Promise<Array>} - Array of held sales
 */
export const getHeldSales = async () => {
  try {
    const database = await getDb()
    const result = database.exec(`SELECT * FROM sales WHERE status = 'held' ORDER BY held_at DESC`)
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get held sales:', error)
    return []
  }
}

/**
 * Recall a held sale (change status back to pending for completion)
 * @param {number} saleId - Sale ID
 * @returns {Promise<Object>} - Updated sale with items
 */
export const recallHeldSale = async (saleId) => {
  try {
    const database = await getDb()
    database.run(
      `UPDATE sales SET status = 'pending', released_from_hold_at = ? WHERE id = ?`,
      [new Date().toISOString(), saleId]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
    
    // Return the sale with items
    const sale = await getSaleById(saleId)
    const items = await getSaleItems(saleId)
    return { ...sale, items }
  } catch (error) {
    console.error('Failed to recall held sale:', error)
    throw error
  }
}

/**
 * Discard a held sale (remove it permanently)
 * @param {number} saleId - Sale ID
 * @returns {Promise<void>}
 */
export const discardHeldSale = async (saleId) => {
  try {
    const database = await getDb()
    // Get items to restore stock
    const items = await getSaleItems(saleId)
    
    // Restore stock for all items in the held sale
    for (const item of items) {
      const product = await getProductById(item.product_id)
      const newQuantity = (product.current_quantity || 0) + item.quantity
      await updateProductQuantity(item.product_id, newQuantity)
    }
    
    // Delete sale items and sale
    database.run(`DELETE FROM sale_items WHERE sale_id = ?`, [saleId])
    database.run(`DELETE FROM sales WHERE id = ?`, [saleId])
    
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to discard held sale:', error)
    throw error
  }
}

/**
 * Void a completed sale (reverse transaction)
 * Can only void sales less than 24 hours old
 * @param {number} saleId - Sale ID
 * @param {string} voidReason - Reason for void
 * @param {string} voidedBy - Username of who voided it
 * @returns {Promise<boolean>} - True if void successful
 */
export const voidSale = async (saleId, voidReason, voidedBy) => {
  try {
    const database = await getDb()
    
    // Get the sale to check age
    const sale = await getSaleById(saleId)
    if (!sale) {
      throw new Error('Sale not found')
    }
    
    // Check if sale is older than 24 hours
    const saleDate = new Date(sale.created_at)
    const now = new Date()
    const hoursDiff = (now - saleDate) / (1000 * 60 * 60)
    
    if (hoursDiff > 24) {
      throw new Error('Cannot void sales older than 24 hours')
    }
    
    // Get items to restore stock
    const items = await getSaleItems(saleId)
    
    // Restore stock for all items
    for (const item of items) {
      const product = await getProductById(item.product_id)
      const newQuantity = (product.current_quantity || 0) + item.quantity
      await updateProductQuantity(item.product_id, newQuantity)
      
      // Record reversal in stock movements
      database.run(
        `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by)
         VALUES (?, ?, 'VOIDED', ?, ?, ?)`,
        [item.product_id, item.product_name, item.quantity, `Void sale #${saleId}: ${voidReason}`, voidedBy]
      )
    }
    
    // Mark sale as voided
    database.run(
      `UPDATE sales SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?`,
      [voidReason, voidedBy, new Date().toISOString(), saleId]
    )
    
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
    return true
  } catch (error) {
    console.error('Failed to void sale:', error)
    throw error
  }
}

/**
 * Get voided sales (for audit trail)
 * @returns {Promise<Array>} - Array of voided sales
 */
export const getVoidedSales = async () => {
  try {
    const database = await getDb()
    const result = database.exec(`SELECT * FROM sales WHERE status = 'voided' ORDER BY voided_at DESC`)
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get voided sales:', error)
    return []
  }
}

// ── EXPENSE FUNCTIONS ──
export const addExpense = async (expense) => {
  try {
    const database = await getDb()
    database.run(
      `INSERT INTO expenses (description, amount, category, date, recorded_by, shift_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [expense.description, expense.amount, expense.category, expense.date, expense.recorded_by, expense.shift_id || null]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to add expense:', error)
    throw error
  }
}

export const getExpenses = async () => {
  const database = await getDb()
  const result = database.exec('SELECT * FROM expenses ORDER BY date DESC')
  return extractResults(result)
}

export const getExpenseById = async (id) => {
  const database = await getDb()
  const stmt = database.prepare('SELECT * FROM expenses WHERE id = ?')
  stmt.bind([id])
  const result = []
  while (stmt.step()) {
    result.push(stmt.getAsObject())
  }
  stmt.free()
  return result[0] || null
}

export const updateExpense = async (id, expense) => {
  try {
    const database = await getDb()
    database.run(
      `UPDATE expenses SET description = ?, amount = ?, category = ?, date = ? WHERE id = ?`,
      [expense.description, expense.amount, expense.category, expense.date, id]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to update expense:', error)
    throw error
  }
}

export const deleteExpense = async (id) => {
  try {
    const database = await getDb()
    database.run('DELETE FROM expenses WHERE id = ?', [id])
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to delete expense:', error)
    throw error
  }
}

// ── END OF DAY FUNCTIONS ──
export const addEndOfDay = async (eod) => {
  try {
    const database = await getDb()
    database.run(
      `INSERT INTO end_of_day (date, cashier, total_sales, total_expenses, expected_cash, actual_cash, difference, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eod.date, eod.cashier, eod.total_sales, eod.total_expenses, eod.expected_cash, eod.actual_cash, eod.difference, eod.status || '', eod.notes || '']
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to add end of day record:', error)
    throw error
  }
}

export const getEndOfDayRecords = async () => {
  const database = await getDb()
  const result = database.exec('SELECT * FROM end_of_day ORDER BY date DESC')
  return extractResults(result)
}

export const getEndOfDayByDate = async (date) => {
  const database = await getDb()
  const stmt = database.prepare('SELECT * FROM end_of_day WHERE date = ?')
  stmt.bind([date])
  const result = []
  while (stmt.step()) {
    result.push(stmt.getAsObject())
  }
  stmt.free()
  return result[0] || null
}

// ── BRANCH FUNCTIONS ──
export const getBranches = async () => {
  const database = await getDb()
  const result = database.exec('SELECT * FROM branches ORDER BY name ASC')
  return extractResults(result)
}

export const getBranchById = async (id) => {
  const database = await getDb()
  const stmt = database.prepare('SELECT * FROM branches WHERE id = ?')
  stmt.bind([id])
  const result = []
  while (stmt.step()) {
    result.push(stmt.getAsObject())
  }
  stmt.free()
  return result[0] || null
}

export const addBranch = async (branch) => {
  try {
    const database = await getDb()
    database.run(
      `INSERT INTO branches (name, address, phone, manager_name)
       VALUES (?, ?, ?, ?)`,
      [branch.name, branch.address || '', branch.phone || '', branch.manager_name || '']
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to add branch:', error)
    throw error
  }
}

export const updateBranch = async (id, branch) => {
  try {
    const database = await getDb()
    database.run(
      `UPDATE branches SET name = ?, address = ?, phone = ?, manager_name = ? WHERE id = ?`,
      [branch.name, branch.address || '', branch.phone || '', branch.manager_name || '', id]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to update branch:', error)
    throw error
  }
}

export const deleteBranch = async (id) => {
  try {
    const database = await getDb()
    database.run('DELETE FROM branches WHERE id = ?', [id])
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to delete branch:', error)
    throw error
  }
}

// ── USER FUNCTIONS ──
export const getUsers = async () => {
  const database = await getDb()
  const result = database.exec('SELECT id, username, role, is_active, created_by, last_login, created_at FROM users ORDER BY created_at DESC')
  return extractResults(result)
}

export const getUserByUsername = async (username) => {
  const database = await getDb()
  const stmt = database.prepare('SELECT * FROM users WHERE username = ?')
  stmt.bind([username])
  const result = []
  while (stmt.step()) {
    result.push(stmt.getAsObject())
  }
  stmt.free()
  return result[0] || null
}

export const addUser = async (user) => {
  try {
    const database = await getDb()
    // Hash the password using bcryptjs
    const passwordHash = await hashPassword(user.password)
    database.run(
      `INSERT INTO users (username, password, password_hash, role, is_active, created_by)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [user.username, '', passwordHash, user.role, user.created_by || 'admin']
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to add user:', error)
    throw error
  }
}

export const updateUser = async (id, user) => {
  try {
    const database = await getDb()
    const updateFields = []
    const updateValues = []
    
    if (user.password !== undefined) {
      // Hash the password when updating
      const passwordHash = await hashPassword(user.password)
      updateFields.push('password_hash = ?')
      updateValues.push(passwordHash)
      // Keep password field empty for new hashed system
      updateFields.push('password = ?')
      updateValues.push('')
    }
    if (user.role !== undefined) {
      updateFields.push('role = ?')
      updateValues.push(user.role)
    }
    if (user.is_active !== undefined) {
      updateFields.push('is_active = ?')
      updateValues.push(user.is_active)
    }
    if (user.last_login !== undefined) {
      updateFields.push('last_login = ?')
      updateValues.push(user.last_login)
    }
    
    if (updateFields.length === 0) return
    
    updateValues.push(id)
    database.run(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to update user:', error)
    throw error
  }
}

export const deactivateUser = async (id) => {
  try {
    const database = await getDb()
    database.run('UPDATE users SET is_active = 0 WHERE id = ?', [id])
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to deactivate user:', error)
    throw error
  }
}

/**
 * Validate user password (supports both hashed and plain text for migration)
 * @param {Object} user - User object from database
 * @param {string} password - Plain text password to verify
 * @returns {Promise<boolean>} - True if password matches
 */
export const validateUserPassword = async (user, password) => {
  if (!user) return false
  
  // If password_hash exists, use it (new secure way)
  if (user.password_hash) {
    try {
      return await comparePassword(password, user.password_hash)
    } catch (err) {
      console.error('Error comparing password hash:', err)
      return false
    }
  }
  
  // Fallback to plain text comparison for migration (old system)
  // This allows existing users to log in before password reset
  if (user.password) {
    if (user.password === password) {
      // Auto-migrate to hashed password on successful login
      console.log('Auto-migrating user to hashed password on login:', user.username)
      try {
        await updateUser(user.id, { password })
      } catch (err) {
        console.warn('Failed to auto-migrate password:', err)
        // Don't fail login if migration fails, user still logged in
      }
      return true
    }
  }
  
  return false
}

export const getActiveAdminCount = async () => {
  const database = await getDb()
  return getScalarValue(
    database.exec("SELECT COUNT(*) as count FROM users WHERE role = 'Admin' AND is_active = 1"),
    0
  )
}

// ── NOTIFICATION FUNCTIONS ──
export const createNotification = async (notification) => {
  try {
    const database = await getDb()
    database.run(
      `INSERT INTO notifications (type, message, product_id)
       VALUES (?, ?, ?)`,
      [notification.type, notification.message, notification.product_id || null]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to create notification:', error)
    throw error
  }
}

export const getActiveNotifications = async () => {
  const database = await getDb()
  const result = database.exec(
    'SELECT * FROM notifications WHERE is_read = 0 ORDER BY created_at DESC'
  )
  return extractResults(result)
}

export const getAllNotifications = async () => {
  const database = await getDb()
  const result = database.exec(
    'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'
  )
  return extractResults(result)
}

export const clearNotificationsForProduct = async (productId) => {
  try {
    const database = await getDb()
    database.run('DELETE FROM notifications WHERE product_id = ?', [productId])
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to clear notifications:', error)
    throw error
  }
}

export const markNotificationAsRead = async (id) => {
  try {
    const database = await getDb()
    database.run('UPDATE notifications SET is_read = 1 WHERE id = ?', [id])
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to mark notification as read:', error)
    throw error
  }
}

// ── STATS FUNCTIONS ──
export const getDashboardStats = async () => {
  const database = await getDb()
  const today = new Date().toISOString().split('T')[0]
  
  const productCount = getScalarValue(
    database.exec('SELECT COUNT(*) as count FROM products'),
    0
  )
  
  const lowStockCount = getScalarValue(
    database.exec('SELECT COUNT(*) as count FROM products WHERE current_quantity <= reorder_level'),
    0
  )
  
  const stockValue = getScalarValue(
    database.exec(`
      SELECT COALESCE(SUM(p.current_quantity * COALESCE(
        (SELECT cost_per_unit FROM stock_receivings WHERE product_id = p.id ORDER BY date_received DESC LIMIT 1),
        0
      )), 0) as value FROM products p
    `),
    0
  )
  
  const todaySales = getScalarValue(
    database.exec(`SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at) = ?`, [today]),
    0
  )
  
  const todayExpenses = getScalarValue(
    database.exec(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date(date) = ?`, [today]),
    0
  )
  
  const customerCount = getScalarValue(
    database.exec('SELECT COUNT(*) as count FROM customers'),
    0
  )
  
  return {
    productCount,
    lowStockCount,
    stockValue,
    todaySales,
    todayExpenses,
    customerCount
  }
}

// ── REPORT FUNCTIONS ──
export const getSalesForDay = async (date) => {
  const database = await getDb()
  const result = database.exec(
    `SELECT s.*, GROUP_CONCAT(si.product_name || ' x' || si.quantity) as items 
     FROM sales s
     LEFT JOIN sale_items si ON s.id = si.sale_id
     WHERE date(s.created_at) = ?
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    [date]
  )
  return extractResults(result)
}

export const getDailyRevenue = async (date) => {
  const database = await getDb()
  return getScalarValue(
    database.exec(`SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at) = ?`, [date]),
    0
  )
}

export const getDailyCOGS = async (date) => {
  const database = await getDb()
  return getScalarValue(
    database.exec(
      `SELECT COALESCE(SUM(quantity * cost_price), 0) as total FROM sale_items 
       WHERE sale_id IN (SELECT id FROM sales WHERE date(created_at) = ?)`,
      [date]
    ),
    0
  )
}

export const getMonthlyData = async (year, month) => {
  const database = await getDb()
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(year, month, 0).toISOString().split('T')[0]
  
  const result = database.exec(
    `SELECT DATE(created_at) as date, SUM(total) as revenue FROM sales 
     WHERE DATE(created_at) BETWEEN ? AND ?
     GROUP BY DATE(created_at)
     ORDER BY DATE(created_at)`,
    [startDate, endDate]
  )
  return extractResults(result)
}

export const getRecentTransactions = async (limit = 10) => {
  const database = await getDb()
  
  const sales = database.exec(
    `SELECT id, 'Sale' as type, total as amount, created_at, cashier as recorded_by FROM sales ORDER BY created_at DESC LIMIT ?`,
    [limit]
  )
  
  const receivings = database.exec(
    `SELECT id, 'Stock Received' as type, total_value as amount, created_at, recorded_by FROM stock_receivings ORDER BY created_at DESC LIMIT ?`,
    [limit]
  )
  
  const salesData = extractResults(sales)
  const receivingsData = extractResults(receivings)
  
  const combined = [...salesData, ...receivingsData].sort((a, b) => 
    new Date(b.created_at) - new Date(a.created_at)
  ).slice(0, limit)
  
  return combined
}

export const getLowStockItems = async () => {
  const database = await getDb()
  const result = database.exec(
    `SELECT * FROM products WHERE current_quantity <= reorder_level ORDER BY current_quantity ASC`
  )
  return extractResults(result)
}

// ── SHIFT FUNCTIONS ──

/**
 * Open a new shift for a cashier
 * @param {number} cashierId - User ID
 * @param {string} cashierName - User name
 * @param {number} startFloat - Opening cash amount
 * @param {string} openingNotes - Optional opening notes
 * @returns {Promise<number>} - Shift ID
 */
export const openShift = async (cashierId, cashierName, startFloat, openingNotes = '') => {
  try {
    const database = await getDb()
    const startTime = new Date().toISOString()
    
    database.run(
      `INSERT INTO shifts (cashier_id, cashier_name, start_time, start_float, status, opening_notes)
       VALUES (?, ?, ?, ?, 'open', ?)`,
      [cashierId, cashierName, startTime, startFloat, openingNotes]
    )
    
    saveDb()
    
    // Get the new shift ID
    const result = database.exec('SELECT last_insert_rowid() as id')
    const shiftId = extractResults(result)[0]?.id
    
    return shiftId
  } catch (error) {
    console.error('Failed to open shift:', error)
    throw error
  }
}



/**
 * Close a shift and reconcile totals
 * @param {number} shiftId - Shift ID
 * @param {number} endFloat - Closing cash amount
 * @param {string} notes - Optional notes
 * @returns {Promise<Object>} - Shift details with balance info
 */
export const closeShift = async (shiftId, endFloat, notes = '') => {
  try {
    const database = await getDb()
    const endTime = new Date().toISOString()
    
    // Get the shift
    const shift = await getShiftById(shiftId)
    if (!shift) {
      throw new Error('Shift not found')
    }
    
    // Calculate totals for this shift
    const salesStmt = database.prepare(
      `SELECT SUM(total) as total FROM sales WHERE shift_id = ? AND status = 'completed'`
    )
    salesStmt.bind([shiftId])
    const salesResults = []
    while (salesStmt.step()) {
      salesResults.push(salesStmt.getAsObject())
    }
    salesStmt.free()
    const totalSales = salesResults[0]?.total || 0
    
    const expensesStmt = database.prepare(
      `SELECT SUM(amount) as total FROM expenses WHERE shift_id = ?`
    )
    expensesStmt.bind([shiftId])
    const expensesResults = []
    while (expensesStmt.step()) {
      expensesResults.push(expensesStmt.getAsObject())
    }
    expensesStmt.free()
    const totalExpenses = expensesResults[0]?.total || 0
    
    // Update shift with closure info
    database.run(
      `UPDATE shifts SET end_time = ?, end_float = ?, total_sales = ?, total_expenses = ?, status = 'closed', notes = ? WHERE id = ?`,
      [endTime, endFloat, totalSales, totalExpenses, notes, shiftId]
    )
    
    saveDb()
    
    // Return shift with balance info
    return {
      ...shift,
      end_time: endTime,
      end_float: endFloat,
      total_sales: totalSales,
      total_expenses: totalExpenses,
      expected_cash: shift.start_float + totalSales - totalExpenses,
      actual_cash: endFloat,
      balance: endFloat - (shift.start_float + totalSales - totalExpenses)
    }
  } catch (error) {
    console.error('Failed to close shift:', error)
    throw error
  }
}

/**
 * Update shift fields
 * @param {number} shiftId - Shift ID
 * @param {Object} updates - Object with fields to update
 * @returns {Promise<void>}
 */
export const updateShift = async (shiftId, updates) => {
  try {
    const database = await getDb()
    
    // Build dynamic SET clause
    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ')
    
    const values = [...Object.values(updates), shiftId]
    
    database.run(
      `UPDATE shifts SET ${setClause} WHERE id = ?`,
      values
    )
    
    await new Promise(resolve => setTimeout(resolve, 50))
    saveDb()
  } catch (error) {
    console.error('Failed to update shift:', error)
    throw error
  }
}

/**
 * Get a shift by ID
 * @param {number} shiftId - Shift ID
 * @returns {Promise<Object|null>} - Shift details or null
 */
export const getShiftById = async (shiftId) => {
  try {
    const database = await getDb()
    const stmt = database.prepare('SELECT * FROM shifts WHERE id = ?')
    stmt.bind([shiftId])
    const result = []
    while (stmt.step()) {
      result.push(stmt.getAsObject())
    }
    stmt.free()
    return result.length > 0 ? result[0] : null
  } catch (error) {
    console.error('Failed to get shift:', error)
    return null
  }
}

/**
 * Get current open shift for a cashier
 * @param {number} cashierId - User ID
 * @returns {Promise<Object|null>} - Current open shift or null
 */
export const getCurrentShift = async (cashierId) => {
  try {
    const database = await getDb()
    const stmt = database.prepare(
      `SELECT * FROM shifts WHERE cashier_id = ? AND status = 'open' ORDER BY start_time DESC LIMIT 1`
    )
    stmt.bind([cashierId])
    const result = []
    while (stmt.step()) {
      result.push(stmt.getAsObject())
    }
    stmt.free()
    return result.length > 0 ? result[0] : null
  } catch (error) {
    console.error('Failed to get current shift:', error)
    return null
  }
}

/**
 * Get all shifts for a cashier (optionally filtered by status)
 * @param {number} cashierId - User ID
 * @param {string} status - 'open' | 'closed' | null for all
 * @returns {Promise<Array>} - Array of shifts
 */
export const getShiftsByCashier = async (cashierId, status = null) => {
  try {
    const database = await getDb()
    let query = 'SELECT * FROM shifts WHERE cashier_id = ?'
    const params = [cashierId]
    
    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }
    
    query += ' ORDER BY start_time DESC'
    
    const stmt = database.prepare(query)
    stmt.bind(params)
    const result = []
    while (stmt.step()) {
      result.push(stmt.getAsObject())
    }
    stmt.free()
    return result
  } catch (error) {
    console.error('Failed to get shifts for cashier:', error)
    return []
  }
}

/**
 * Get all shifts (optionally filtered by status or date range)
 * @param {string} status - 'open' | 'closed' | null for all
 * @param {string} fromDate - ISO date string (optional)
 * @param {string} toDate - ISO date string (optional)
 * @returns {Promise<Array>} - Array of shifts
 */
export const getAllShifts = async (status = null, fromDate = null, toDate = null) => {
  try {
    const database = await getDb()
    let query = 'SELECT * FROM shifts WHERE 1 = 1'
    const params = []
    
    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }
    
    if (fromDate) {
      query += ' AND start_time >= ?'
      params.push(fromDate)
    }
    
    if (toDate) {
      query += ' AND start_time <= ?'
      params.push(toDate)
    }
    
    query += ' ORDER BY start_time DESC'
    
    const stmt = database.prepare(query)
    stmt.bind(params)
    const result = []
    while (stmt.step()) {
      result.push(stmt.getAsObject())
    }
    stmt.free()
    return result
  } catch (error) {
    console.error('Failed to get all shifts:', error)
    return []
  }
}

/**
 * Get shift summary with sales and expenses
 * @param {number} shiftId - Shift ID
 * @returns {Promise<Object>} - Shift with calculated totals
 */
export const getShiftSummary = async (shiftId) => {
  try {
    const shift = await getShiftById(shiftId)
    if (!shift) {
      throw new Error('Shift not found')
    }
    
    const database = await getDb()
    
    // Get completed sales
    const salesStmt = database.prepare(
      `SELECT SUM(total) as total, COUNT(*) as count FROM sales WHERE shift_id = ? AND status = 'completed'`
    )
    salesStmt.bind([shiftId])
    const salesResults = []
    while (salesStmt.step()) {
      salesResults.push(salesStmt.getAsObject())
    }
    salesStmt.free()
    const salesData = salesResults[0] || { total: 0, count: 0 }
    
    // Get expenses
    const expensesStmt = database.prepare(
      `SELECT SUM(amount) as total, COUNT(*) as count FROM expenses WHERE shift_id = ?`
    )
    expensesStmt.bind([shiftId])
    const expensesResults = []
    while (expensesStmt.step()) {
      expensesResults.push(expensesStmt.getAsObject())
    }
    expensesStmt.free()
    const expensesData = expensesResults[0] || { total: 0, count: 0 }
    
    // Get held sales
    const heldStmt = database.prepare(
      `SELECT COUNT(*) as count FROM sales WHERE shift_id = ? AND status = 'held'`
    )
    heldStmt.bind([shiftId])
    const heldResults = []
    while (heldStmt.step()) {
      heldResults.push(heldStmt.getAsObject())
    }
    heldStmt.free()
    const heldCount = heldResults[0]?.count || 0
    
    // Calculate balance
    const expectedCash = shift.start_float + salesData.total - expensesData.total
    const actualCash = shift.end_float || 0
    const balance = actualCash - expectedCash
    
    return {
      ...shift,
      sales: {
        count: salesData.count,
        total: salesData.total
      },
      expenses: {
        count: expensesData.count,
        total: expensesData.total
      },
      held_count: heldCount,
      expected_cash: expectedCash,
      actual_cash: actualCash,
      balance: balance,
      is_balanced: Math.abs(balance) < 0.01 // Allow 1 cent rounding error
    }
  } catch (error) {
    console.error('Failed to get shift summary:', error)
    throw error
  }
}

// ── PHASE 3: DEAD STOCK, RESTOCK & SUPPLIERS ──

/**
 * Get dead stock products (not sold for X days)
 * @param {number} days - Days since last sale (default 30)
 * @returns {Promise<Array>} - Products with no sales for X+ days
 */
export const getDeadStockProducts = async (days = 30) => {
  try {
    const database = await getDb()
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    
    const result = database.exec(`
      SELECT p.*, COUNT(si.id) as sales_count, MAX(si.id) as last_sale_id
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id AND si.id IN (
        SELECT id FROM sale_items ORDER BY id DESC
      )
      WHERE p.current_quantity > 0 
      AND (p.last_sold_date IS NULL OR p.last_sold_date < ?)
      GROUP BY p.id
      ORDER BY p.last_sold_date ASC
    `, [cutoffDate])
    
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get dead stock:', error)
    return []
  }
}

/**
 * Get products below reorder level
 * @returns {Promise<Array>} - Products below reorder_level
 */
export const getRestockNeeded = async () => {
  try {
    const database = await getDb()
    const result = database.exec(`
      SELECT p.*, 
        (p.reorder_level - p.current_quantity) as shortfall,
        COALESCE(s.name, 'No Supplier') as supplier_name
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.current_quantity <= p.reorder_level
      ORDER BY shortfall DESC
    `)
    
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get restock needed:', error)
    return []
  }
}

/**
 * Get sales velocity for products (units sold per day)
 * @param {number} days - Time period to analyze (default 30)
 * @returns {Promise<Array>} - Products with sales velocity
 */
export const getProductSalesVelocity = async (days = 30) => {
  try {
    const database = await getDb()
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    
    const result = database.exec(`
      SELECT 
        p.id, p.name, p.current_quantity, p.reorder_level,
        COUNT(si.id) as units_sold,
        SUM(si.quantity) as total_quantity_sold,
        ROUND(CAST(SUM(si.quantity) AS FLOAT) / ?, 2) as velocity_per_day,
        MAX(si.id) as last_sale_id
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id 
      LEFT JOIN sales s ON si.sale_id = s.id AND s.created_at >= ?
      GROUP BY p.id
      HAVING total_quantity_sold > 0
      ORDER BY velocity_per_day DESC
    `, [days, startDate])
    
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get sales velocity:', error)
    return []
  }
}

/**
 * Update product last_sold_date when a sale is completed
 * @param {number} productId - Product ID
 */
export const updateProductLastSoldDate = async (productId) => {
  try {
    const database = await getDb()
    const now = new Date().toISOString()
    database.run(
      'UPDATE products SET last_sold_date = ? WHERE id = ?',
      [now, productId]
    )
    saveDb()
  } catch (error) {
    console.error('Failed to update product last sold date:', error)
  }
}

/**
 * Get supplier purchase history
 * @param {number} supplierId - Supplier ID
 * @returns {Promise<Array>} - Purchase history
 */
export const getSupplierPurchaseHistory = async (supplierId) => {
  try {
    const database = await getDb()
    const result = database.exec(`
      SELECT sr.*, p.name as product_name, p.current_quantity
      FROM stock_receivings sr
      LEFT JOIN products p ON sr.product_id = p.id
      WHERE sr.supplier_id = ?
      ORDER BY sr.date_received DESC
    `, [supplierId])
    
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get supplier history:', error)
    return []
  }
}

/**
 * Get product purchase history (which suppliers sold it)
 * @param {number} productId - Product ID
 * @returns {Promise<Array>} - Purchase history from all suppliers
 */
export const getProductPurchaseHistory = async (productId) => {
  try {
    const database = await getDb()
    const result = database.exec(`
      SELECT sr.*, s.name as supplier_name, s.contact_person, s.phone
      FROM stock_receivings sr
      LEFT JOIN suppliers s ON sr.supplier_id = s.id
      WHERE sr.product_id = ?
      ORDER BY sr.date_received DESC
    `, [productId])
    
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get product purchase history:', error)
    return []
  }
}

/**
 * Get manager analytics dashboard data
 * @returns {Promise<Object>} - Analytics summary
 */
export const getManagerAnalytics = async () => {
  try {
    const database = await getDb()
    
    // Total revenue
    const revenueResult = database.exec(`
      SELECT SUM(total) as total FROM sales WHERE status = 'completed'
    `)
    const totalRevenue = extractResults(revenueResult)[0]?.total || 0
    
    // Inventory value
    const inventoryResult = database.exec(`
      SELECT SUM(current_quantity * cost_price) as value FROM (
        SELECT p.id, p.current_quantity, COALESCE(sr.cost_per_unit, 0) as cost_price
        FROM products p
        LEFT JOIN stock_receivings sr ON p.id = sr.product_id
        ORDER BY sr.id DESC
      )
    `)
    const inventoryValue = extractResults(inventoryResult)[0]?.value || 0
    
    // Product count
    const productCountResult = database.exec(`
      SELECT COUNT(*) as count FROM products
    `)
    const productCount = extractResults(productCountResult)[0]?.count || 0
    
    // Dead stock count (30+ days)
    const deadStockResult = database.exec(`
      SELECT COUNT(*) as count FROM products 
      WHERE current_quantity > 0 
      AND (last_sold_date IS NULL OR last_sold_date < datetime('now', '-30 days'))
    `)
    const deadStockCount = extractResults(deadStockResult)[0]?.count || 0
    
    // Understocked count
    const understockedResult = database.exec(`
      SELECT COUNT(*) as count FROM products WHERE current_quantity <= reorder_level
    `)
    const understockedCount = extractResults(understockedResult)[0]?.count || 0
    
    return {
      totalRevenue,
      inventoryValue,
      productCount,
      deadStockCount,
      understockedCount
    }
  } catch (error) {
    console.error('Failed to get manager analytics:', error)
    return {}
  }
}

// ── PHASE 4: DIRECT PURCHASES & EXPIRY TRACKING ──

/**
 * Record a direct purchase (stock added without sale)
 * @param {Object} purchase - { product_id, quantity, cost_per_unit, notes, recorded_by }
 */
export const recordDirectPurchase = async (purchase) => {
  try {
    const database = await getDb()
    const date = new Date().toISOString()
    
    // Get current quantity
    const productResult = database.exec(
      'SELECT current_quantity FROM products WHERE id = ?',
      [purchase.product_id]
    )
    const product = extractResults(productResult)[0]
    const newQuantity = (product?.current_quantity || 0) + purchase.quantity
    
    // Update product quantity
    database.run(
      'UPDATE products SET current_quantity = ? WHERE id = ?',
      [newQuantity, purchase.product_id]
    )
    
    // Record in stock movements for audit trail
    database.run(`
      INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by, created_at)
      VALUES (?, (SELECT name FROM products WHERE id = ?), 'DIRECT_PURCHASE', ?, ?, ?, ?)
    `, [purchase.product_id, purchase.product_id, purchase.quantity, purchase.notes || '', purchase.recorded_by, date])
    
    saveDb()
  } catch (error) {
    console.error('Failed to record direct purchase:', error)
    throw error
  }
}

/**
 * Get products expiring soon
 * @param {number} days - Days until expiry to show (default 7)
 * @returns {Promise<Array>} - Products expiring within X days
 */
export const getExpiringProducts = async (days = 7) => {
  try {
    const database = await getDb()
    const cutoffDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    const today = new Date().toISOString().split('T')[0]
    
    const result = database.exec(`
      SELECT p.*, si.expiry_date,
        CAST((substr(si.expiry_date, 1, 10) || ' 23:59:59') AS NUMERIC) as expiry_timestamp,
        (julianday(si.expiry_date) - julianday('now')) as days_until_expiry
      FROM products p
      JOIN sale_items si ON p.id = si.product_id
      WHERE si.expiry_date IS NOT NULL 
      AND si.expiry_date <= ?
      AND si.expiry_date >= ?
      ORDER BY si.expiry_date ASC
    `, [cutoffDate, today])
    
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get expiring products:', error)
    return []
  }
}

/**
 * Get expired products
 * @returns {Promise<Array>} - Products past expiry date
 */
export const getExpiredProducts = async () => {
  try {
    const database = await getDb()
    const today = new Date().toISOString().split('T')[0]
    
    const result = database.exec(`
      SELECT p.*, si.expiry_date,
        (julianday('now') - julianday(si.expiry_date)) as days_expired
      FROM products p
      JOIN sale_items si ON p.id = si.product_id
      WHERE si.expiry_date IS NOT NULL 
      AND si.expiry_date < ?
      GROUP BY p.id
      ORDER BY si.expiry_date DESC
    `, [today])
    
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get expired products:', error)
    return []
  }
}

/**
 * Get expiry report (summary of expiring/expired products)
 * @returns {Promise<Object>} - Expiry summary
 */

// ── RECEIPT NUMBER FUNCTIONS ──

/**
 * Get the last receipt number to determine next counter
 * @returns {Promise<string|null>} - Last receipt number or null
 */
export const getLastReceiptNumber = async () => {
  try {
    const database = await getDb()
    const result = database.exec(`
      SELECT receipt_number FROM sales 
      WHERE receipt_number IS NOT NULL
      ORDER BY created_at DESC 
      LIMIT 1
    `)
    const rows = extractResults(result)
    return rows.length > 0 ? rows[0].receipt_number : null
  } catch (error) {
    console.error('Failed to get last receipt number:', error)
    return null
  }
}

/**
 * Get receipt by ID for reprinting
 * @param {number} saleId - Sale ID
 * @returns {Promise<Object>} - Sale and items data
 */
export const getReceiptBySaleId = async (saleId) => {
  try {
    const database = await getDb()
    
    // Get sale
    const saleResult = database.exec(
      'SELECT * FROM sales WHERE id = ?',
      [saleId]
    )
    const sales = extractResults(saleResult)
    if (sales.length === 0) return null
    
    const sale = sales[0]
    
    // Get items for this sale
    const itemsResult = database.exec(
      'SELECT * FROM sale_items WHERE sale_id = ?',
      [saleId]
    )
    const items = extractResults(itemsResult)
    
    return {
      ...sale,
      items: items
    }
  } catch (error) {
    console.error('Failed to get receipt:', error)
    return null
  }
}

/**
 * Update sale with receipt number
 * @param {number} saleId - Sale ID
 * @param {string} receiptNumber - Receipt number to store
 * @returns {Promise<void>}
 */
export const updateSaleReceiptNumber = async (saleId, receiptNumber) => {
  try {
    const database = await getDb()
    database.run(
      'UPDATE sales SET receipt_number = ? WHERE id = ?',
      [receiptNumber, saleId]
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    saveDb()
  } catch (error) {
    console.error('Failed to update receipt number:', error)
    throw error
  }
}
export const getExpiryReport = async () => {
  try {
    const database = await getDb()
    const today = new Date().toISOString()
    const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    
    // Expired
    const expiredResult = database.exec(`
      SELECT COUNT(*) as count FROM sale_items 
      WHERE expiry_date IS NOT NULL AND expiry_date < date('now')
    `)
    const expiredCount = extractResults(expiredResult)[0]?.count || 0
    
    // Expiring this week
    const expiringWeekResult = database.exec(`
      SELECT COUNT(*) as count FROM sale_items 
      WHERE expiry_date IS NOT NULL AND expiry_date >= date('now') AND expiry_date <= ?
    `, [week])
    const expiringWeekCount = extractResults(expiringWeekResult)[0]?.count || 0
    
    // Expiring next month
    const expiringMonthResult = database.exec(`
      SELECT COUNT(*) as count FROM sale_items 
      WHERE expiry_date IS NOT NULL AND expiry_date > ? AND expiry_date <= ?
    `, [week, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()])
    const expiringMonthCount = extractResults(expiringMonthResult)[0]?.count || 0
    
    return {
      expired: expiredCount,
      expiringThisWeek: expiringWeekCount,
      expiringThisMonth: expiringMonthCount
    }
  } catch (error) {
    console.error('Failed to get expiry report:', error)
    return {}
  }
}

// ── PHASE 5: CASHIER SESSION & FLOAT MANAGEMENT ──

/**
 * Create a hold for current shift (session-scoped)
 * @param {number} shiftId - Current shift ID
 * @param {number} productId - Product ID
 * @param {number} quantity - Quantity held
 * @returns {Promise<Object>} - Hold record
 */
export const createHold = async (shiftId, productId, quantity) => {
  try {
    const database = await getDb()
    database.run(
      `INSERT INTO sale_holds (shift_id, product_id, quantity) VALUES (?, ?, ?)`,
      [shiftId, productId, quantity]
    )
    await new Promise(resolve => setTimeout(resolve, 50))
    saveDb()
    
    const result = database.exec(`SELECT * FROM sale_holds WHERE shift_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1`, [shiftId, productId])
    return extractResults(result)[0]
  } catch (error) {
    console.error('Failed to create hold:', error)
    throw error
  }
}

/**
 * Get all holds for a specific shift
 * @param {number} shiftId - Shift ID
 * @returns {Promise<Array>} - Array of holds for this shift only
 */
export const getHoldsByShift = async (shiftId) => {
  try {
    const database = await getDb()
    const result = database.exec(
      `SELECT sh.*, p.name as product_name, p.current_quantity 
       FROM sale_holds sh
       LEFT JOIN products p ON sh.product_id = p.id
       WHERE sh.shift_id = ? 
       ORDER BY sh.held_at DESC`,
      [shiftId]
    )
    return extractResults(result)
  } catch (error) {
    console.error('Failed to get holds:', error)
    return []
  }
}

/**
 * Delete all holds for a shift (called when cashier logs out)
 * @param {number} shiftId - Shift ID to clear holds for
 * @returns {Promise<void>}
 */
export const deleteHoldsOnLogout = async (shiftId) => {
  try {
    const database = await getDb()
    database.run(`DELETE FROM sale_holds WHERE shift_id = ?`, [shiftId])
    await new Promise(resolve => setTimeout(resolve, 50))
    saveDb()
  } catch (error) {
    console.error('Failed to delete holds:', error)
    throw error
  }
}

/**
 * Release a specific hold
 * @param {number} holdId - Hold ID
 * @returns {Promise<void>}
 */
export const releaseHold = async (holdId) => {
  try {
    const database = await getDb()
    database.run(`DELETE FROM sale_holds WHERE id = ?`, [holdId])
    await new Promise(resolve => setTimeout(resolve, 50))
    saveDb()
  } catch (error) {
    console.error('Failed to release hold:', error)
    throw error
  }
}