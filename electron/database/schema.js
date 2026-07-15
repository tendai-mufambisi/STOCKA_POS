const bcrypt = require('bcryptjs')

const CURRENT_DB_VERSION = 4

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      currency TEXT DEFAULT 'USD',
      setup_complete INTEGER DEFAULT 0,
      printer_name TEXT,
      printer_port TEXT,
      auto_print INTEGER DEFAULT 1,
      print_duplicate INTEGER DEFAULT 0,
      receipt_width_mm INTEGER DEFAULT 58,
      receipt_footer TEXT DEFAULT 'Thank you for your business!',
      vat_rate REAL DEFAULT 0,
      default_reorder_level INTEGER DEFAULT 5,
      variance_tolerance REAL DEFAULT 0.01,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      last_login TEXT,
      current_shift_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT CHECK (category IN ('Food', 'Non-Food', 'Drinks')),
      supplier_id INTEGER,
      unit TEXT DEFAULT 'each' CHECK (unit IN ('each', 'pack')),
      selling_price REAL DEFAULT 0,
      reorder_level INTEGER DEFAULT 5,
      description TEXT,
      current_quantity INTEGER DEFAULT 0,
      image_data TEXT,
      last_sold_date TEXT,
      shop_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_receivings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER,
      product_id INTEGER NOT NULL,
      date_received TEXT NOT NULL,
      cartons INTEGER NOT NULL,
      units_per_carton INTEGER NOT NULL,
      total_units INTEGER NOT NULL,
      cost_per_carton REAL NOT NULL,
      cost_per_unit REAL NOT NULL,
      total_value REAL NOT NULL,
      recorded_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      note TEXT,
      recorded_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier TEXT NOT NULL,
      branch_id INTEGER,
      total REAL NOT NULL,
      cash_tendered REAL NOT NULL,
      change_given REAL NOT NULL,
      payment_method TEXT DEFAULT 'Cash',
      cash_amount REAL DEFAULT 0,
      usd_amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      note TEXT,
      status TEXT DEFAULT 'completed',
      held_name TEXT,
      held_at TEXT,
      released_from_hold_at TEXT,
      void_reason TEXT,
      voided_by TEXT,
      voided_at TEXT,
      shift_id INTEGER,
      receipt_number TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      cost_price REAL NOT NULL,
      selling_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      expiry_date TEXT
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      recorded_by TEXT NOT NULL,
      shift_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      product_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

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
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      manager_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier_username TEXT NOT NULL,
      cashier_display_name TEXT NOT NULL,
      branch_id INTEGER,
      status TEXT DEFAULT 'open',
      opening_cash REAL DEFAULT 0,
      opening_usd REAL DEFAULT 0,
      total_sales_count INTEGER DEFAULT 0,
      total_sales_value REAL DEFAULT 0,
      closing_cash REAL,
      closing_usd REAL,
      variance REAL,
      usd_variance REAL,
      reconciliation_status TEXT DEFAULT 'pending',
      notes TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sale_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      held_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shift_id) REFERENCES shifts(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS transaction_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      old_value TEXT,
      new_value TEXT,
      description TEXT,
      machine_name TEXT,
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

function runMigrations(db) {
  try {
    const addColIfMissing = (table, column, def) => {
      const info = db.pragma(`table_info(${table})`)
      if (!info.find(c => c.name === column)) {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`).run()
      }
    }

    // users
    addColIfMissing('users', 'is_active', 'INTEGER DEFAULT 1')
    addColIfMissing('users', 'created_by', 'TEXT')
    addColIfMissing('users', 'last_login', 'TEXT')
    addColIfMissing('users', 'password_hash', 'TEXT')
    addColIfMissing('users', 'current_shift_id', 'INTEGER')

    // sales
    addColIfMissing('sales', 'payment_method', "TEXT DEFAULT 'Cash'")
    addColIfMissing('sales', 'cash_amount', 'REAL DEFAULT 0')
    addColIfMissing('sales', 'usd_amount', 'REAL DEFAULT 0')
    addColIfMissing('sales', 'currency', "TEXT DEFAULT 'USD'")
    addColIfMissing('sales', 'status', "TEXT DEFAULT 'completed'")
    addColIfMissing('sales', 'held_name', 'TEXT')
    addColIfMissing('sales', 'held_at', 'TEXT')
    addColIfMissing('sales', 'released_from_hold_at', 'TEXT')
    addColIfMissing('sales', 'void_reason', 'TEXT')
    addColIfMissing('sales', 'voided_by', 'TEXT')
    addColIfMissing('sales', 'voided_at', 'TEXT')
    addColIfMissing('sales', 'shift_id', 'INTEGER')
    addColIfMissing('sales', 'receipt_number', 'TEXT')
    // Which till (Main='M' or satellite='S1','S2'…) rang this sale up — local-only
    // identity, never reassigned, used to scope receipt numbering per-till so two
    // machines can never issue the same receipt number.
    addColIfMissing('sales', 'till_code', 'TEXT')

    // products
    addColIfMissing('products', 'shop_id', 'TEXT')
    addColIfMissing('products', 'image_data', 'TEXT')
    addColIfMissing('products', 'last_sold_date', 'TEXT')

    // transaction_audit_log
    addColIfMissing('transaction_audit_log', 'machine_name', 'TEXT')

    // stock_receivings — corrections are append-only rows whose total_units/total_value
    // hold the signed delta and which point at the receiving they correct
    addColIfMissing('stock_receivings', 'corrects_receiving_id', 'INTEGER')
    addColIfMissing('stock_receivings', 'correction_reason', 'TEXT')

    // expenses
    addColIfMissing('expenses', 'shift_id', 'INTEGER')

    // sale_items
    addColIfMissing('sale_items', 'expiry_date', 'TEXT')

    // shops
    addColIfMissing('shops', 'printer_name', 'TEXT')
    addColIfMissing('shops', 'printer_port', 'TEXT')
    addColIfMissing('shops', 'auto_print', 'INTEGER DEFAULT 1')
    addColIfMissing('shops', 'print_duplicate', 'INTEGER DEFAULT 0')
    addColIfMissing('shops', 'receipt_width_mm', 'INTEGER DEFAULT 58')
    addColIfMissing('shops', 'receipt_footer', "TEXT DEFAULT 'Thank you for your business!'")
    addColIfMissing('shops', 'receipt_name_size', "TEXT DEFAULT 'large'")
    addColIfMissing('shops', 'vat_rate', 'REAL DEFAULT 0')
    addColIfMissing('shops', 'default_reorder_level', 'INTEGER DEFAULT 5')
    addColIfMissing('shops', 'variance_tolerance', 'REAL DEFAULT 0.01')
    // 0 = admins cannot sell (default) — grantable via Settings → Business Rules
    addColIfMissing('shops', 'allow_admin_sales', 'INTEGER DEFAULT 0')
    // JSON per-role sidebar overrides, e.g. {"Cashier":{"my-transactions":false}}
    // NULL = defaults from src/utils/rolePrivileges.js — set via Settings → Role Privileges
    addColIfMissing('shops', 'role_privileges', 'TEXT')

    // expenses
    addColIfMissing('expenses', 'payment_method', "TEXT DEFAULT 'Cash'")

    // shifts — rebuild if old schema missing cashier_username
    const shiftCols = db.pragma('table_info(shifts)').map(c => c.name)
    if (shiftCols.length > 0 && !shiftCols.includes('cashier_username')) {
      db.exec(`
        DROP TABLE IF EXISTS shifts;
        CREATE TABLE shifts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cashier_username TEXT NOT NULL,
          cashier_display_name TEXT NOT NULL,
          branch_id INTEGER,
          status TEXT DEFAULT 'open',
          opening_cash REAL DEFAULT 0,
          opening_usd REAL DEFAULT 0,
          total_sales_count INTEGER DEFAULT 0,
          total_sales_value REAL DEFAULT 0,
          closing_cash REAL,
          closing_usd REAL,
          variance REAL,
          usd_variance REAL,
          reconciliation_status TEXT DEFAULT 'pending',
          notes TEXT,
          started_at TEXT DEFAULT (datetime('now')),
          closed_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `)
    } else {
      addColIfMissing('shifts', 'opening_cash', 'REAL DEFAULT 0')
      addColIfMissing('shifts', 'opening_usd', 'REAL DEFAULT 0')
      addColIfMissing('shifts', 'closing_cash', 'REAL')
      addColIfMissing('shifts', 'closing_usd', 'REAL')
      addColIfMissing('shifts', 'variance', 'REAL')
      addColIfMissing('shifts', 'usd_variance', 'REAL')
      addColIfMissing('shifts', 'total_sales_value', 'REAL DEFAULT 0')
    }

    // Normalize legacy payment_method values to 'Cash' or 'USD'
    try {
      db.prepare(`UPDATE sales SET payment_method = 'USD' WHERE payment_method IN ('USD Cash', 'Swipe') AND payment_method NOT IN ('Cash', 'USD', 'Split')`).run()
      db.prepare(`UPDATE sales SET payment_method = 'Cash' WHERE payment_method NOT IN ('Cash', 'USD', 'Split')`).run()
      // Backfill cash_amount / usd_amount for old rows that have no split data yet
      db.prepare(`UPDATE sales SET usd_amount = total WHERE payment_method = 'USD' AND usd_amount = 0 AND cash_amount = 0`).run()
      db.prepare(`UPDATE sales SET cash_amount = total WHERE payment_method = 'Cash' AND cash_amount = 0 AND usd_amount = 0`).run()
      db.prepare(`UPDATE sales SET cash_amount = total, usd_amount = 0 WHERE payment_method = 'Split' AND cash_amount = 0 AND usd_amount = 0`).run()
    } catch (_) {}

    // Migrate stock_receivings.supplier_id to nullable if NOT NULL
    try {
      const srCols = db.pragma('table_info(stock_receivings)')
      const supplierCol = srCols.find(c => c.name === 'supplier_id')
      if (supplierCol && supplierCol.notnull === 1) {
        db.transaction(() => {
          db.exec(`
            CREATE TABLE stock_receivings_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              supplier_id INTEGER,
              product_id INTEGER NOT NULL,
              date_received TEXT NOT NULL,
              cartons INTEGER NOT NULL,
              units_per_carton INTEGER NOT NULL,
              total_units INTEGER NOT NULL,
              cost_per_carton REAL NOT NULL,
              cost_per_unit REAL NOT NULL,
              total_value REAL NOT NULL,
              recorded_by TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO stock_receivings_new
              SELECT id, supplier_id, product_id, date_received, cartons, units_per_carton,
                     total_units, cost_per_carton, cost_per_unit, total_value, recorded_by, created_at
              FROM stock_receivings;
            DROP TABLE stock_receivings;
            ALTER TABLE stock_receivings_new RENAME TO stock_receivings;
          `)
        })()
      }
    } catch (_) {}

    // Sync columns (future LAN/cloud tier)
    const SYNC_TABLES = ['products', 'sales', 'sale_items', 'stock_movements', 'expenses', 'shifts', 'suppliers', 'users']
    for (const table of SYNC_TABLES) {
      addColIfMissing(table, 'external_id', 'TEXT')
      addColIfMissing(table, 'sync_dirty', 'INTEGER DEFAULT 0')
      addColIfMissing(table, 'sync_updated_at', "TEXT DEFAULT (datetime('now'))")
    }

    // Populate external_id for rows that don't have one
    for (const table of SYNC_TABLES) {
      db.prepare(`
        UPDATE ${table}
        SET external_id = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
            substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) ||
            substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
        WHERE external_id IS NULL
      `).run()
    }

    ensureDefaultAdminUser(db)
  } catch (err) {
    console.warn('Migration error (non-fatal):', err.message)
  }
}

function ensureDefaultAdminUser(db) {
  try {
    const count = db.prepare('SELECT COUNT(*) as n FROM users').pluck().get()
    if (!count) {
      const hash = bcrypt.hashSync('admin123', 10)
      db.prepare(
        `INSERT INTO users (username, password, password_hash, role, is_active, created_by) VALUES (?, ?, ?, 'Admin', 1, 'system')`
      ).run('admin', '', hash)
    }
  } catch (err) {
    console.warn('Failed to ensure default admin user:', err.message)
  }
}

module.exports = { createTables, runMigrations, CURRENT_DB_VERSION }
