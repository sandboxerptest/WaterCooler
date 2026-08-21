/**
 * Brightwater Supply Co.'s books, generated rather than hand-written.
 *
 * Pure: this builds a plain object and touches no database, so the property
 * that matters most — that the ledger balances — can be tested without I/O.
 *
 * Deterministic: the same seed produces the same company every time, so a
 * question like "who is our biggest customer" has a stable answer across
 * reseeds, and a failing test can be reproduced.
 *
 * The numbers are deliberately uneven. Uniform data makes every question have
 * the same boring answer; here a handful of customers pay late, one supplier is
 * duplicated, an opportunity has been stuck in negotiation for months, and one
 * invoice has been credited.
 */

import { GL_ACCOUNTS, revenueAccountFor } from "./schema";

// ── Deterministic randomness ───────────────────────────

/** Small, fast, seedable PRNG (mulberry32). */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

const pick = <T>(rng: Random, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const between = (rng: Random, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const money = (value: number) => Math.round(value * 100) / 100;

const VAT_RATE = 0.2;

// ── The cast ───────────────────────────────────────────
// Curated rather than generated: names are where the character lives, and
// "Halberd Legal LLP" tells you more than "Customer 17".

const CUSTOMERS: Array<{
  name: string;
  segment: string;
  city: string;
  terms: number;
  notes?: string;
  slowPayer?: boolean;
  onHold?: boolean;
}> = [
  {
    name: "Halberd Legal LLP",
    segment: "legal",
    city: "London",
    terms: 30,
    slowPayer: true,
    notes: "Pays on the 45th day regardless of terms. Finance contact rarely replies.",
  },
  {
    name: "Meridian Dental Group",
    segment: "healthcare",
    city: "Bristol",
    terms: 14,
    notes: "Small orders, best margin on the book.",
  },
  {
    name: "Cormorant Logistics",
    segment: "logistics",
    city: "Felixstowe",
    terms: 60,
    slowPayer: true,
    notes: "Highest volume, thinnest margin. Queries most invoices.",
  },
  { name: "Pemberton & Vale Architects", segment: "professional", city: "Bath", terms: 30 },
  {
    name: "Thornbury Academy Trust",
    segment: "education",
    city: "Bristol",
    terms: 45,
    notes: "Buys in term-time bursts. Quiet through August.",
  },
  { name: "Lindworth Community Hospital", segment: "healthcare", city: "Coventry", terms: 45 },
  { name: "Marlowe & Finch Accountants", segment: "professional", city: "Leeds", terms: 30 },
  {
    name: "Saltmarsh Hotels",
    segment: "hospitality",
    city: "Brighton",
    terms: 30,
    notes: "Seasonal. Doubles orders over summer.",
  },
  { name: "Quillfeather Publishing", segment: "media", city: "London", terms: 30 },
  {
    name: "Ardent Robotics",
    segment: "tech",
    city: "Cambridge",
    terms: 14,
    notes: "Growing fast. Watch the credit limit.",
  },
  { name: "Bramble Hill School", segment: "education", city: "Sheffield", terms: 45 },
  { name: "Norwood Chambers", segment: "legal", city: "Manchester", terms: 30 },
  { name: "Kestrel Insurance", segment: "finance", city: "Norwich", terms: 30 },
  { name: "Ravensworth Engineering", segment: "manufacturing", city: "Sunderland", terms: 60 },
  { name: "Copperfield Care Homes", segment: "healthcare", city: "Derby", terms: 45 },
  { name: "Larkspur Veterinary", segment: "healthcare", city: "York", terms: 14 },
  {
    name: "Ashcombe Council",
    segment: "public",
    city: "Taunton",
    terms: 60,
    notes: "Purchase order required on every line or it will not be paid.",
  },
  { name: "Verity Recruitment", segment: "professional", city: "Reading", terms: 30 },
  { name: "Blackthorn Brewing", segment: "manufacturing", city: "Burton", terms: 30 },
  { name: "Sable & Rowe Solicitors", segment: "legal", city: "Cardiff", terms: 30 },
  { name: "Fenwick Dental Studio", segment: "healthcare", city: "Newcastle", terms: 14 },
  { name: "Orchard Lane Nursery", segment: "education", city: "Oxford", terms: 30 },
  { name: "Peregrine Aviation Services", segment: "logistics", city: "Luton", terms: 45 },
  { name: "Hollis Financial Planning", segment: "finance", city: "Edinburgh", terms: 30 },
  {
    name: "Tamarind Restaurants",
    segment: "hospitality",
    city: "London",
    terms: 21,
    onHold: true,
    notes: "On stop. Two invoices unpaid past 90 days.",
  },
  { name: "Wexford Architects", segment: "professional", city: "Belfast", terms: 30 },
  { name: "Silverbirch Physio", segment: "healthcare", city: "Nottingham", terms: 14 },
  { name: "Grangemoor Estates", segment: "property", city: "Glasgow", terms: 45 },
  { name: "Dunmore Freight", segment: "logistics", city: "Liverpool", terms: 60, slowPayer: true },
  { name: "Ellington Media", segment: "media", city: "London", terms: 30 },
  {
    name: "Foxglove Garden Centres",
    segment: "retail",
    city: "Exeter",
    terms: 30,
    notes: "Seasonal peak in spring.",
  },
  { name: "Harrowgate Labs", segment: "tech", city: "Harrogate", terms: 30 },
  { name: "Inchcape Marine", segment: "manufacturing", city: "Aberdeen", terms: 45 },
  { name: "Juniper Wellness", segment: "healthcare", city: "Bath", terms: 21 },
  { name: "Kingsmead Golf Club", segment: "hospitality", city: "Surrey", terms: 30 },
  { name: "Lowry Design Studio", segment: "media", city: "Salford", terms: 21 },
  { name: "Mallory Consulting", segment: "professional", city: "London", terms: 30 },
  { name: "Northgate Pharmacy", segment: "healthcare", city: "Hull", terms: 14 },
  { name: "Oakhurst Retirement Living", segment: "healthcare", city: "Chester", terms: 45 },
  { name: "Pinewood Studios Catering", segment: "hospitality", city: "Slough", terms: 30 },
];

const SUPPLIERS: Array<{
  name: string;
  category: string;
  city: string;
  country: string;
  lead: number;
  terms: number;
  notes?: string;
}> = [
  {
    name: "Aquila Systems GmbH",
    category: "coolers",
    city: "Stuttgart",
    country: "Germany",
    lead: 21,
    terms: 45,
  },
  {
    name: "Bruna Caffè SRL",
    category: "coffee",
    city: "Turin",
    country: "Italy",
    lead: 28,
    terms: 30,
  },
  {
    name: "Nordfilt AB",
    category: "consumables",
    city: "Malmö",
    country: "Sweden",
    lead: 14,
    terms: 30,
  },
  {
    name: "Cupworks Ltd",
    category: "consumables",
    city: "Stoke-on-Trent",
    country: "UK",
    lead: 7,
    terms: 30,
  },
  {
    name: "Highfield Spring Water",
    category: "consumables",
    city: "Malvern",
    country: "UK",
    lead: 3,
    terms: 14,
  },
  {
    name: "Verdant Roasters",
    category: "coffee",
    city: "Bristol",
    country: "UK",
    lead: 10,
    terms: 30,
  },
  {
    name: "Pelham Plastics",
    category: "consumables",
    city: "Leicester",
    country: "UK",
    lead: 12,
    terms: 45,
  },
  {
    name: "Torrent Filtration",
    category: "consumables",
    city: "Rotterdam",
    country: "Netherlands",
    lead: 18,
    terms: 30,
  },
  {
    name: "Solent Engineering Spares",
    category: "parts",
    city: "Southampton",
    country: "UK",
    lead: 5,
    terms: 30,
  },
  {
    name: "Kestrel Couriers",
    category: "logistics",
    city: "Birmingham",
    country: "UK",
    lead: 1,
    terms: 14,
  },
  {
    name: "Ambleside Sanitisers",
    category: "consumables",
    city: "Kendal",
    country: "UK",
    lead: 9,
    terms: 30,
  },
  {
    name: "Cupworks Limited",
    category: "consumables",
    city: "Stoke on Trent",
    country: "UK",
    lead: 7,
    terms: 30,
    notes: "Looks like a duplicate of Cupworks Ltd — never cleaned up.",
  },
  {
    name: "Marchetti Spares",
    category: "parts",
    city: "Milan",
    country: "Italy",
    lead: 24,
    terms: 45,
  },
  {
    name: "Glacier Cool Logistics",
    category: "logistics",
    city: "Dover",
    country: "UK",
    lead: 2,
    terms: 21,
  },
  {
    name: "Brightleaf Tea Co.",
    category: "coffee",
    city: "Colombo",
    country: "Sri Lanka",
    lead: 35,
    terms: 60,
  },
];

const PRODUCTS: Array<{
  sku: string;
  name: string;
  category: string;
  cost: number;
  price: number;
  unit: string;
  supplier: string;
  active?: boolean;
}> = [
  {
    sku: "AQ-20F",
    name: "Aquila 20L Floor Cooler",
    category: "coolers",
    cost: 210,
    price: 429,
    unit: "each",
    supplier: "Aquila Systems GmbH",
  },
  {
    sku: "AQ-12C",
    name: "Aquila 12L Countertop Cooler",
    category: "coolers",
    cost: 148,
    price: 299,
    unit: "each",
    supplier: "Aquila Systems GmbH",
  },
  {
    sku: "AQ-PLUMB",
    name: "Aquila Mains-Fed Cooler",
    category: "coolers",
    cost: 320,
    price: 649,
    unit: "each",
    supplier: "Aquila Systems GmbH",
  },
  {
    sku: "AQ-SPARK",
    name: "Aquila Sparkling Tap Unit",
    category: "coolers",
    cost: 445,
    price: 899,
    unit: "each",
    supplier: "Aquila Systems GmbH",
  },
  {
    sku: "BR-300",
    name: "Bruna Bean-to-Cup 300",
    category: "coffee",
    cost: 690,
    price: 1349,
    unit: "each",
    supplier: "Bruna Caffè SRL",
  },
  {
    sku: "BR-150",
    name: "Bruna Filter Brewer 150",
    category: "coffee",
    cost: 235,
    price: 469,
    unit: "each",
    supplier: "Bruna Caffè SRL",
  },
  {
    sku: "BR-POD",
    name: "Bruna Pod Machine",
    category: "coffee",
    cost: 118,
    price: 239,
    unit: "each",
    supplier: "Bruna Caffè SRL",
    active: false,
  },
  {
    sku: "CN-BOTTLE",
    name: "19L Spring Water Bottle",
    category: "consumables",
    cost: 4.1,
    price: 8.95,
    unit: "bottle",
    supplier: "Highfield Spring Water",
  },
  {
    sku: "CN-CUP-1K",
    name: "Compostable Cups (1000)",
    category: "consumables",
    cost: 22,
    price: 44.5,
    unit: "box",
    supplier: "Cupworks Ltd",
  },
  {
    sku: "CN-FILT-6",
    name: "Carbon Filter Cartridge (6 pack)",
    category: "consumables",
    cost: 31,
    price: 69,
    unit: "pack",
    supplier: "Nordfilt AB",
  },
  {
    sku: "CN-SANI",
    name: "Cooler Sanitising Kit",
    category: "consumables",
    cost: 12.5,
    price: 29,
    unit: "kit",
    supplier: "Ambleside Sanitisers",
  },
  {
    sku: "CF-BEAN-6",
    name: "Verdant House Blend Beans 6kg",
    category: "consumables",
    cost: 54,
    price: 108,
    unit: "case",
    supplier: "Verdant Roasters",
  },
  {
    sku: "CF-DECAF",
    name: "Verdant Decaf Beans 3kg",
    category: "consumables",
    cost: 33,
    price: 69,
    unit: "case",
    supplier: "Verdant Roasters",
  },
  {
    sku: "CF-TEA",
    name: "Brightleaf Assam Teabags (1100)",
    category: "consumables",
    cost: 41,
    price: 82,
    unit: "case",
    supplier: "Brightleaf Tea Co.",
  },
  {
    sku: "CN-SYRUP",
    name: "Flavour Syrup Trio",
    category: "consumables",
    cost: 14,
    price: 32,
    unit: "pack",
    supplier: "Bruna Caffè SRL",
  },
  {
    sku: "SV-INSTALL",
    name: "Installation and Commissioning",
    category: "service",
    cost: 45,
    price: 145,
    unit: "visit",
    supplier: "",
  },
  {
    sku: "SV-SANI-Q",
    name: "Quarterly Sanitisation Visit",
    category: "service",
    cost: 28,
    price: 89,
    unit: "visit",
    supplier: "",
  },
  {
    sku: "SV-CARE-Y",
    name: "Brightwater Care Plan (annual)",
    category: "service",
    cost: 120,
    price: 349,
    unit: "year",
    supplier: "",
  },
  {
    sku: "SV-REPAIR",
    name: "Callout and Repair",
    category: "service",
    cost: 60,
    price: 165,
    unit: "visit",
    supplier: "Solent Engineering Spares",
  },
  {
    sku: "PT-PUMP",
    name: "Replacement Pump Assembly",
    category: "parts",
    cost: 38,
    price: 95,
    unit: "each",
    supplier: "Solent Engineering Spares",
  },
];

/** Sales reps. Deliberately the same names as the office seats. */
const REPS = ["Alice", "Bob", "Carol", "Dave"] as const;

const LEAD_SOURCES = ["referral", "website", "trade show", "cold call", "partner"] as const;
const CONTACT_ROLES = [
  "Office Manager",
  "Facilities Lead",
  "Finance Manager",
  "Procurement",
  "Practice Manager",
  "PA to Directors",
] as const;
const FIRST_NAMES = [
  "Aisha",
  "Tom",
  "Priya",
  "Marcus",
  "Elena",
  "Rob",
  "Grace",
  "Yusuf",
  "Nina",
  "Callum",
  "Freya",
  "Omar",
  "Sinead",
  "Hugo",
  "Leila",
] as const;
const LAST_NAMES = [
  "Okafor",
  "Whitfield",
  "Nair",
  "Delgado",
  "Bianchi",
  "Chambers",
  "Adeyemi",
  "Karim",
  "Sorensen",
  "Byrne",
  "Lindqvist",
  "Haddad",
  "Doyle",
  "Marchetti",
  "Farrow",
] as const;

// ── Shapes ─────────────────────────────────────────────

export interface Dataset {
  customers: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
  suppliers: Record<string, unknown>[];
  products: Record<string, unknown>[];
  priceList: Record<string, unknown>[];
  stockLevels: Record<string, unknown>[];
  leads: Record<string, unknown>[];
  opportunities: Record<string, unknown>[];
  activities: Record<string, unknown>[];
  quotes: Record<string, unknown>[];
  quoteLines: Record<string, unknown>[];
  salesOrders: Record<string, unknown>[];
  orderLines: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  invoiceLines: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  purchaseOrders: Record<string, unknown>[];
  glAccounts: Record<string, unknown>[];
  journalEntries: Record<string, unknown>[];
  journalLines: Record<string, unknown>[];
}

export interface GenerateOptions {
  /** Same seed, same company. */
  seed?: number;
  /** "Today" — dates are generated relative to this so history stays recent. */
  today?: Date;
  /** How much history to invent. */
  months?: number;
}

const day = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * day);

/**
 * Build the company.
 *
 * Every document that has a financial consequence posts its own journal entry
 * as it is created, which is why the trial balance comes out flat rather than
 * being reconciled afterwards.
 */
export function generateDataset(options: GenerateOptions = {}): Dataset {
  const rng = makeRandom(options.seed ?? 20260821);
  const today = options.today ?? new Date();
  const months = options.months ?? 24;
  const startedAt = addDays(today, -months * 30);

  const data: Dataset = {
    customers: [],
    contacts: [],
    suppliers: [],
    products: [],
    priceList: [],
    stockLevels: [],
    leads: [],
    opportunities: [],
    activities: [],
    quotes: [],
    quoteLines: [],
    salesOrders: [],
    orderLines: [],
    invoices: [],
    invoiceLines: [],
    payments: [],
    purchaseOrders: [],
    glAccounts: GL_ACCOUNTS.map((a) => ({ ...a })),
    journalEntries: [],
    journalLines: [],
  };

  let journalId = 0;
  let journalLineId = 0;

  /** Post one balanced entry. Callers pass lines; this refuses to post if they do not balance. */
  const post = (
    date: string,
    memo: string,
    source: string,
    sourceRef: string,
    lines: Array<{ account: string; debit?: number; credit?: number; memo?: string }>,
  ) => {
    const debits = money(lines.reduce((sum, l) => sum + (l.debit ?? 0), 0));
    const credits = money(lines.reduce((sum, l) => sum + (l.credit ?? 0), 0));
    if (Math.abs(debits - credits) > 0.005) {
      throw new Error(`Refusing to post an unbalanced entry (${memo}): ${debits} vs ${credits}`);
    }

    const id = ++journalId;
    data.journalEntries.push({
      id,
      entry_date: date,
      memo,
      source,
      source_ref: sourceRef,
      created_by: null,
    });
    for (const line of lines) {
      data.journalLines.push({
        id: ++journalLineId,
        entry_id: id,
        account: line.account,
        debit: money(line.debit ?? 0),
        credit: money(line.credit ?? 0),
        memo: line.memo ?? null,
      });
    }
  };

  // ── Opening balances: the company started with cash from its founders ──
  post(iso(startedAt), "Opening share capital", "equity", "OPENING", [
    { account: "1000", debit: 120000 },
    { account: "3000", credit: 120000 },
  ]);
  post(iso(startedAt), "Opening inventory purchase", "purchase", "OPENING", [
    { account: "1200", debit: 48000 },
    { account: "1000", credit: 48000 },
  ]);

  // ── Suppliers ──
  SUPPLIERS.forEach((supplier, index) => {
    data.suppliers.push({
      id: index + 1,
      code: `SUP-${String(index + 1).padStart(3, "0")}`,
      name: supplier.name,
      category: supplier.category,
      city: supplier.city,
      country: supplier.country,
      lead_time_days: supplier.lead,
      payment_terms: supplier.terms,
      notes: supplier.notes ?? null,
    });
  });
  const supplierIdByName = new Map(data.suppliers.map((s) => [s.name as string, s.id as number]));

  // ── Products, pricing and stock ──
  PRODUCTS.forEach((product, index) => {
    const id = index + 1;
    data.products.push({
      id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      supplier_id: supplierIdByName.get(product.supplier) ?? null,
      unit_cost: product.cost,
      list_price: product.price,
      unit: product.unit,
      active: product.active === false ? 0 : 1,
    });

    // Bigger buyers get a better price; services are never discounted
    if (product.category !== "service") {
      for (const [segment, discount] of [
        ["logistics", 12],
        ["education", 8],
        ["public", 10],
        ["healthcare", 5],
      ] as const) {
        data.priceList.push({
          id: data.priceList.length + 1,
          product_id: id,
          segment,
          discount_pct: discount,
        });
      }
    }

    if (product.category !== "service") {
      const onHand = between(rng, 0, 400);
      const reorder = between(rng, 20, 120);
      data.stockLevels.push({
        product_id: id,
        warehouse: pick(rng, ["Bristol", "Leeds"] as const),
        on_hand: onHand,
        reorder_point: reorder,
        // Something already on order when stock is short, as it would be
        on_order: onHand < reorder ? between(rng, 50, 200) : 0,
      });
    }
  });
  const sellable = data.products.filter((p) => p.active === 1);

  // ── Customers and their contacts ──
  CUSTOMERS.forEach((customer, index) => {
    const id = index + 1;
    data.customers.push({
      id,
      code: `C-${String(1000 + id)}`,
      name: customer.name,
      segment: customer.segment,
      city: customer.city,
      country: "UK",
      payment_terms: customer.terms,
      credit_limit: [2500, 5000, 10000, 25000][between(rng, 0, 3)],
      on_hold: customer.onHold ? 1 : 0,
      since: iso(addDays(startedAt, -between(rng, 0, 900))),
      notes: customer.notes ?? null,
    });

    for (let c = 0; c < between(rng, 1, 2); c++) {
      const first = pick(rng, FIRST_NAMES);
      const last = pick(rng, LAST_NAMES);
      data.contacts.push({
        id: data.contacts.length + 1,
        customer_id: id,
        name: `${first} ${last}`,
        role: pick(rng, CONTACT_ROLES),
        email: `${first.toLowerCase()}.${last.toLowerCase()}@${customer.name.toLowerCase().replace(/[^a-z]+/g, "")}.co.uk`,
        phone: `01${between(rng, 200, 999)} ${between(rng, 100000, 999999)}`,
        primary_contact: c === 0 ? 1 : 0,
      });
    }
  });

  // ── The sales cycle ──
  // Quote → order → invoice → payment, with each step posting its own ledger
  // consequence so the accounts follow the documents rather than the reverse.
  let quoteId = 0,
    quoteLineId = 0,
    orderId = 0,
    orderLineId = 0;
  let invoiceId = 0,
    invoiceLineId = 0,
    paymentId = 0;

  const monthCount = months;
  for (let monthOffset = monthCount; monthOffset >= 0; monthOffset--) {
    const monthStart = addDays(today, -monthOffset * 30);

    // Quieter in August, busier in spring — the seasonality customers mention
    const month = monthStart.getMonth();
    const seasonal = month === 7 ? 0.5 : month === 2 || month === 3 ? 1.4 : 1;
    const ordersThisMonth = Math.max(1, Math.round(between(rng, 8, 16) * seasonal));

    for (let n = 0; n < ordersThisMonth; n++) {
      const customerIndex = between(rng, 0, CUSTOMERS.length - 1);
      const customer = CUSTOMERS[customerIndex];
      const customerRow = data.customers[customerIndex];
      const rep = pick(rng, REPS);
      const orderedAt = addDays(monthStart, between(rng, 0, 27));
      if (orderedAt > today) continue;

      // Build the lines first: everything downstream is derived from them
      const lineCount = between(rng, 1, 4);
      const lines: Array<{
        product: Record<string, unknown>;
        qty: number;
        unitPrice: number;
        unitCost: number;
      }> = [];
      for (let l = 0; l < lineCount; l++) {
        const product = sellable[between(rng, 0, sellable.length - 1)];
        const listPrice = product.list_price as number;
        const discount = data.priceList.find(
          (row) => row.product_id === product.id && row.segment === customer.segment,
        );
        const unitPrice = money(listPrice * (1 - ((discount?.discount_pct as number) ?? 0) / 100));
        const qty = product.category === "consumables" ? between(rng, 2, 40) : between(rng, 1, 4);
        lines.push({ product, qty, unitPrice, unitCost: product.unit_cost as number });
      }

      const subtotal = money(lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0));
      const tax = money(subtotal * VAT_RATE);
      const total = money(subtotal + tax);
      const cogs = money(lines.reduce((sum, l) => sum + l.unitCost * l.qty, 0));

      // Most orders start life as a quote
      let quoteRowId: number | null = null;
      if (rng() < 0.7) {
        quoteRowId = ++quoteId;
        const issuedAt = addDays(orderedAt, -between(rng, 2, 21));
        data.quotes.push({
          id: quoteRowId,
          number: `Q-${2024 + Math.floor(quoteRowId / 400)}-${String(quoteRowId).padStart(4, "0")}`,
          customer_id: customerRow.id,
          opportunity_id: null,
          issued_at: iso(issuedAt),
          valid_until: iso(addDays(issuedAt, 30)),
          status: "accepted",
          subtotal,
          tax,
          total,
          owner: rep,
          created_by: null,
          notes: null,
        });
        for (const line of lines) {
          data.quoteLines.push({
            id: ++quoteLineId,
            quote_id: quoteRowId,
            product_id: line.product.id,
            quantity: line.qty,
            unit_price: line.unitPrice,
            line_total: money(line.unitPrice * line.qty),
          });
        }
      }

      const orderRowId = ++orderId;
      data.salesOrders.push({
        id: orderRowId,
        number: `SO-${String(10000 + orderRowId)}`,
        customer_id: customerRow.id,
        quote_id: quoteRowId,
        ordered_at: iso(orderedAt),
        status: "invoiced",
        total,
        created_by: null,
      });
      for (const line of lines) {
        data.orderLines.push({
          id: ++orderLineId,
          order_id: orderRowId,
          product_id: line.product.id,
          quantity: line.qty,
          unit_price: line.unitPrice,
          unit_cost: line.unitCost,
          line_total: money(line.unitPrice * line.qty),
        });
      }

      // Invoice
      const issuedAt = addDays(orderedAt, between(rng, 0, 3));
      const dueAt = addDays(issuedAt, customer.terms);
      const invoiceRowId = ++invoiceId;
      const number = `INV-${String(50000 + invoiceRowId)}`;

      // Payment behaviour is where the interesting questions come from
      const daysLate = customer.slowPayer ? between(rng, 10, 40) : between(rng, -5, 8);
      const paidAt = addDays(dueAt, daysLate);
      const settled = !customer.onHold && paidAt <= today && rng() > 0.06;
      const partPaid = !settled && rng() < 0.15;
      const paidTotal = settled ? total : partPaid ? money(total * 0.4) : 0;
      const status = settled ? "paid" : dueAt < today ? "overdue" : partPaid ? "part-paid" : "open";

      data.invoices.push({
        id: invoiceRowId,
        number,
        customer_id: customerRow.id,
        order_id: orderRowId,
        issued_at: iso(issuedAt),
        due_at: iso(dueAt),
        status,
        subtotal,
        tax,
        total,
        paid_total: paidTotal,
        created_by: null,
      });
      for (const line of lines) {
        data.invoiceLines.push({
          id: ++invoiceLineId,
          invoice_id: invoiceRowId,
          product_id: line.product.id,
          quantity: line.qty,
          unit_price: line.unitPrice,
          unit_cost: line.unitCost,
          line_total: money(line.unitPrice * line.qty),
        });
      }

      // Raising an invoice: money owed, revenue earned, VAT collected …
      const revenueLines = new Map<string, number>();
      for (const line of lines) {
        const account = revenueAccountFor(line.product.category as string);
        revenueLines.set(
          account,
          money((revenueLines.get(account) ?? 0) + line.unitPrice * line.qty),
        );
      }
      post(iso(issuedAt), `Invoice ${number} — ${customer.name}`, "invoice", number, [
        { account: "1100", debit: total },
        ...[...revenueLines].map(([account, amount]) => ({ account, credit: amount })),
        { account: "2100", credit: tax },
      ]);
      // … and the goods leaving the shelf
      if (cogs > 0) {
        post(iso(issuedAt), `Cost of sales ${number}`, "invoice", number, [
          { account: "5000", debit: cogs },
          { account: "1200", credit: cogs },
        ]);
      }

      if (paidTotal > 0) {
        data.payments.push({
          id: ++paymentId,
          invoice_id: invoiceRowId,
          paid_at: iso(paidAt > today ? today : paidAt),
          amount: paidTotal,
          method: pick(rng, ["bank transfer", "direct debit", "card", "cheque"] as const),
          reference: `${customerRow.code}-${number.slice(-5)}`,
        });
        post(iso(paidAt > today ? today : paidAt), `Payment for ${number}`, "payment", number, [
          { account: "1000", debit: paidTotal },
          { account: "1100", credit: paidTotal },
        ]);
      }
    }

    // ── Running the business costs money too ──
    const monthEnd = addDays(monthStart, 27);
    if (monthEnd <= today) {
      const wages = money(between(rng, 18000, 24000));
      const rent = 4200;
      const delivery = money(between(rng, 1800, 3600));
      const marketing = money(between(rng, 400, 2600));
      post(iso(monthEnd), "Monthly payroll", "payroll", iso(monthEnd), [
        { account: "6000", debit: wages },
        { account: "1000", credit: wages },
      ]);
      post(iso(monthEnd), "Rent, delivery and marketing", "overhead", iso(monthEnd), [
        { account: "6100", debit: rent },
        { account: "6200", debit: delivery },
        { account: "6300", debit: marketing },
        { account: "1000", credit: money(rent + delivery + marketing) },
      ]);

      // Restocking, roughly in line with what went out
      const restock = money(between(rng, 9000, 16000));
      data.purchaseOrders.push({
        id: data.purchaseOrders.length + 1,
        number: `PO-${String(7000 + data.purchaseOrders.length + 1)}`,
        supplier_id: between(rng, 1, SUPPLIERS.length),
        ordered_at: iso(addDays(monthStart, between(rng, 1, 20))),
        expected_at: iso(addDays(monthStart, between(rng, 21, 40))),
        status: monthEnd < addDays(today, -30) ? "received" : "open",
        total: restock,
      });
      post(iso(monthEnd), "Stock purchases", "purchase", iso(monthEnd), [
        { account: "1200", debit: restock },
        { account: "2000", credit: restock },
      ]);
    }
  }

  // ── One credited invoice, because real ledgers have them ──
  const toCredit = data.invoices.find((inv) => inv.status === "overdue");
  if (toCredit) {
    toCredit.status = "credited";
    const total = toCredit.total as number;
    const tax = toCredit.tax as number;
    post(iso(today), `Credit note against ${toCredit.number}`, "invoice", `CN-${toCredit.number}`, [
      { account: "4100", debit: money(total - tax) },
      { account: "2100", debit: tax },
      { account: "1100", credit: total },
    ]);
  }

  // ── CRM: what is in flight now ──
  const stages = ["qualify", "proposal", "negotiation", "won", "lost"] as const;
  for (let i = 0; i < 26; i++) {
    const customerRow = data.customers[between(rng, 0, data.customers.length - 1)];
    const stage = pick(rng, stages);
    const createdAt = addDays(today, -between(rng, 5, 200));
    const closed = stage === "won" || stage === "lost";
    const id = data.opportunities.length + 1;

    data.opportunities.push({
      id,
      customer_id: customerRow.id,
      name: `${pick(rng, ["Cooler refresh", "Coffee rollout", "Site expansion", "Care plan renewal", "Multi-site tender"] as const)} — ${customerRow.name}`,
      stage,
      amount: money(between(rng, 800, 26000)),
      probability: stage === "won" ? 100 : stage === "lost" ? 0 : between(rng, 20, 80),
      expected_close: iso(addDays(createdAt, between(rng, 20, 120))),
      owner: pick(rng, REPS),
      created_at: iso(createdAt),
      closed_at: closed ? iso(addDays(createdAt, between(rng, 20, 90))) : null,
      lost_reason:
        stage === "lost"
          ? pick(rng, ["price", "incumbent supplier", "no budget", "went quiet"] as const)
          : null,
    });

    for (let a = 0; a < between(rng, 1, 4); a++) {
      data.activities.push({
        id: data.activities.length + 1,
        opportunity_id: id,
        customer_id: customerRow.id,
        type: pick(rng, ["call", "email", "meeting", "note"] as const),
        occurred_at: iso(addDays(createdAt, between(rng, 1, 60))),
        owner: pick(rng, REPS),
        summary: pick(rng, [
          "Walked through the proposal, asked for a revised price",
          "Left voicemail, no reply yet",
          "Site survey booked",
          "Wants sparkling taps in the two meeting rooms",
          "Finance need a PO before anything ships",
          "Comparing us against their incumbent",
        ] as const),
        created_by: null,
      });
    }
  }

  // One opportunity that has plainly stalled, for someone to notice
  if (data.opportunities.length > 0) {
    const stalled = data.opportunities[0];
    stalled.stage = "negotiation";
    stalled.name = "Multi-site tender — Cormorant Logistics";
    stalled.amount = 41800;
    stalled.probability = 50;
    stalled.created_at = iso(addDays(today, -260));
    stalled.expected_close = iso(addDays(today, -120));
    stalled.closed_at = null;
  }

  // ── Leads not yet converted ──
  const leadCompanies = [
    "Ambleforth Chambers",
    "Beacon Hill Vets",
    "Clearwater Dental",
    "Draymoor Distribution",
    "Everly Care",
    "Foxton Financial",
    "Granby Grammar",
    "Hartwell Studios",
    "Ilford Freight",
    "Jessop Architects",
    "Kelvin Analytics",
    "Ludgate Legal",
  ];
  leadCompanies.forEach((company, index) => {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    data.leads.push({
      id: index + 1,
      company,
      contact_name: `${first} ${last}`,
      email: `${first.toLowerCase()}@${company.toLowerCase().replace(/[^a-z]+/g, "")}.co.uk`,
      source: pick(rng, LEAD_SOURCES),
      status: pick(rng, ["new", "working", "qualified", "disqualified"] as const),
      owner: pick(rng, REPS),
      created_at: iso(addDays(today, -between(rng, 1, 120))),
      notes: null,
    });
  });

  return data;
}
