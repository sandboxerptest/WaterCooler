/**
 * What the company's money is denominated in.
 *
 * The ledger stores bare numbers: `invoices.total` is a REAL, and nothing about
 * the column says what it counts. So the currency is not a fact an agent can
 * look up — left unstated, it gets inferred from the company's flavour, and the
 * same figure comes back in whatever currency the guess landed on.
 *
 * This constant is that missing fact, and the reason it is told to agents twice:
 * once in the seat's briefing, which is always in the prompt, and once in the
 * header of `erp_schema`, for the run that goes straight to the tools.
 */
export const CURRENCY = {
  code: "USD",
  symbol: "$",
  name: "US dollars",
} as const;

/** The sentence the agents are given. One wording, so the two places agree. */
export const CURRENCY_NOTE = `All money columns are plain numbers in ${CURRENCY.name} (${CURRENCY.code}) — there is no currency column, so quote figures with ${CURRENCY.symbol}.`;

/** "$1,204.50", for display. Never for a value going back into the books. */
export function formatMoney(value: number): string {
  return `${CURRENCY.symbol}${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
