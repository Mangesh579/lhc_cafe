// Step 4b: customer and supplier statements from the journal, and the Balance Sheet on real posted data: the step 3c
// worked days (16 and 17 Dec 2026) plus Asha (a credit sale and a receipt) and Bikash (an advance with no invoice).
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
let cust = 0, custB = 0;
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
  await ctx.client.exec(mig("018_report_settings.sql"));
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
  [{ id: custB }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Bikash", phone: "9800000002" }).returning();
  await ctx.db.insert(customerReceiptsTable).values({ voucherNo: "RV-2083/84-00002", customerId: custB, receiptDate: "2026-12-17", mode: "bank", bankAccount: "nabil", amount: "400", createdBy: "x" } as any);
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


describe("customer statements", () => {
  it("Asha: the invoice and the receipt with a running balance, closing 200, agreeing with Receivables", async () => {
    const s = (await api("GET", `/reports/customers/${cust}/statement?${POUSH}`)).body;
    expect(s.party).toMatchObject({ name: "Asha", phone: "9800000001", creditDays: 15 });
    expect(s.lines.map((l: any) => [l.what, l.debit, l.credit, l.balance])).toEqual([["Invoice", 500, 0, 500], ["Receipt", 0, 300, 200]]);
    expect([s.opening, s.closing, s.closingSays]).toEqual([0, 200, "owes us"]);
    expect(s.agreement).toMatchObject({ at: "2026-12-17", ledger: 200, operational: 200, agrees: true });
    expect(s.posted.postedUpTo).toBe("2026-12-17");
  });
  it("Bikash paid in advance: a credit balance that agrees with Receivables", async () => {
    const s = (await api("GET", `/reports/customers/${custB}/statement?${POUSH}`)).body;
    expect([s.closing, s.closingSays]).toEqual([-400, "paid in advance"]);
    expect(s.agreement.agrees).toBe(true);
    expect((await api("GET", `/reports/customers/99999/statement?${POUSH}`)).status).toBe(404);
  });
  it("the all-customers summary adds up to 1300", async () => {
    const s = (await api("GET", `/reports/customers?${POUSH}`)).body;
    expect(s.parties.map((p: any) => [p.name, p.closing])).toEqual([["Asha", 200], ["Bikash", -400]]);
    expect(s.totals.closing).toBe(-200);
    expect(s.account).toEqual({ code: "1300", closing: -200 });
    expect(s.agrees).toBe(true);
  });
});

describe("supplier statements", () => {
  it("Valley Traders: the credit bill, the payment with an advance and the debit note; advance paid, agreeing with the supplier ledger", async () => {
    const s = (await api("GET", `/reports/suppliers/${sup}/statement?${POUSH}`)).body;
    expect(s.party).toMatchObject({ name: "Valley Traders", pan: "600000001" });
    expect(s.lines.map((l: any) => l.what)).toEqual(expect.arrayContaining(["Bill", "Payment", "Debit note"]));
    // 1,500 billed on credit, 2,000 paid, 100 returned: 600 paid in advance
    expect([s.closing, s.closingSays]).toEqual([-600, "advance paid"]);
    expect(s.agreement).toMatchObject({ ledger: -600, operational: -600, agrees: true });
  });
  it("the all-suppliers summary adds up to 2100", async () => {
    const s = (await api("GET", `/reports/suppliers?${POUSH}`)).body;
    expect(s.totals.closing).toBe(s.account.closing);
    expect(s.agrees).toBe(true);
  });
});

describe("the Balance Sheet on posted data", () => {
  it("the supplier advance under assets, Bikash's advance under liabilities, and it balances", async () => {
    const b = (await api("GET", "/reports/balance-sheet?at=2026-12-17&compare=prev")).body;
    expect(b.balanced).toBe(true);
    const v = (k: string) => b.rows.find((r: any) => r.key === k).values.current;
    expect(v("SUPPLIER_ADV")).toBe(600);
    expect(v("AR")).toBe(200);
    expect(v("CUSTOMER_ADV")).toBe(400);
    expect(v("3100")).toBe(100); // the owner's draw from the drawer
    expect(b.columns.find((c: any) => c.key === "previous").reason).toMatch(/Before the ledger start/);
  });
  it("the P&L for the two days equals the Trial Balance", async () => {
    const p = (await api("GET", `/reports/profit-loss?${POUSH}`)).body;
    expect(p.check.ok).toBe(true);
  });
});

describe("who and what (4b routes)", () => {
  const PATHS = () => [`/reports/profit-loss?${POUSH}`, "/reports/balance-sheet?at=2026-12-17", "/reports/compare?period=month&at=2083/09",
    `/reports/customers?${POUSH}`, `/reports/suppliers?${POUSH}`, `/reports/customers/${cust}/statement?${POUSH}`, `/reports/suppliers/${sup}/statement?${POUSH}`];
  it("staff and supervisor get 403 on every new route", async () => {
    for (const p of PATHS()) for (const t of [staffToken, supToken]) expect((await as(t, p)).status, p).toBe(403);
  });
  it("they never write: every table's row count is unchanged after calling them all", async () => {
    const count = async () => {
      const tables = (await ctx.client.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows;
      const out: Record<string, number> = {};
      for (const { t } of tables) out[t] = Number((await ctx.client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n);
      return out;
    };
    const before = await count();
    for (const p of PATHS()) expect((await api("GET", p)).status, p).toBe(200);
    for (const p of PATHS()) await api("GET", p.includes("?") ? `${p}&compare=none` : p);
    expect(await count()).toEqual(before);
  });
});
