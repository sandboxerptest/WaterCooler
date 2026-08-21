#!/usr/bin/env node
/**
 * Brightwater ERP MCP server — the office's access to company data.
 *
 * How an agent knows this exists: MCP tools arrive in the model's tool list
 * with their descriptions, so simply registering them is the announcement. The
 * seat's system prompt names the company and points here, and `erp_schema`
 * covers the detail, so nothing has to be guessed.
 *
 * Reads are open. Writes are typed — there is no "run this UPDATE" tool —
 * because an agent inventing SQL against a live ledger is how books get broken.
 * Every write is stamped with the seat that made it and recorded in audit_log.
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout (MCP stdio transport).
 */

import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.ERP_DB_PATH ?? ".data/erp.sqlite";
/**
 * What the money is denominated in. Mirrors lib/erp/currency.ts, which a plain
 * .mjs run straight by node cannot import; a test asserts the two agree.
 */
const CURRENCY = { code: "USD", symbol: "$", name: "US dollars" };
const CURRENCY_NOTE = `All money columns are plain numbers in ${CURRENCY.name} (${CURRENCY.code}) — there is no currency column, so quote figures with ${CURRENCY.symbol}.`;

/** Which seat is asking, for the audit trail. */
const ACTOR = process.env.WATERCOOLER_SEAT ?? "unknown agent";

/** Results are capped: one careless SELECT * should not cost a dollar in tokens. */
const MAX_ROWS = 200;
const MAX_CHARS = 12000;

let db;
function database() {
  if (!db) db = new DatabaseSync(DB_PATH);
  return db;
}

// ── Guardrails ─────────────────────────────────────────

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i;

/**
 * Only single, plain SELECTs. Writes go through the typed tools, so anything
 * else here is either a mistake or an attempt to get around them.
 */
function checkReadOnly(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.includes(";")) return "Only one statement at a time.";
  if (!/^\s*(select|with)\b/i.test(trimmed))
    return "Only SELECT queries are allowed here. Use the erp_create_* tools to write.";
  if (FORBIDDEN.test(trimmed))
    return "That statement would modify the database. Use the erp_create_* tools instead.";
  return null;
}

function withLimit(sql) {
  return /\blimit\s+\d+/i.test(sql) ? sql : `${sql.trim().replace(/;+\s*$/, "")} LIMIT ${MAX_ROWS}`;
}

function asTable(rows) {
  if (rows.length === 0) return "No rows.";
  const text = rows.map((row) => JSON.stringify(row)).join("\n");
  return text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}\n… truncated at ${MAX_CHARS} characters. Narrow the query or aggregate.`
    : text;
}

function audit(action, entity, ref, detail) {
  database()
    .prepare(
      "INSERT INTO audit_log (at, actor, action, entity, entity_ref, detail) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(new Date().toISOString(), ACTOR, action, entity, String(ref ?? ""), detail ?? null);
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// ── Tools ──────────────────────────────────────────────

const TOOLS = [
  {
    name: "erp_schema",
    description:
      "List the tables and columns in the Brightwater Supply Co. ERP database, with a sample row from each. Call this first if you are unsure what data exists.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "erp_query",
    description:
      "Run a read-only SQL SELECT against the Brightwater ERP (SQLite). Use it for anything about customers, suppliers, products, stock, quotes, orders, invoices, payments, the sales pipeline or the general ledger. Aggregate rather than dumping tables.",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string", description: "A single SELECT statement." } },
      required: ["sql"],
    },
  },
  {
    name: "erp_create_lead",
    description:
      "Add a new sales lead. Use when someone new expresses interest and is not yet a customer.",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" },
        contact_name: { type: "string" },
        email: { type: "string" },
        source: {
          type: "string",
          description: "referral, website, trade show, cold call or partner",
        },
        owner: { type: "string", description: "Sales rep who owns it" },
        notes: { type: "string" },
      },
      required: ["company", "contact_name"],
    },
  },
  {
    name: "erp_create_customer",
    description:
      "Add a new customer account, normally when a lead is converted. Returns the new customer id and code.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        segment: {
          type: "string",
          description: "legal, healthcare, education, logistics, hospitality, tech, etc.",
        },
        city: { type: "string" },
        payment_terms: { type: "number", description: "Days. Defaults to 30." },
        credit_limit: { type: "number", description: "Defaults to 2500 for a new account." },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "erp_create_quote",
    description:
      "Raise a quote for a customer. Give the customer id (or exact name) and the lines as SKU and quantity; pricing, segment discount and VAT are worked out for you. Returns the quote number and totals.",
    inputSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer id or exact name" },
        lines: {
          type: "array",
          description: "Each line is { sku, quantity }",
          items: {
            type: "object",
            properties: { sku: { type: "string" }, quantity: { type: "number" } },
            required: ["sku", "quantity"],
          },
        },
        owner: { type: "string" },
        notes: { type: "string" },
      },
      required: ["customer", "lines"],
    },
  },
  {
    name: "erp_log_activity",
    description:
      "Record a call, email, meeting or note against a customer, so the account history stays current.",
    inputSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer id or exact name" },
        type: { type: "string", description: "call, email, meeting or note" },
        summary: { type: "string" },
        owner: { type: "string" },
      },
      required: ["customer", "summary"],
    },
  },
];

function findCustomer(reference) {
  const byId = Number(reference);
  const row =
    Number.isFinite(byId) && byId > 0
      ? database().prepare("SELECT * FROM customers WHERE id = ?").get(byId)
      : database()
          .prepare("SELECT * FROM customers WHERE name = ? COLLATE NOCASE")
          .get(String(reference));
  return row ?? null;
}

function nextId(table) {
  const row = database().prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ${table}`).get();
  return row.next;
}

