// Step 4a: the books from the ledger (Day Book, General Ledger, Cash and Bank Books, Trial Balance by period), on the step 3c
// worked days (16 and 17 Dec 2026, copied from glPosting3c.test.ts) plus a credit customer, posted through the real routes.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});

import {
  usersTable, ordersTable, orderItemsTable, orderPaymentsTable, menuItemsTable, menuCategoriesTable, recipesTable, inventoryItemsTable, suppliersTable,
  purchaseBillsTable, purchaseBillItemsTable, supplierPaymentsTable, debitNotesTable, debitNoteItemsTable, expensesTable, cashMovementsTable, cashDaysTable, wasteLogsTable,
  loyaltyCustomersTable, customerReceiptsTable,
} from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { eq } from "drizzle-orm";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", token = "", staffToken = "", supToken = "";
let cust = 0;
let sup = 0, rice = 0, milk = 0, latte = 0, sandwich = 0;

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
let n = 0;
async function bill(o: Record<string, unknown>, items: [number, string, number][]) {
  const total = items.reduce((t, [, , a]) => t + a, 0);
  const [b] = await ctx.db.insert(purchaseBillsTable).values({ pjNumber: `PJ-${++n}`, supplierId: sup, supplierName: "Valley Traders", supplierPan: "600000001", billNumber: `B-${n}`, billNumberKey: `b-${n}`,
    billDate: "2026-12-16", terms: "credit", dueDate: "2026-12-31", subtotal: String(total), total: String(total), createdBy: "x", ...o } as any).returning();
  for (const [inv, dept, amount] of items) await ctx.db.insert(purchaseBillItemsTable).values({ billId: b.id, inventoryItemId: inv, itemName: dept, department: dept, quantity: "1", unit: "kg", rate: String(amount), amount: String(amount), lineTotal: String(amount), stockBefore: "0", stockAfter: "1", costAfter: String(amount) });
  return b.id as number;
}
async function order(items: [number, number, number, string][], parts: [string, number][], o: Record<string, unknown> = {}) {
  const at = new Date("2026-12-16T06:00:00Z");
  const total = parts.reduce((t, [, a]) => t + a, 0) || items.reduce((t, [, q, p]) => t + q * p, 0);
  const [r] = await ctx.db.insert(ordersTable).values({ totalAmount: String(total), paymentMethod: parts[0]?.[0] ?? "nc", paymentStatus: "paid", orderStatus: "completed", invoiceNumber: `2083/84-0${++n}`, paidAt: at, createdAt: at, ...o } as any).returning();
  for (const [m, q, p, cost] of items) await ctx.db.insert(orderItemsTable).values({ orderId: r.id, menuItemId: m, quantity: q, unitPrice: String(p), subtotal: String(q * p), kotNumber: 1, unitCost: cost, costComplete: true });
  for (const [mode, amount] of parts) await ctx.db.insert(orderPaymentsTable).values({ orderId: r.id, mode, amount: String(amount), paidAt: at } as any);
  return r.id as number;
}
const linesOf = (e: any) => e.lines.map((l: any) => [l.accountCode, l.debit, l.credit]);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-20T06:00:00Z"));
  ctx = await freshDb();
  await ctx.client.exec(mig("013_ledger_accounts_journal.sql"));
  await ctx.client.exec(mig("014_ledger_posting.sql"));
  await ctx.client.exec(mig("015_period_lock.sql"));
  await ctx.client.exec(mig("016_stock_adjustments.sql"));
  await ctx.client.exec(mig("017_report_indexes.sql"));
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [u] = await ctx.db.insert(usersTable).values({ username: "acct", passwordHash: "x", role: "admin" }).returning();
  token = signToken({ id: u.id, username: "acct", role: "admin", tokenVersion: u.tokenVersion ?? 0 });
  const [s1] = await ctx.db.insert(usersTable).values({ username: "till", passwordHash: "x", role: "staff" }).returning();
  const [s2] = await ctx.db.insert(usersTable).values({ username: "sup", passwordHash: "x", role: "supervisor" }).returning();
  staffToken = signToken({ id: s1.id, username: "till", role: "staff", tokenVersion: 0 });
  supToken = signToken({ id: s2.id, username: "sup", role: "supervisor", tokenVersion: 0 });
  [{ id: sup }] = await ctx.db.insert(suppliersTable).values({ name: "Valley Traders", pan: "600000001", createdBy: "x" }).returning();
  [{ id: rice }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Rice", unit: "kg", department: "kitchen", currentStock: "100", costPerUnit: "20" }).returning();
  [{ id: milk }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "10", costPerUnit: "100" }).returning();
  const [coffee] = await ctx.db.insert(menuCategoriesTable).values({ name: "Coffee", revenueKind: "beverage" }).returning();
  const [food] = await ctx.db.insert(menuCategoriesTable).values({ name: "Food", revenueKind: "food" }).returning();
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "250", categoryId: coffee.id }).returning();
  [{ id: sandwich }] = await ctx.db.insert(menuItemsTable).values({ name: "Sandwich", price: "400", categoryId: food.id }).returning();
  await ctx.db.insert(recipesTable).values([{ menuItemId: latte, inventoryItemId: milk, quantityRequired: "0.2" }, { menuItemId: sandwich, inventoryItemId: rice, quantityRequired: "0.5" }]);
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  // Opening balances: the drawer's 6,000 and the bank
  await api("POST", "/gl/opening/lines", { accountCode: "1100", debit: 6000, memo: "Drawer count" });
  await api("POST", "/gl/opening/lines", { accountCode: "1200", debit: 50000, memo: "Nabil statement" });
  await api("POST", "/gl/opening/confirm");

  // 16 Dec: sales, an NC bill, purchases, a payment with an advance, a return, expenses, the drawer, waste
  await order([[latte, 1, 250, "40"], [sandwich, 1, 400, "120"]], [["cash", 650]]);
  await order([[sandwich, 1, 400, "120"]], [], { isNc: true, totalAmount: "120", paymentMethod: "nc", ncPersonName: "Owner" });
  const b1 = await bill({}, [[rice, "kitchen", 1000], [milk, "drink", 500]]);                                // credit
  const b2 = await bill({ terms: "cash", paidVia: "drawer" }, [[rice, "kitchen", 300]]);                     // paid from the drawer
  await bill({ terms: "cash", paidVia: "cheque", paidFromAccount: "hbl" }, [[milk, "drink", 200]]);          // cheque on HBL
  // the purchase bill's own expense row (as the purchase flow makes it): never posted, but the drawer counts it as a payout
  await ctx.db.insert(expensesTable).values({ expenseDate: "2026-12-16", type: "direct", category: "Food ingredients (meat, vegetables, fruits)", amount: "300", paymentMethod: "cash", paidFromDrawer: true, purchaseBillId: b2, createdBy: "x" } as any);
  await ctx.db.insert(supplierPaymentsTable).values({ voucherNo: "CV-2083/84-00001", voucherType: "CV", supplierId: sup, paymentDate: "2026-12-16", paidVia: "drawer", amount: "2000", createdBy: "x" });
  const [dn] = await ctx.db.insert(debitNotesTable).values({ noteNo: "DN-1", supplierId: sup, billId: b1, noteDate: "2026-12-16", reason: "sour", subtotal: "100", total: "100", createdBy: "x" }).returning();
  await ctx.db.insert(debitNoteItemsTable).values({ debitNoteId: dn.id, billItemId: 1, inventoryItemId: milk, itemName: "Milk", department: "drink", quantity: "1", unit: "L", amount: "100", lineTotal: "100", stockBefore: "1", stockAfter: "0" });
  await ctx.db.insert(expensesTable).values([
    { expenseDate: "2026-12-16", type: "indirect", category: "Cooking gas (LPG)", amount: "1800", paymentMethod: "cash", paidFromDrawer: true, billNumber: "G-1", voucherNo: "CV-2083/84-00002", createdBy: "x" },
    { expenseDate: "2026-12-16", type: "direct", category: "Milk and dairy products", amount: "200", paymentMethod: "cash", paidFromDrawer: true, billNumber: null, voucherNo: "CV-2083/84-00003", createdBy: "x" },
    { expenseDate: "2026-12-16", type: "indirect", category: "Rent and property maintenance", amount: "5000", paymentMethod: "cheque", bankAccount: "hbl", createdBy: "x" },
  ] as any);
  await ctx.db.insert(cashMovementsTable).values([
    { day: "2026-12-16", kind: "deposit", amount: "400", bankAccount: "nabil", createdBy: "x" },
    { day: "2026-12-16", kind: "owner_draw", amount: "100", createdBy: "x" },
  ] as any);
  await ctx.db.insert(wasteLogsTable).values({ inventoryItemId: rice, itemName: "Rice", quantity: "2", unit: "kg", reason: "spilled", wasteValue: "0", department: "drink", createdAt: new Date("2026-12-16T08:00:00Z") });
  // drawer: 6,000 + 650 - payouts 2,300 - supplier 2,000 - deposit 400 - draw 100 = 1,850 expected; counted 1,730: Rs 120 short
  await ctx.db.insert(cashDaysTable).values({ day: "2026-12-16", openingBalance: "6000", status: "closed", expectedClosing: "1850", countedClosing: "1730", difference: "-120", note: "short" });
  [{ id: cust }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Asha", phone: "9800000001" }).returning();
  const credit = await order([[latte, 2, 250, "40"]], [["credit", 500]], { loyaltyCustomerId: cust, paymentMethod: "credit" });
  void credit;
  await ctx.db.insert(customerReceiptsTable).values({ voucherNo: "RV-2083/84-00001", customerId: cust, receiptDate: "2026-12-17", mode: "bank", bankAccount: "nabil", amount: "300", createdBy: "x" } as any);
  // 17 Dec: nothing sold; counted Rs 35 over
  await ctx.db.insert(cashDaysTable).values({ day: "2026-12-17", openingBalance: "1730", status: "closed", expectedClosing: "1730", countedClosing: "1765", difference: "35", note: "over" });
  const p16 = await api("POST", "/gl/days/2026-12-16/post", { note: "worked day" });
  expect(p16.status, JSON.stringify(p16.body)).toBe(201);
  const p17 = await api("POST", "/gl/days/2026-12-17/post", { note: "worked day" });
  expect(p17.status, JSON.stringify(p17.body)).toBe(201);
}, 180000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

