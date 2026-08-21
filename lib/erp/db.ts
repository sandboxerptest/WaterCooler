/**
 * The ERP database.
 *
 * A separate file from the room store on purpose: this is the fictional
 * company's data, not the app's state. Keeping them apart means the company can
 * be reseeded from scratch without touching anyone's room, and a read-only
 * connection can be handed to agents without exposing app internals.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { ERP_SCHEMA } from "./schema";
import { generateDataset, type Dataset, type GenerateOptions } from "./generate";
import { createLogger } from "../logger";

const log = createLogger("ERP");

export const ERP_DB_PATH = process.env.ERP_DB_PATH ?? join(process.cwd(), ".data", "erp.sqlite");

export function openErpDb(path: string = ERP_DB_PATH): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(ERP_SCHEMA);
  return db;
}

/** Which dataset collection goes into which table, in dependency order. */
const TABLES: Array<[keyof Dataset, string]> = [
  ["glAccounts", "gl_accounts"],
  ["suppliers", "suppliers"],
  ["products", "products"],
  ["priceList", "price_list"],
  ["stockLevels", "stock_levels"],
  ["customers", "customers"],
  ["contacts", "contacts"],
  ["leads", "leads"],
  ["opportunities", "opportunities"],
  ["activities", "activities"],
  ["quotes", "quotes"],
  ["quoteLines", "quote_lines"],
  ["salesOrders", "sales_orders"],
  ["orderLines", "order_lines"],
  ["invoices", "invoices"],
  ["invoiceLines", "invoice_lines"],
  ["payments", "payments"],
  ["purchaseOrders", "purchase_orders"],
  ["journalEntries", "journal_entries"],
  ["journalLines", "journal_lines"],
];

function insertAll(db: DatabaseSync, table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const statement = db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );

  for (const row of rows) {
    statement.run(
      ...columns.map((column) => {
        const value = row[column];
        if (value === undefined || value === null) return null;
        if (typeof value === "boolean") return value ? 1 : 0;
        return value as string | number;
      }),
    );
  }
}

/**
 * Replace the company's data with a freshly generated set.
 *
 * Destructive by design: agents can write to this database, so being able to
 * put it back exactly as it was matters more than preserving their edits.
 */
export function seedErpDatabase(
  path: string = ERP_DB_PATH,
  options: GenerateOptions = {},
): { db: DatabaseSync; counts: Record<string, number> } {
  const db = openErpDb(path);
  const data = generateDataset(options);

  db.exec("BEGIN");
  try {
    // Children before parents, so foreign keys never dangle mid-wipe
    for (const [, table] of [...TABLES].reverse()) db.exec(`DELETE FROM ${table}`);
    db.exec("DELETE FROM audit_log");

    const counts: Record<string, number> = {};
    for (const [key, table] of TABLES) {
      const rows = data[key];
      insertAll(db, table, rows);
      counts[table] = rows.length;
    }
    db.exec("COMMIT");
    log.info(`seeded ${path}`);
    return { db, counts };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** True when the company has not been created yet. */
export function isEmpty(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number };
  return (row?.n ?? 0) === 0;
}
