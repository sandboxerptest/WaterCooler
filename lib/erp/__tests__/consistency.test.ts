import { describe, it, expect } from "vitest";
import { generateDataset } from "../generate";
import { GL_ACCOUNTS } from "../schema";

/**
 * These are the tests that decide whether the dataset is worth having.
 *
 * If the books do not reconcile, an agent asked "what did we invoice last
 * quarter" one way and "what is in the revenue account" another way returns two
 * different numbers, both confidently. Sample data that contradicts itself is
 * worse than none, so the invariants are asserted rather than hoped for.
 */

const data = generateDataset({ seed: 1234, today: new Date("2026-08-21"), months: 24 });

const sum = (rows: Record<string, unknown>[], key: string) =>
  Math.round(rows.reduce((total, row) => total + ((row[key] as number) ?? 0), 0) * 100) / 100;

describe("the ledger", () => {
  it("balances: every debit has a matching credit", () => {
    const debits = sum(data.journalLines, "debit");
    const credits = sum(data.journalLines, "credit");
    expect(Math.abs(debits - credits)).toBeLessThan(0.01);
  });

  it("balances entry by entry, not just in total", () => {
    // A ledger can total to zero while individual entries are nonsense
    const byEntry = new Map<number, { debit: number; credit: number }>();
    for (const line of data.journalLines) {
      const id = line.entry_id as number;
      const totals = byEntry.get(id) ?? { debit: 0, credit: 0 };
      totals.debit += (line.debit as number) ?? 0;
      totals.credit += (line.credit as number) ?? 0;
      byEntry.set(id, totals);
    }

    const unbalanced = [...byEntry.entries()].filter(
      ([, t]) => Math.abs(t.debit - t.credit) > 0.01,
    );
    expect(unbalanced).toEqual([]);
  });

  it("posts only to accounts that exist in the chart", () => {
    const known = new Set(GL_ACCOUNTS.map((a) => a.code));
    const unknown = [...new Set(data.journalLines.map((l) => l.account as string))].filter(
      (code) => !known.has(code),
    );
    expect(unknown).toEqual([]);
  });

  it("never puts a debit and a credit on the same line", () => {
    const both = data.journalLines.filter(
      (line) => ((line.debit as number) ?? 0) > 0 && ((line.credit as number) ?? 0) > 0,
    );
    expect(both).toEqual([]);
  });
});

describe("sales tie to the ledger", () => {
  it("receivables equal what customers still owe", () => {
    const arLines = data.journalLines.filter((l) => l.account === "1100");
    const arBalance = sum(arLines, "debit") - sum(arLines, "credit");

    const outstanding = data.invoices
      .filter((invoice) => invoice.status !== "credited")
      .reduce(
        (total, invoice) => total + ((invoice.total as number) - (invoice.paid_total as number)),
        0,
      );

    expect(Math.abs(arBalance - Math.round(outstanding * 100) / 100)).toBeLessThan(0.02);
  });

  it("revenue posted equals the value of what was invoiced", () => {
    const revenueAccounts = new Set(["4000", "4100", "4200"]);
    const revenueLines = data.journalLines.filter((l) => revenueAccounts.has(l.account as string));
    const posted = sum(revenueLines, "credit") - sum(revenueLines, "debit");

    // Net of the credit note, which reverses part of one invoice
    const credited = data.invoices.find((i) => i.status === "credited");
    const invoiced =
      sum(data.invoices, "subtotal") - (credited ? (credited.subtotal as number) : 0);

    expect(Math.abs(posted - invoiced)).toBeLessThan(0.02);
  });

  it("every invoice line adds up to its invoice", () => {
    const linesByInvoice = new Map<number, number>();
    for (const line of data.invoiceLines) {
      const id = line.invoice_id as number;
      linesByInvoice.set(id, (linesByInvoice.get(id) ?? 0) + (line.line_total as number));
    }

    const mismatched = data.invoices.filter((invoice) => {
      const lines = Math.round((linesByInvoice.get(invoice.id as number) ?? 0) * 100) / 100;
      return Math.abs(lines - (invoice.subtotal as number)) > 0.02;
    });
    expect(mismatched.map((i) => i.number)).toEqual([]);
  });

  it("charges VAT at the going rate", () => {
    const wrong = data.invoices.filter(
      (invoice) => Math.abs((invoice.subtotal as number) * 0.2 - (invoice.tax as number)) > 0.02,
    );
    expect(wrong).toEqual([]);
  });

  it("never records payment beyond the invoice total", () => {
    const overpaid = data.invoices.filter(
      (invoice) => (invoice.paid_total as number) > (invoice.total as number) + 0.01,
    );
    expect(overpaid).toEqual([]);
  });
});

describe("referential integrity", () => {
  const idsOf = (rows: Record<string, unknown>[]) => new Set(rows.map((r) => r.id as number));

  it("points every document at a customer that exists", () => {
    const customers = idsOf(data.customers);
    for (const rows of [data.invoices, data.salesOrders, data.quotes]) {
      const orphans = rows.filter((row) => !customers.has(row.customer_id as number));
      expect(orphans).toEqual([]);
    }
  });

  it("points every line at a product that exists", () => {
    const products = idsOf(data.products);
    for (const rows of [data.invoiceLines, data.orderLines, data.quoteLines]) {
      const orphans = rows.filter((row) => !products.has(row.product_id as number));
      expect(orphans).toEqual([]);
    }
  });

  it("points every payment at an invoice that exists", () => {
    const invoices = idsOf(data.invoices);
    expect(data.payments.filter((p) => !invoices.has(p.invoice_id as number))).toEqual([]);
  });
});

describe("the data is worth asking questions about", () => {
  it("has enough of a company to be interesting", () => {
    expect(data.customers.length).toBeGreaterThanOrEqual(30);
    expect(data.products.length).toBeGreaterThanOrEqual(15);
    expect(data.invoices.length).toBeGreaterThan(150);
    expect(data.journalLines.length).toBeGreaterThan(800);
  });

  it("contains overdue money, so chasing it is a real question", () => {
    const overdue = data.invoices.filter((i) => i.status === "overdue");
    expect(overdue.length).toBeGreaterThan(3);
  });

  it("has a pipeline with something stuck in it", () => {
    const stalled = data.opportunities.filter(
      (o) => o.stage === "negotiation" && (o.expected_close as string) < "2026-08-21",
    );
    expect(stalled.length).toBeGreaterThan(0);
  });

  it("keeps margin varied, so 'most profitable' has an answer", () => {
    const margins = data.products
      .filter((p) => (p.unit_cost as number) > 0)
      .map((p) => ((p.list_price as number) - (p.unit_cost as number)) / (p.list_price as number));
    const spread = Math.max(...margins) - Math.min(...margins);
    expect(spread).toBeGreaterThan(0.15);
  });

  it("is the same company every time, so answers do not drift between reseeds", () => {
    const again = generateDataset({ seed: 1234, today: new Date("2026-08-21"), months: 24 });
    expect(again.invoices.length).toBe(data.invoices.length);
    expect(sum(again.invoices, "total")).toBe(sum(data.invoices, "total"));
    expect(again.customers[0].name).toBe(data.customers[0].name);
  });
});
