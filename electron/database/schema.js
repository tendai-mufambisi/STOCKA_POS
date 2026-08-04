const bcrypt = require('bcryptjs')

const CURRENT_DB_VERSION = 6

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

    -- Frozen analytics reports, as JSON ReportDocuments.
    --
    -- Generalises end_of_day.report_snapshot, which already proved the rule:
    -- a report that has been printed and signed off must reprint identically
    -- forever. Recomputing it would let a void entered next week silently
    -- rewrite last month's figures. Once a document lands here, reprint reads
    -- this row and never recomputes.
    --
    -- content_hash covers the document minus generatedAt, so two runs over
    -- unchanged data are provably identical.
    CREATE TABLE IF NOT EXISTS report_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      granularity TEXT,
      scope_key TEXT NOT NULL DEFAULT '',
      document_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      engine_version TEXT,
      schema_version INTEGER,
      quality_confidence TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Per-day inventory valuation, written forward on End of Day close.
    --
    -- Opening/closing stock for a past month is otherwise only obtainable by
    -- rolling stock_movements back from products.current_quantity, which works
    -- but costs a scan per product and depends on the movement ledger being
    -- complete. This is the cache; the reconstruction stays the source of
    -- truth and is used to verify it.
    --
    -- built_from records which path produced the row ('live' | 'reconstructed')
    -- so a report can state how its opening stock was arrived at.
    CREATE TABLE IF NOT EXISTS inventory_daily_snapshots (
      date TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      unit_cost REAL,
      value_at_cost REAL,
      cost_source TEXT,
      built_from TEXT DEFAULT 'live',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (date, product_id)
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
    // expiry tracking lives on receivings (batches) — expiry_discarded_at marks a
    // batch as handled (discarded/written off) so it stops appearing in the tracker
    addColIfMissing('stock_receivings', 'expiry_date', 'TEXT')
    addColIfMissing('stock_receivings', 'expiry_discarded_at', 'TEXT')

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

    // Transfer/EcoCash reconciliation. End of Day has always made the admin COUNT
    // these (it refuses to close until a transfer figure is entered for any shift
    // expecting one) but had nowhere to put the answer — so the number existed only
    // in React state and was discarded on save. That left days recorded as
    // 'Shortage' with difference = 0.00, with the transfer shortfall that caused it
    // unrecoverable. These columns are that missing home. Kept separate from the
    // cash figures on purpose: a cash shortage and a transfer shortage have
    // different causes and different remedies, and summing them hides both.
    addColIfMissing('shifts', 'closing_transfer', 'REAL')
    addColIfMissing('shifts', 'transfer_variance', 'REAL')

    // Which physical till opened this drawer ('M' for Main, 'S1'/'S2'… for
    // satellites). Without it Main has no way to tell whether the machine that
    // holds a shift's cash is still connected — and closing a drawer for a till
    // Main can't see means computing the variance from sales it has never
    // received. Null on shifts opened before this column existed; the close
    // guard treats that as "unknown till" and lets the close proceed.
    addColIfMissing('shifts', 'till_code', 'TEXT')
    addColIfMissing('end_of_day', 'expected_transfer', 'REAL DEFAULT 0')
    addColIfMissing('end_of_day', 'actual_transfer', 'REAL DEFAULT 0')
    addColIfMissing('end_of_day', 'transfer_difference', 'REAL DEFAULT 0')

    // Frozen copy of the printed day summary (JSON): per-cashier lines, payment mix
    // and the reconciliation arithmetic as they stood when the day was signed off.
    // Reprinting from history must reproduce the paper the cash was counted against
    // — rebuilding it from live shifts would let a void entered next week silently
    // rewrite last Tuesday's report.
    addColIfMissing('end_of_day', 'report_snapshot', 'TEXT')

    // end_of_day reached satellites only in the pairing snapshot, so their History
    // froze at the moment they were paired. Re-closing a day updates the row in
    // place without touching created_at, so the delta query needs its own column.
    addColIfMissing('end_of_day', 'sync_updated_at', 'TEXT')

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

    // ── Analytics: data that cannot be recovered retroactively ──────────────
    //
    // Each of these records something the current schema throws away at write
    // time. A discounted sale today is stored as nothing more than a lower
    // selling_price — indistinguishable from a price change — so no future
    // report can ever reconstruct discount history for sales rung up before
    // these columns existed. Adding them now is what makes next year's report
    // possible; adding them later cannot backfill a single row.
    addColIfMissing('sale_items', 'discount_amount', 'REAL DEFAULT 0')
    addColIfMissing('sales', 'discount_total', 'REAL DEFAULT 0')
    addColIfMissing('sales', 'discount_reason', 'TEXT')

    // VAT is currently a single shops.vat_rate. Back-deriving tax for a past
    // period at the CURRENT rate is wrong the moment the rate changes, and
    // Zimbabwe's has. Freezing the rate onto the sale makes each period
    // self-describing.
    addColIfMissing('sales', 'tax_rate', 'REAL DEFAULT 0')
    addColIfMissing('sales', 'tax_amount', 'REAL DEFAULT 0')

    // Stock adjustments record how much but never why, so shrinkage can be
    // measured and not explained. Structured reason codes fix that forward.
    addColIfMissing('stock_movements', 'reason_code', 'TEXT')

    // When a line's cost was filled in AFTER the sale.
    //
    // sale_items.cost_price is frozen at sale time, but a product that had
    // never been received froze a cost of 0 — so the line reports a 100%
    // margin. Once the real cost is known those zeros can be corrected, and a
    // 0 was never a recorded figure in the first place; it was missing data.
    //
    // But a corrected figure must not masquerade as an original one. This stamp
    // is what lets a report say "COGS for this period includes N lines costed
    // after the sale" instead of quietly restating history.
    addColIfMissing('sale_items', 'cost_backfilled_at', 'TEXT')

    // Sync columns (future LAN/cloud tier)
    const SYNC_TABLES = ['products', 'sales', 'sale_items', 'stock_movements', 'expenses', 'shifts', 'suppliers', 'users']
    for (const table of SYNC_TABLES) {
      addColIfMissing(table, 'external_id', 'TEXT')
      addColIfMissing(table, 'sync_dirty', 'INTEGER DEFAULT 0')
      addColIfMissing(table, 'sync_updated_at', "TEXT DEFAULT (datetime('now'))")
    }

    // stock_receivings needs the idempotency key but not the other sync columns —
    // its LAN delta keys off created_at, not sync_updated_at. A satellite write that
    // commits on Main but loses the response gets re-queued, and without a key the
    // replay lands as a second receiving AND a second increase of the product's stock.
    addColIfMissing('stock_receivings', 'external_id', 'TEXT')

    // Populate external_id for rows that don't have one
    for (const table of [...SYNC_TABLES, 'stock_receivings']) {
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

// Indexes for the reporting/analytics engine.
//
// The database shipped with none, so every period aggregate was a full table
// scan — tolerable at 200 sales, not at 200,000.
//
// Deliberately NOT inside runMigrations(): that function wraps its entire body
// in one try/catch, so a single failing statement silently aborts every
// migration after it. Index creation gets its own guard so it can never take
// the column migrations down with it.
//
// Also deliberately not version-gated. Every statement is IF NOT EXISTS, so
// running it on each boot is cheap and idempotent — and it is the only way
// existing v4 installs ever receive these indexes.
//
// Note on sargability: `date(created_at,'localtime')` is a function on the
// column and cannot use an index. Analytics queries pair it with a raw
// `created_at BETWEEN ...` prefilter (see electron/analytics/kernel/time.js)
// so these indexes actually get used; the localtime clause then narrows the
// result exactly. Both clauses are required — see salePeriodPredicate().
const INDEXES = [
  // sales — the spine of every period aggregate
  `CREATE INDEX IF NOT EXISTS idx_sales_status_created  ON sales(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_created         ON sales(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_shift_status    ON sales(shift_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_cashier_created ON sales(cashier, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_till_created    ON sales(till_code, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_receipt         ON sales(receipt_number)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_external        ON sales(external_id)`,

  // sale_items — the COGS join, previously a full scan for every report
  `CREATE INDEX IF NOT EXISTS idx_sale_items_sale       ON sale_items(sale_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sale_items_product    ON sale_items(product_id)`,

  // stock_receivings — cost resolution walks this per product, newest first
  `CREATE INDEX IF NOT EXISTS idx_recv_product_date     ON stock_receivings(product_id, date_received DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_recv_corrects         ON stock_receivings(corrects_receiving_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recv_date             ON stock_receivings(date_received)`,
  `CREATE INDEX IF NOT EXISTS idx_recv_supplier_date    ON stock_receivings(supplier_id, date_received)`,

  // stock_movements — historical inventory reconstruction rolls these back
  `CREATE INDEX IF NOT EXISTS idx_mov_product_created   ON stock_movements(product_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mov_created_type      ON stock_movements(created_at, movement_type)`,

  // expenses / shifts / end_of_day / products
  `CREATE INDEX IF NOT EXISTS idx_expenses_date         ON expenses(date)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_shift        ON expenses(shift_id)`,
  `CREATE INDEX IF NOT EXISTS idx_shifts_started_status ON shifts(started_at, status)`,
  `CREATE INDEX IF NOT EXISTS idx_shifts_cashier        ON shifts(cashier_username, started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_eod_date              ON end_of_day(date)`,
  `CREATE INDEX IF NOT EXISTS idx_products_supplier     ON products(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_reorder      ON products(current_quantity, reorder_level)`,
]

function ensureIndexes(db) {
  let created = 0
  for (const sql of INDEXES) {
    // Per-statement guard: one index referencing a column an old install never
    // got must not stop the other twenty from being created.
    try {
      db.prepare(sql).run()
      created++
    } catch (err) {
      console.warn('Index creation skipped:', sql.split(' ON ')[1] || sql, '—', err.message)
    }
  }
  // Without ANALYZE, SQLite's planner has no statistics and may ignore the
  // indexes it was just given.
  try { db.exec('ANALYZE') } catch (_) {}
  return created
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

module.exports = { createTables, runMigrations, ensureIndexes, CURRENT_DB_VERSION }