// the API allows 120 requests a minute per address: each test starts a minute later (still the 20th in Nepal)
beforeEach(() => { vi.setSystemTime(new Date(Date.now() + 61000)); });
const POUSH = "month=2083-09";
const as = async (tok: string, path: string) => { const r = await fetch(base + path, { headers: { Authorization: `Bearer ${tok}` } }); return { status: r.status, body: await r.json().catch(() => null) as any }; };
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe("periods and the Posted up to line", () => {
  it("a BS month, the first fiscal year from the ledger start, and FY 2084/85 Shrawan 1 to the end of Ashadh", async () => {
    const m = (await api("GET", `/reports/day-book?${POUSH}`)).body.period;
    expect(m).toMatchObject({ from: "2026-12-16", label: expect.stringMatching(/Poush 2083/) });
    expect((await api("GET", "/reports/day-book?fy=2083/84")).body.period).toMatchObject({ from: "2026-12-16", label: "FY 2083/84" });
    const { adOfBs } = await import("../lib/fiscal");
    const { addDays } = await import("../lib/ledgerData");
    expect((await api("GET", "/reports/day-book?fy=2084/85")).body.period).toMatchObject({ from: adOfBs(2084, 4, 1), to: addDays(adOfBs(2085, 4, 1), -1) });
    expect((await api("GET", "/reports/day-book?day=2026-12-16")).body.period).toMatchObject({ from: "2026-12-16", to: "2026-12-16" });
    expect((await api("GET", "/reports/day-book?from=2026-12-17&to=2026-12-16")).status).toBe(400);
  });

  it("every report says Posted up to the 17th, and warns about the days of the period not posted yet", async () => {
    for (const path of [`/reports/day-book?${POUSH}`, `/reports/ledger/1100?${POUSH}`, `/reports/book/1100?${POUSH}`, `/reports/trial-balance?${POUSH}`, "/reports/trial-balance?to=2026-12-20"]) {
      const { posted } = (await api("GET", path)).body;
      expect(posted.postedUpTo, path).toBe("2026-12-17");
    }
    // Poush to today (the 20th): 16 to 20 is 5 days, 2 posted
    const { posted } = (await api("GET", `/reports/day-book?${POUSH}`)).body;
    expect(posted.unposted).toBe(3);
    expect(posted.warning).toBe("3 day(s) in this period are not posted yet; their figures are not included.");
    expect((await api("GET", "/reports/day-book?day=2026-12-16")).body.posted.warning).toBeNull();
    expect((await api("GET", "/reports/day-book?month=2083-08")).body.posted.warning).toMatch(/before the ledger start/);
  });
});

