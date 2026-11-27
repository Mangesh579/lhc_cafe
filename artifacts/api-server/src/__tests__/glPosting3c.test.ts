// Step 3c: purchases, supplier payments, debit notes, expenses, the drawer and consumption, posted on the real routes
// with PGlite + migrations 013 and 014. One worked day (16 Dec 2026, the ledger start) checked line by line, then the 17th.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
} from "@workspace/db";
import { freshDb } from "./pgliteDb";
import { eq } from "drizzle-orm";

const mig = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../db/migrations/${f}`, import.meta.url)), "utf8");
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", token = "";
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
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [u] = await ctx.db.insert(usersTable).values({ username: "acct", passwordHash: "x", role: "admin" }).returning();
  token = signToken({ id: u.id, username: "acct", role: "admin", tokenVersion: u.tokenVersion ?? 0 });
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
  // 17 Dec: nothing sold; counted Rs 35 over
  await ctx.db.insert(cashDaysTable).values({ day: "2026-12-17", openingBalance: "1730", status: "closed", expectedClosing: "1730", countedClosing: "1765", difference: "35", note: "over" });
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("16 Dec: every 3c document posts as the plan says", () => {
  let r: any;
  beforeAll(async () => { r = (await api("GET", "/gl/days/2026-12-16")).body; });
  const entry = (type: string, ref?: string) => r.entries.find((e: any) => e.sourceType === type && (!ref || e.sourceRef === ref));

  it("purchase bills go to stock (kitchen 1400, drink 1410), against 2100 / the drawer / HBL", () => {
    expect(linesOf(entry("purchase_bill", "PJ-3"))).toEqual([["1400", 1000, 0], ["1410", 500, 0], ["2100", 0, 1500]]);
    expect(entry("purchase_bill", "PJ-3").lines[2].supplierId).toBe(sup);
    expect(linesOf(entry("purchase_bill", "PJ-4"))).toEqual([["1400", 300, 0], ["1100", 0, 300]]);
    expect(linesOf(entry("purchase_bill", "PJ-5"))).toEqual([["1410", 200, 0], ["1210", 0, 200]]);
  });

  it("the payment (with a Rs 500 advance) and the debit note go to 2100 with the supplier; purchase expense rows never post", () => {
    expect(linesOf(entry("supplier_payment"))).toEqual([["2100", 2000, 0], ["1100", 0, 2000]]);
    expect(linesOf(entry("debit_note"))).toEqual([["2100", 100, 0], ["1410", 0, 100]]);
    const expenses = r.entries.filter((e: any) => e.sourceType === "expense");
    expect(expenses.map((e: any) => linesOf(e))).toEqual([[["5300", 1800, 0], ["1100", 0, 1800]], [["1400", 200, 0], ["1100", 0, 200]], [["6100", 5000, 0], ["1210", 0, 5000]]]);
    expect(expenses.some((e: any) => e.narration.includes("Food ingredients"))).toBe(false); // the bill's own expense row
  });

  it("petty cash with no bill is flagged for review, with a bill is not", () => {
    expect(r.problems.filter((p: any) => p.code === "no_bill").map((p: any) => p.ref)).toEqual(["CV-2083/84-00003"]);
    expect(r.problems.filter((p: any) => p.level === "fix")).toEqual([]);
  });

  it("the drawer: deposit, owner draw and the short at the close", () => {
    expect(r.entries.filter((e: any) => e.sourceType === "cash_movement").map((e: any) => linesOf(e))).toEqual([[["1200", 400, 0], ["1100", 0, 400]], [["3100", 100, 0], ["1100", 0, 100]]]);
    expect(linesOf(entry("cash_close"))).toEqual([["7050", 120, 0], ["1100", 0, 120]]);
  });

  it("consumption equals the cost snapshots (5000 / 5010 by category), NC to 5200, waste to 5100 (credited by the ingredient's own department, not the record's), against stock by ingredient department", () => {
    expect(linesOf(entry("consumption"))).toEqual([["5000", 120, 0], ["5010", 40, 0], ["5200", 120, 0], ["5100", 40, 0], ["1400", 0, 280], ["1410", 0, 40]]);
  });

  it("cash, payables and sales reconcile with the Cash Drawer and Suppliers; stock is information only", () => {
    const rc = (s: string) => r.reconciliation.find((x: any) => x.check.startsWith(s));
    expect(rc("Cash movement")).toMatchObject({ ledger: -4150, operational: -4150, ok: true });
    expect(rc("Cash at the close")).toMatchObject({ ledger: 1730, operational: 1730, ok: true });
    expect(rc("Payables")).toMatchObject({ ledger: -600, operational: -600, ok: true }); // 1,500 - 2,000 - 100: an advance
    expect(rc("Sales")).toMatchObject({ ledger: 650, operational: 650, ok: true });
    expect(rc("Stock, kitchen")).toMatchObject({ info: true });
    expect(r.problems.filter((p: any) => p.code === "reconciliation")).toEqual([]);
  });

  it("posts with a note; the trial balance balances", async () => {
    const p = await api("POST", "/gl/days/2026-12-16/post", { note: "Gas bill seen; milk bought at the market without a bill" });
    expect(p.status).toBe(201);
    expect(p.body.entries).toBe(13);
    expect((await api("GET", "/gl/trial-balance?to=2026-12-16")).body.balanced).toBe(true);
  });
});

describe("17 Dec", () => {
  it("cash over at the close: Dr 1100 Cr 7050; the cash at the close agrees", async () => {
    const r = (await api("GET", "/gl/days/2026-12-17")).body;
    expect(r.entries.map((e: any) => [e.sourceType, linesOf(e)])).toEqual([["cash_close", [["1100", 35, 0], ["7050", 0, 35]]]]);
    expect(r.reconciliation.find((x: any) => x.check.startsWith("Cash at the close"))).toMatchObject({ ledger: 1765, operational: 1765 });
    expect(r.problems).toEqual([]); // the 16th's "no bill" was acknowledged when it posted; it does not come back
    expect((await api("POST", "/gl/days/2026-12-17/post", {})).status).toBe(201);
  });

  it("a supplier payment voided after posting is reversed on the next day posted", async () => {
    await ctx.db.update(supplierPaymentsTable).set({ status: "void" });
    const r = (await api("GET", "/gl/days/2026-12-18")).body;
    expect(r.late.map((l: any) => [l.action, l.sourceType])).toEqual([["reverse", "supplier_payment"]]);
  });

  it("a drawer reopened after posting reverses its short; closed again with another count, the new difference posts", async () => {
    await ctx.db.update(cashDaysTable).set({ status: "open", countedClosing: null, difference: null }).where(eq(cashDaysTable.day, "2026-12-16"));
    const r = (await api("GET", "/gl/days/2026-12-18")).body;
    expect(r.late.map((l: any) => [l.action, l.sourceType, l.sourceId])).toEqual([["reverse", "supplier_payment", expect.any(Number)], ["reverse", "cash_close", 20261216]]);
    expect((await api("POST", "/gl/days/2026-12-18/post", { note: "payment voided; drawer of the 16th recounted" })).status).toBe(201);
    await ctx.db.update(cashDaysTable).set({ status: "closed", countedClosing: "1800", difference: "-50" }).where(eq(cashDaysTable.day, "2026-12-16"));
    const r2 = (await api("GET", "/gl/days/2026-12-19")).body;
    expect(r2.late.map((l: any) => [l.action, l.sourceType, l.draft?.lines.map((x: any) => [x.accountCode, x.debit, x.credit])])).toEqual([["add", "cash_close", [["7050", 50, 0], ["1100", 0, 50]]]]);
  });
});

describe("expenses: cash only from the drawer (2026-11-27)", () => {
  it("refuses cash that is not from the drawer, and card or QR; allows the drawer, and a cheque with its bank; an existing row keeps its method", async () => {
    const base = { expenseDate: "2026-12-20", type: "indirect", category: "Laundry", amount: 300 };
    expect((await api("POST", "/expenses", { ...base, paymentMethod: "cash" })).body.error).toMatch(/paid from the drawer/);
    expect((await api("POST", "/expenses", { ...base, paymentMethod: "card" })).body.error).toMatch(/bank transfer or cheque/);
    expect((await api("POST", "/expenses", { ...base, paymentMethod: "cash", paidFromDrawer: true })).status).toBe(201);
    const ok = await api("POST", "/expenses", { ...base, paymentMethod: "cheque", bankAccount: "nabil" });
    expect(ok.status).toBe(201);
    expect((await api("PATCH", `/expenses/${ok.body.id}`, { paymentMethod: "cash" })).body.error).toMatch(/paid from the drawer/);
    const [old] = await ctx.db.insert(expensesTable).values({ expenseDate: "2026-12-10", type: "indirect", category: "Laundry", amount: "100", paymentMethod: "cash", paidFromDrawer: false, createdBy: "x" } as any).returning();
    expect((await api("PATCH", `/expenses/${old.id}`, { paymentMethod: "cash", description: "old row, same method" })).status).toBe(200);
  });
});
