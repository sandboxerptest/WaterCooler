/**
 * Brightwater Supply Co. — the fictional ERP the office works inside.
 *
 * A watercooler and office-refreshment distributor, which is on the nose for a
 * game called WaterCooler and gives the data some character.
 *
 * Two rules shape this schema, both because agents will be writing to it:
 *
 *  - Documents carry `created_by`, so a human can always see which seat raised
 *    a quote or logged a call.
 *  - Journal lines are never written by an agent. Tools that create a document
 *    post its double entry themselves, so the books cannot be knocked out of
 *    balance by something an agent invents.
 */

export const ERP_SCHEMA = `
-- ── Parties ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  segment         TEXT NOT NULL,       -- legal, healthcare, education, logistics, hospitality, tech
  city            TEXT NOT NULL,
  country         TEXT NOT NULL,
  payment_terms   INTEGER NOT NULL,    -- days
  credit_limit    REAL NOT NULL,
  on_hold         INTEGER NOT NULL DEFAULT 0,
  since           TEXT NOT NULL,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  primary_contact INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  city           TEXT NOT NULL,
  country        TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL,
  payment_terms  INTEGER NOT NULL,
  notes          TEXT
);

-- ── Catalogue ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,           -- coolers, coffee, consumables, service
  supplier_id INTEGER REFERENCES suppliers(id),
  unit_cost   REAL NOT NULL,
  list_price  REAL NOT NULL,
  unit        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS price_list (
  id           INTEGER PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  segment      TEXT NOT NULL,
  discount_pct REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_levels (
  product_id     INTEGER PRIMARY KEY REFERENCES products(id),
  warehouse      TEXT NOT NULL,
  on_hand        INTEGER NOT NULL,
  reorder_point  INTEGER NOT NULL,
  on_order       INTEGER NOT NULL DEFAULT 0
);

-- ── CRM ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY,
  company     TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email       TEXT NOT NULL,
  source      TEXT NOT NULL,           -- referral, web, trade show, cold call
  status      TEXT NOT NULL,           -- new, working, qualified, disqualified
  owner       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id            INTEGER PRIMARY KEY,
  customer_id   INTEGER REFERENCES customers(id),
  name          TEXT NOT NULL,
  stage         TEXT NOT NULL,         -- qualify, proposal, negotiation, won, lost
  amount        REAL NOT NULL,
  probability   INTEGER NOT NULL,
  expected_close TEXT NOT NULL,
  owner         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  closed_at     TEXT,
  lost_reason   TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id             INTEGER PRIMARY KEY,
  opportunity_id INTEGER REFERENCES opportunities(id),
  customer_id    INTEGER REFERENCES customers(id),
  type           TEXT NOT NULL,        -- call, email, meeting, note
  occurred_at    TEXT NOT NULL,
  owner          TEXT NOT NULL,
  summary        TEXT NOT NULL,
  created_by     TEXT
);

-- ── Sales cycle ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id          INTEGER PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  issued_at   TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status      TEXT NOT NULL,           -- draft, sent, accepted, declined, expired
  subtotal    REAL NOT NULL,
  tax         REAL NOT NULL,
  total       REAL NOT NULL,
  owner       TEXT NOT NULL,
  created_by  TEXT,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS quote_lines (
  id         INTEGER PRIMARY KEY,
  quote_id   INTEGER NOT NULL REFERENCES quotes(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id          INTEGER PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  quote_id    INTEGER REFERENCES quotes(id),
  ordered_at  TEXT NOT NULL,
  status      TEXT NOT NULL,           -- open, shipped, invoiced, cancelled
  total       REAL NOT NULL,
  created_by  TEXT
);

CREATE TABLE IF NOT EXISTS order_lines (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES sales_orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost  REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id          INTEGER PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_id    INTEGER REFERENCES sales_orders(id),
  issued_at   TEXT NOT NULL,
  due_at      TEXT NOT NULL,
  status      TEXT NOT NULL,           -- open, paid, part-paid, overdue, credited
  subtotal    REAL NOT NULL,
  tax         REAL NOT NULL,
  total       REAL NOT NULL,
  paid_total  REAL NOT NULL DEFAULT 0,
  created_by  TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id         INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost  REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  paid_at    TEXT NOT NULL,
  amount     REAL NOT NULL,
  method     TEXT NOT NULL,            -- bank transfer, card, direct debit, cheque
  reference  TEXT
);

-- ── Purchasing ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id          INTEGER PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  ordered_at  TEXT NOT NULL,
  expected_at TEXT NOT NULL,
  status      TEXT NOT NULL,           -- open, received, cancelled
  total       REAL NOT NULL
);

-- ── General ledger ────────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_accounts (
  code    TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  type    TEXT NOT NULL,               -- asset, liability, equity, revenue, expense
  normal  TEXT NOT NULL                -- debit or credit
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id         INTEGER PRIMARY KEY,
  entry_date TEXT NOT NULL,
  memo       TEXT NOT NULL,
  source     TEXT NOT NULL,            -- invoice, payment, purchase, payroll, overhead
  source_ref TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id         INTEGER PRIMARY KEY,
  entry_id   INTEGER NOT NULL REFERENCES journal_entries(id),
  account    TEXT NOT NULL REFERENCES gl_accounts(code),
  debit      REAL NOT NULL DEFAULT 0,
  credit     REAL NOT NULL DEFAULT 0,
  memo       TEXT
);

-- ── Audit ─────────────────────────────────────────────
-- Anything an agent changes is recorded here, so a person can see what the
-- office did while they were away.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_ref TEXT,
  detail     TEXT
);

CREATE INDEX IF NOT EXISTS invoices_by_customer ON invoices (customer_id, issued_at);
CREATE INDEX IF NOT EXISTS lines_by_invoice ON invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS journal_lines_by_entry ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_by_account ON journal_lines (account);
`;

/** The chart of accounts. Small, but enough to keep a real set of books. */
export const GL_ACCOUNTS: Array<{ code: string; name: string; type: string; normal: string }> = [
  { code: "1000", name: "Bank", type: "asset", normal: "debit" },
  { code: "1100", name: "Accounts Receivable", type: "asset", normal: "debit" },
  { code: "1200", name: "Inventory", type: "asset", normal: "debit" },
  { code: "2000", name: "Accounts Payable", type: "liability", normal: "credit" },
  { code: "2100", name: "VAT Payable", type: "liability", normal: "credit" },
  { code: "3000", name: "Share Capital", type: "equity", normal: "credit" },
  { code: "3100", name: "Retained Earnings", type: "equity", normal: "credit" },
  { code: "4000", name: "Equipment Sales", type: "revenue", normal: "credit" },
  { code: "4100", name: "Consumables Sales", type: "revenue", normal: "credit" },
  { code: "4200", name: "Service Revenue", type: "revenue", normal: "credit" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense", normal: "debit" },
  { code: "6000", name: "Wages", type: "expense", normal: "debit" },
  { code: "6100", name: "Rent", type: "expense", normal: "debit" },
  { code: "6200", name: "Vehicles and Delivery", type: "expense", normal: "debit" },
  { code: "6300", name: "Marketing", type: "expense", normal: "debit" },
];

/** Revenue lands in a different account depending on what was sold. */
export function revenueAccountFor(category: string): string {
  if (category === "coolers" || category === "coffee") return "4000";
  if (category === "service") return "4200";
  return "4100";
}
