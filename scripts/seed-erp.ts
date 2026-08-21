/**
 * Create (or recreate) Brightwater Supply Co.
 *
 *   pnpm seed:erp            → build it if the file is missing
 *   pnpm seed:erp --force    → wipe and rebuild, discarding anything agents wrote
 */

import { ERP_DB_PATH, isEmpty, openErpDb, seedErpDatabase } from "../lib/erp/db";
import { formatMoney } from "../lib/erp/currency";

const force = process.argv.includes("--force");

const existing = openErpDb(ERP_DB_PATH);
const empty = isEmpty(existing);
existing.close();

if (!empty && !force) {
  console.log(`Brightwater already exists at ${ERP_DB_PATH} — pass --force to rebuild it.`);
  process.exit(0);
}

const { db, counts } = seedErpDatabase(ERP_DB_PATH);

const rows = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM invoices WHERE status = 'overdue') AS overdue,
       (SELECT ROUND(SUM(total - paid_total), 2) FROM invoices WHERE status IN ('overdue','open','part-paid')) AS owed,
       (SELECT ROUND(SUM(credit) - SUM(debit), 2) FROM journal_lines WHERE account IN ('4000','4100','4200')) AS revenue`,
  )
  .get() as { overdue: number; owed: number; revenue: number };

console.log(`\nBrightwater Supply Co. — ${ERP_DB_PATH}`);
for (const [table, count] of Object.entries(counts)) {
  console.log(`  ${table.padEnd(18)} ${count}`);
}
console.log(
  `\n  ${rows.overdue} overdue invoices · ${formatMoney(rows.owed)} outstanding · ${formatMoney(rows.revenue)} lifetime revenue`,
);
db.close();
