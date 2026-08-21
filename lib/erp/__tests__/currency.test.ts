import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CURRENCY, CURRENCY_NOTE, formatMoney } from "../currency";

/**
 * The MCP tool server is plain .mjs, run straight by node, so it cannot import
 * the constant above and keeps its own copy. That is a split brain waiting to
 * happen: quotes would print one currency while the rest of the app printed
 * another, and nothing would fail. These tests are the join.
 */
const mcpSource = readFileSync(join(process.cwd(), "lib/mcp/erp-mcp.mjs"), "utf8");

describe("the company's currency", () => {
  it("is dollars", () => {
    expect(CURRENCY).toMatchObject({ code: "USD", symbol: "$" });
    expect(formatMoney(14903.2)).toBe("$14,903.20");
  });

  it("says so in the tool server, using the same symbol and code", () => {
    expect(mcpSource).toContain(`symbol: "${CURRENCY.symbol}"`);
    expect(mcpSource).toContain(`code: "${CURRENCY.code}"`);
  });

  it("leaves no pound signs anywhere an agent can read", () => {
    expect(mcpSource).not.toContain("£");
    expect(CURRENCY_NOTE).not.toContain("£");
  });

  it("tells agents what the bare numbers mean, since no column does", () => {
    expect(CURRENCY_NOTE).toContain("US dollars");
    expect(CURRENCY_NOTE).toContain("no currency column");
  });
});