describe("Day Book", () => {
  it("its totals for a period equal the Trial Balance movement for that period", async () => {
    const db_ = (await api("GET", `/reports/day-book?${POUSH}`)).body;
    const tb = (await api("GET", `/reports/trial-balance?${POUSH}`)).body;
    expect(db_.totals.debit).toBe(db_.totals.credit);
    expect(db_.totals.debit).toBe(tb.totals.periodDr);
    expect(db_.totals.credit).toBe(tb.totals.periodCr);
    expect(db_.days.map((d: any) => d.day)).toEqual(["2026-12-16", "2026-12-17"]);
    for (const d of db_.days) expect(sum(d.entries.flatMap((e: any) => e.lines.map((l: any) => l.debit)))).toBe(d.debit);
  });

  it("each voucher-type filter returns only its type", async () => {
    const all = (await api("GET", `/reports/day-book?${POUSH}`)).body;
    const types = [...new Set(all.days.flatMap((d: any) => d.entries.map((e: any) => e.voucherType)))] as string[];
    expect(types.length).toBeGreaterThan(5);
    let n = 0;
    for (const t of types) {
      const r = (await api("GET", `/reports/day-book?${POUSH}&types=${t}`)).body;
      const got = r.days.flatMap((d: any) => d.entries.map((e: any) => e.voucherType));
      expect(new Set(got), t).toEqual(new Set([t]));
      n += r.count;
    }
    expect(n).toBe(all.count);
  });

  it("filters by kind, account, customer and text", async () => {
    const opening = (await api("GET", `/reports/day-book?${POUSH}&kinds=opening`)).body;
    expect(opening.days.flatMap((d: any) => d.entries.map((e: any) => e.voucherType))).toEqual(["OPEN"]);
    const cash = (await api("GET", `/reports/day-book?${POUSH}&account=1100`)).body;
    expect(cash.days.every((d: any) => d.entries.every((e: any) => e.lines.some((l: any) => l.accountCode === "1100")))).toBe(true);
    const asha = (await api("GET", `/reports/day-book?${POUSH}&customerId=${cust}`)).body;
    expect(asha.count).toBe(2);
    expect((await api("GET", `/reports/day-book?${POUSH}&q=RV-2083`)).body.count).toBe(1);
  });
});