function runTool(name, args) {
  switch (name) {
    case "erp_schema": {
      const tables = database()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();

      const described = tables.map(({ name: table }) => {
        const columns = database().prepare(`PRAGMA table_info(${table})`).all();
        const sample = database().prepare(`SELECT * FROM ${table} LIMIT 1`).get();
        const count = database().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
        return `${table} (${count} rows)\n  columns: ${columns.map((c) => `${c.name} ${c.type}`).join(", ")}${
          sample ? `\n  example: ${JSON.stringify(sample)}` : ""
        }`;
      });

      return `Brightwater Supply Co. — watercoolers, coffee machines and office refreshments.\n${CURRENCY_NOTE}\n\n${described.join("\n\n")}`;
    }

    case "erp_query": {
      const sql = String(args?.sql ?? "");
      const problem = checkReadOnly(sql);
      if (problem) return `Refused: ${problem}`;
      try {
        return asTable(database().prepare(withLimit(sql)).all());
      } catch (err) {
        // Hand the error back rather than failing the tool: the model can fix its SQL
        return `SQL error: ${err.message}`;
      }
    }

    case "erp_create_lead": {
      const id = nextId("leads");
      database()
        .prepare(
          `INSERT INTO leads (id, company, contact_name, email, source, status, owner, created_at, notes)
           VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
        )
        .run(
          id,
          String(args.company),
          String(args.contact_name),
          String(args.email ?? ""),
          String(args.source ?? "referral"),
          String(args.owner ?? ACTOR),
          today(),
          args.notes ? String(args.notes) : null,
        );
      audit("create", "lead", id, `${args.company} (${args.contact_name})`);
      return `Lead #${id} created for ${args.company}.`;
    }

    case "erp_create_customer": {
      const id = nextId("customers");
      const code = `C-${1000 + id}`;
      database()
        .prepare(
          `INSERT INTO customers (id, code, name, segment, city, country, payment_terms, credit_limit, on_hold, since, notes)
           VALUES (?, ?, ?, ?, ?, 'UK', ?, ?, 0, ?, ?)`,
        )
        .run(
          id,
          code,
          String(args.name),
          String(args.segment ?? "professional"),
          String(args.city ?? "Unknown"),
          Number(args.payment_terms ?? 30),
          Number(args.credit_limit ?? 2500),
          today(),
          args.notes ? String(args.notes) : null,
        );
      audit("create", "customer", code, String(args.name));
      return `Customer ${code} (${args.name}) created, id ${id}, ${args.payment_terms ?? 30} day terms.`;
    }

    case "erp_create_quote": {
      const customer = findCustomer(args.customer);
      if (!customer)
        return `No customer matches "${args.customer}". Use erp_query to find the right name or id.`;

      const lines = Array.isArray(args.lines) ? args.lines : [];
      if (lines.length === 0) return "A quote needs at least one line.";

      const priced = [];
      for (const line of lines) {
        const product = database()
          .prepare("SELECT * FROM products WHERE sku = ? COLLATE NOCASE")
          .get(String(line.sku));
        if (!product)
          return `No product with SKU "${line.sku}". Check the catalogue with erp_query.`;

        const discount = database()
          .prepare("SELECT discount_pct FROM price_list WHERE product_id = ? AND segment = ?")
          .get(product.id, customer.segment);

        const unitPrice =
          Math.round(product.list_price * (1 - (discount?.discount_pct ?? 0) / 100) * 100) / 100;
        const quantity = Math.max(1, Math.round(Number(line.quantity) || 1));
        priced.push({
          product,
          quantity,
          unitPrice,
          lineTotal: Math.round(unitPrice * quantity * 100) / 100,
        });
      }

      const subtotal = Math.round(priced.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
      const tax = Math.round(subtotal * 0.2 * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;

      const id = nextId("quotes");
      const number = `Q-${new Date().getFullYear()}-${String(id).padStart(4, "0")}`;
      database()
        .prepare(
          `INSERT INTO quotes (id, number, customer_id, opportunity_id, issued_at, valid_until, status, subtotal, tax, total, owner, created_by, notes)
           VALUES (?, ?, ?, NULL, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          number,
          customer.id,
          today(),
          addDays(30),
          subtotal,
          tax,
          total,
          String(args.owner ?? ACTOR),
          ACTOR,
          args.notes ? String(args.notes) : null,
        );

      let lineId = nextId("quote_lines");
      for (const line of priced) {
        database()
          .prepare(
            "INSERT INTO quote_lines (id, quote_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(lineId++, id, line.product.id, line.quantity, line.unitPrice, line.lineTotal);
      }

      audit("create", "quote", number, `${customer.name} — ${CURRENCY.symbol}${total}`);
      const breakdown = priced
        .map(
          (l) =>
            `  ${l.quantity} × ${l.product.name} @ ${CURRENCY.symbol}${l.unitPrice} = ${CURRENCY.symbol}${l.lineTotal}`,
        )
        .join("\n");
      return `Quote ${number} raised for ${customer.name} (draft, valid 30 days):\n${breakdown}\n  Subtotal ${CURRENCY.symbol}${subtotal}, VAT ${CURRENCY.symbol}${tax}, total ${CURRENCY.symbol}${total}`;
    }

    case "erp_log_activity": {
      const customer = findCustomer(args.customer);
      if (!customer) return `No customer matches "${args.customer}".`;
      const id = nextId("activities");
      database()
        .prepare(
          `INSERT INTO activities (id, opportunity_id, customer_id, type, occurred_at, owner, summary, created_by)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          customer.id,
          String(args.type ?? "note"),
          today(),
          String(args.owner ?? ACTOR),
          String(args.summary),
          ACTOR,
        );
      audit("create", "activity", id, `${customer.name}: ${args.summary}`);
      return `Logged a ${args.type ?? "note"} against ${customer.name}.`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ── JSON-RPC plumbing ──────────────────────────────────

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function handleRequest(req) {
  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "brightwater-erp", version: "1.0.0" },
      });
      break;

    case "notifications/initialized":
      break;

    case "tools/list":
      sendResponse(id, { tools: TOOLS });
      break;

    case "tools/call": {
      const { name, arguments: args } = params ?? {};
      try {
        const text = runTool(name, args ?? {});
        sendResponse(id, { content: [{ type: "text", text }] });
      } catch (err) {
        sendResponse(id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    handleRequest(JSON.parse(line));
  } catch {
    /* ignore malformed input */
  }
});