describe("General Ledger", () => {
  it("opening + movement = closing in each account's own direction, and the closing equals the Trial Balance", async () => {
    const tb = (await api("GET", "/reports/trial-balance?day=2026-12-17&hideZero=false")).body;
    const rows = tb.groups.flatMap((g: any) => g.rows);
    let credits = 0;
    for (const a of rows.filter((r: any) => r.periodDr || r.periodCr || r.openingDr || r.openingCr)) {
      const gl = (await api("GET", `/reports/ledger/${a.code}?day=2026-12-17`)).body;
      const move = gl.account.normalSide === "credit" ? gl.totals.credit - gl.totals.debit : gl.totals.debit - gl.totals.credit;
      expect(Math.round((gl.opening + move) * 100) / 100, a.code).toBe(gl.closing);
      const tbNet = a.closingDr - a.closingCr;
      expect(gl.closing, a.code).toBe(Math.round((gl.account.normalSide === "credit" ? -tbNet : tbNet) * 100) / 100);
      if (gl.lines.length) expect(gl.lines[gl.lines.length - 1].balance).toBe(gl.closing);
      if (gl.account.normalSide === "credit") credits++;
    }
    expect(credits).toBeGreaterThan(0);
  });

  it("shows the other side of each entry; a later page changes no total", async () => {
    const gl = (await api("GET", `/reports/ledger/1100?${POUSH}`)).body;
    expect(gl.lines.find((l: any) => l.voucherType === "SJ").otherSide).toMatch(/sales/i);
    const p2 = (await api("GET", `/reports/ledger/1100?${POUSH}&page=2`)).body;
    expect(p2.lines).toEqual([]);
    expect([p2.opening, p2.totals, p2.closing]).toEqual([gl.opening, gl.totals, gl.closing]);
  });

  it("1300 and 2100: each party's closing equals its own ledger, and the parties add up to the account", async () => {
    for (const [code, key, id] of [["1300", "customerId", () => cust], ["2100", "supplierId", () => sup]] as const) {
      const gl = (await api("GET", `/reports/ledger/${code}?${POUSH}`)).body;
      expect(gl.parties.length).toBeGreaterThan(0);
      expect(sum(gl.parties.map((p: any) => p.closing))).toBe(gl.closing);
      const one = (await api("GET", `/reports/ledger/${code}?${POUSH}&${key}=${id()}`)).body;
      expect(one.closing).toBe(gl.parties.find((p: any) => p.id === id()).closing);
      expect(one.parties).toBeUndefined();
    }
    // Asha: 500 on credit, 300 received
    expect((await api("GET", `/reports/ledger/1300?${POUSH}&customerId=${cust}`)).body.closing).toBe(200);
  });

  it("a header account summarises its children", async () => {
    const h = (await api("GET", `/reports/ledger/1000?${POUSH}`)).body;
    expect(h.account.isHeader).toBe(true);
    expect(h.children.find((c: any) => c.code === "1100")).toBeTruthy();
    expect((await api("GET", `/reports/ledger/9999?${POUSH}`)).status).toBe(404);
  });
});

describe("Cash and Bank Books", () => {
  it("the Cash Book closes at 1100, and a closed day's closing equals the drawer's count", async () => {
    const b = (await api("GET", `/reports/book/1100?${POUSH}`)).body;
    const gl = (await api("GET", `/reports/ledger/1100?${POUSH}`)).body;
    expect(b.closing).toBe(gl.closing);
    const d16 = b.days.find((d: any) => d.day === "2026-12-16"), d17 = b.days.find((d: any) => d.day === "2026-12-17");
    expect(d16.counted).toBe(1730); expect(d16.closing).toBe(1730);
    expect(d17.counted).toBe(1765); expect(d17.closing).toBe(1765);
    expect(b.totals.receipts).toBe(gl.totals.debit);
  });

  it("the Bank Books equal 1200 and 1210, with references", async () => {
    for (const code of ["1200", "1210"]) {
      const b = (await api("GET", `/reports/book/${code}?${POUSH}`)).body;
      expect(b.closing).toBe((await api("GET", `/reports/ledger/${code}?${POUSH}`)).body.closing);
      expect(b.days.flatMap((d: any) => d.lines).every((l: any) => "reference" in l)).toBe(true);
    }
    expect((await api("GET", `/reports/book/1300?${POUSH}`)).status).toBe(400);
  });
});

describe("Trial Balance by period", () => {
  it("opening + movement = closing for each account, and all six columns balance", async () => {
    const tb = (await api("GET", "/reports/trial-balance?day=2026-12-17")).body;
    expect(tb.mode).toBe("period");
    expect(tb.balanced).toBe(true);
    for (const r of tb.groups.flatMap((g: any) => g.rows)) {
      expect(Math.round((r.openingDr - r.openingCr + r.periodDr - r.periodCr) * 100) / 100, r.code).toBe(Math.round((r.closingDr - r.closingCr) * 100) / 100);
    }
    expect(tb.totals.openingDr).toBe(tb.totals.openingCr);
    expect(tb.totals.periodDr).toBe(tb.totals.periodCr);
    expect(tb.totals.closingDr).toBe(tb.totals.closingCr);
    expect(tb.totals.openingDr).toBeGreaterThan(0); // the 16th is the opening
    expect(sum(tb.groups.map((g: any) => g.subtotal.closingDr))).toBe(tb.totals.closingDr);
  });
  it("the closing equals the Trial Balance as at the same day", async () => {
    const p = (await api("GET", "/reports/trial-balance?day=2026-12-17&hideZero=false")).body;
    const a = (await api("GET", "/reports/trial-balance?to=2026-12-17")).body;
    expect(a.mode).toBe("asAt");
    for (const r of a.rows) {
      const x = p.groups.flatMap((g: any) => g.rows).find((y: any) => y.code === r.code);
      expect(Math.round((x.closingDr - x.closingCr) * 100) / 100, r.code).toBe(r.net);
    }
  });
  it("hides accounts with nothing in them unless asked", async () => {
    const h = (await api("GET", `/reports/trial-balance?${POUSH}`)).body.groups.flatMap((g: any) => g.rows).length;
    const all = (await api("GET", `/reports/trial-balance?${POUSH}&hideZero=false`)).body.groups.flatMap((g: any) => g.rows).length;
    expect(all).toBeGreaterThan(h);
  });
});

describe("drill-down", () => {
  it("every source_type the posting rules use has a link", async () => {
    const { SOURCE_LINKS } = await import("../lib/reports/drilldown");
    const lib = (f: string) => readFileSync(fileURLToPath(new URL(`../lib/${f}`, import.meta.url)), "utf8");
    const used = new Set([...["postingRules.ts", "openingBalances.ts", "glPosting.ts"].flatMap(f => [...lib(f).matchAll(/sourceType: "([a-z_]+)"/g)].map(m => m[1]))]);
    expect(used.size).toBeGreaterThan(10);
    for (const t of used) expect(SOURCE_LINKS[t], t).toBeTruthy();
    expect(SOURCE_LINKS.stock_adjustment.page).toBe("Inventory");
  });

  it("a line opens its entry, and the entry opens its source document, for every source in the journal", async () => {
    const all = (await api("GET", `/reports/day-book?${POUSH}`)).body;
    const seen = new Set<string>();
    for (const e of all.days.flatMap((d: any) => d.entries)) {
      const d = (await api("GET", `/reports/entries/${e.id}`)).body;
      expect(d.entry.entryNo).toBe(e.entryNo);
      expect(d.entry.lines.length).toBeGreaterThan(1);
      expect(d.source.path).toMatch(/^\//);
      if (e.sourceType && e.sourceType !== "opening" && !seen.has(e.sourceType)) {
        seen.add(e.sourceType);
        const doc = await api("GET", `/reports/source/${e.sourceType}/${e.sourceId}`);
        expect(doc.status, `${e.sourceType}: ${JSON.stringify(doc.body)}`).toBe(200);
        expect(doc.body.title).toBeTruthy();
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it("the purchase bill opens that bill; the Consumption view lists the day's entry with its lines", async () => {
    const pb = (await api("GET", `/reports/day-book?${POUSH}&types=PB`)).body.days[0].entries[0];
    expect((await api("GET", `/reports/entries/${pb.id}`)).body.source.path).toBe(`/suppliers?bill=${pb.sourceId}`);
    const c = (await api("GET", "/reports/consumption/2026-12-16")).body;
    expect(c.entries.filter((e: any) => e.inForce)).toHaveLength(1);
    expect(c.entries[0].lines.some((l: any) => l.accountCode === "5000" || l.accountCode === "5010")).toBe(true);
  });
});

describe("who and what", () => {
  const PATHS = [`/reports/meta`, `/reports/day-book?${POUSH}`, `/reports/ledger/1100?${POUSH}`, `/reports/book/1100?${POUSH}`, `/reports/trial-balance?${POUSH}`, "/reports/trial-balance?to=2026-12-17",
    "/reports/entries/1", "/reports/source/order/1", "/reports/consumption/2026-12-16"];

  it("staff and supervisor get 403 on every report route", async () => {
    for (const p of PATHS) for (const t of [staffToken, supToken]) expect((await as(t, p)).status, p).toBe(403);
  });

  it("reports never write: every table's row count is unchanged after calling every report", async () => {
    const count = async () => {
      const tables = (await ctx.client.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows;
      const out: Record<string, number> = {};
      for (const { t } of tables) out[t] = Number((await ctx.client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n);
      return out;
    };
    const before = await count();
    expect(before.journal_entries).toBeGreaterThan(10);
    for (const p of PATHS) expect((await api("GET", p)).status, p).toBe(200);
    for (const t of ["PB", "SJ", "CO"]) {
      const e = (await api("GET", `/reports/day-book?${POUSH}&types=${t}`)).body.days[0].entries[0];
      await api("GET", `/reports/entries/${e.id}`); await api("GET", `/reports/source/${e.sourceType}/${e.sourceId}`);
    }
    for (const c of ["1300", "2100", "1000", "1200"]) await api("GET", `/reports/ledger/${c}?fy=2083/84`);
    expect(await count()).toEqual(before);
  });

  it("migration 017 runs twice", async () => {
    await ctx.client.exec(mig("017_report_indexes.sql"));
    await ctx.client.exec(mig("017_report_indexes.sql"));
  });
});
