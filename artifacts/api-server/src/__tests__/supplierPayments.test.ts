// Supplier payments, opening bills and aging (step 2, part B): the real Express routes on an in-memory PostgreSQL (PGlite).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});

import { eq } from "drizzle-orm";
import { usersTable, inventoryItemsTable, expensesTable, cashDaysTable, supplierPaymentsTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

const TODAY = "2026-11-24"; // Nepal day; fiscal year 2083/84
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let rice: number, dairy: number, veg: number;
const bills: Record<string, number> = {};
const pays: Record<string, number> = {};

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const countExpenses = async () => (await ctx.db.select().from(expensesTable)).length;
async function creditBill(supplierId: number, pan: string, billNumber: string, billDate: string, creditDays: number, amount: number) {
  const r = await api("acct", "POST", "/purchase-bills", { supplierId, pan, billNumber, billDate, terms: "credit", creditDays, lines: [{ inventoryItemId: rice, quantity: 1, amount }] });
  expect(r.status).toBe(201);
  return r.body.id as number;
}
const bill = async (id: number) => (await api("acct", "GET", `/purchase-bills/${id}`)).body;
const pay = (body: any) => api("acct", "POST", "/supplier-payments", { supplierId: dairy, paymentDate: TODAY, ...body });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T06:00:00Z`));
  process.env.UPLOAD_DIR = join(tmpdir(), "cafe-nexus-test-uploads");
  ctx = await freshDb();
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["super", "supervisor"], ["chef", "head_chef"], ["staff", "staff"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  [{ id: rice }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Rice", unit: "kg", department: "kitchen", currentStock: "0" }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  dairy = (await api("acct", "POST", "/suppliers", { name: "Dairy Co", pan: "123456789", creditDays: 15 })).body.id;
  veg = (await api("acct", "POST", "/suppliers", { name: "Veg House", pan: "222333444", creditDays: 15 })).body.id;
  bills.A = await creditBill(dairy, "123456789", "INV-A", "2026-11-01", 15, 1000); // due 2026-11-16
  bills.B = await creditBill(dairy, "123456789", "INV-B", "2026-11-20", 15, 500);  // due 2026-12-05
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("payments", () => {
  it("a partial payment (PV, online from HBL) lowers one bill and creates no expense", async () => {
    const before = await countExpenses();
    const r = await pay({ amount: 600, paidVia: "online", reference: "TXN 1", paidFromAccount: "hbl", allocations: [{ billId: bills.A, amount: 600 }] });
    expect(r.status).toBe(201);
    pays.p1 = r.body.id;
    expect(r.body).toMatchObject({ voucherNo: "PV-2083/84-00001", voucherType: "PV", amount: 600, allocated: 600, unallocated: 0 });
    expect((await bill(bills.A)).balance).toBe(400);
    expect((await bill(bills.B)).balance).toBe(500);
    expect(await countExpenses()).toBe(before);
  });

  it("one payment can cover several bills; the rest stays as an advance", async () => {
    const r = await pay({ amount: 1000, paidVia: "cheque", reference: "CHQ 77", paidFromAccount: "nabil", allocations: [{ billId: bills.A, amount: 400 }, { billId: bills.B, amount: 500 }] });
    expect(r.status).toBe(201);
    pays.p2 = r.body.id;
    expect(r.body).toMatchObject({ voucherNo: "PV-2083/84-00002", unallocated: 100 });
    expect([(await bill(bills.A)).balance, (await bill(bills.B)).balance]).toEqual([0, 0]);
    const l = await api("acct", "GET", `/suppliers/${dairy}/ledger`);
    expect(l.body.totals).toMatchObject({ balance: 0, advance: 100, net: -100 });
    expect(l.body.entries.at(-1).balance).toBe(-100);
    expect((await api("acct", "GET", "/suppliers")).body.find((s: any) => s.id === dairy)).toMatchObject({ advance: 100, net: -100 });
  });

  it("refuses allocations beyond a bill's balance, beyond the payment, or to another supplier's bill", async () => {
    const vbill = await creditBill(veg, "222333444", "V-1", "2026-11-20", 15, 300);
    expect((await pay({ amount: 100, paidVia: "drawer", allocations: [{ billId: bills.A, amount: 1 }] })).status).toBe(400); // A is paid
    expect((await pay({ amount: 100, paidVia: "drawer", allocations: [{ billId: vbill, amount: 50 }] })).status).toBe(400);  // Veg's bill
    expect((await api("acct", "POST", "/supplier-payments", { supplierId: veg, paymentDate: TODAY, amount: 100, paidVia: "online", reference: "T", paidFromAccount: "nabil", allocations: [{ billId: vbill, amount: 150 }] })).status).toBe(400);
  });

  it("the advance is allocated later to a new bill", async () => {
    bills.C = await creditBill(dairy, "123456789", "INV-C", "2026-11-22", 15, 250);
    expect((await api("acct", "POST", `/supplier-payments/${pays.p2}/allocate`, { allocations: [{ billId: bills.C, amount: 150 }] })).status).toBe(400); // only 100 left
    const r = await api("acct", "POST", `/supplier-payments/${pays.p2}/allocate`, { allocations: [{ billId: bills.C, amount: 100 }] });
    expect(r.status).toBe(200);
    expect(r.body.unallocated).toBe(0);
    expect((await bill(bills.C)).balance).toBe(150);
  });

  it("a cash payment from the drawer (CV) lowers that day's expected cash, without an expense", async () => {
    await ctx.db.insert(cashDaysTable).values({ day: "2026-11-22", openingBalance: "1000", status: "open" });
    const dayBefore = (await api("acct", "GET", "/cash/day?date=2026-11-22")).body.expected;
    const exps = await countExpenses();
    const r = await pay({ paymentDate: "2026-11-22", amount: 150, paidVia: "drawer", allocations: [{ billId: bills.C, amount: 150 }] });
    expect(r.status).toBe(201);
    pays.cv = r.body.id;
    expect(r.body).toMatchObject({ voucherNo: "CV-2083/84-00001", voucherType: "CV", paidFromAccount: null });
    const day = (await api("acct", "GET", "/cash/day?date=2026-11-22")).body;
    expect(day.supplierPaymentsTotal).toBe(150);
    expect(day.supplierPayments[0]).toMatchObject({ voucherNo: "CV-2083/84-00001", supplier: "Dairy Co" });
    expect(day.expected).toBe(dayBefore - 150);
    expect(await countExpenses()).toBe(exps);
    const ledger = (await api("acct", "GET", "/ledger/mode?mode=cash&from=2026-11-22&to=2026-11-22")).body;
    expect(ledger.entries.some((e: any) => e.type === "supplier_payment" && e.outAmt === 150)).toBe(true);
  });

  it("refuses a drawer payment, or voiding one, on a closed drawer day", async () => {
    await ctx.db.insert(cashDaysTable).values({ day: "2026-11-21", openingBalance: "0", status: "closed" });
    const r = await pay({ paymentDate: "2026-11-21", amount: 10, paidVia: "drawer" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cash drawer for 2026-11-21 is closed/);
    await ctx.db.update(cashDaysTable).set({ status: "closed" }).where(eq(cashDaysTable.day, "2026-11-22"));
    const v = await api("acct", "POST", `/supplier-payments/${pays.cv}/void`, { reason: "Wrong supplier" });
    expect(v.status).toBe(400);
    expect(v.body.error).toMatch(/2026-11-22 is closed/);
    await ctx.db.update(cashDaysTable).set({ status: "open" }).where(eq(cashDaysTable.day, "2026-11-22"));
  });

  it("void (admin or accountant) restores the bill balances and the drawer", async () => {
    expect((await api("super", "POST", `/supplier-payments/${pays.cv}/void`, { reason: "x" })).status).toBe(403);
    expect((await api("acct", "POST", `/supplier-payments/${pays.cv}/void`, { reason: "" })).status).toBe(400);
    expect((await api("acct", "POST", `/supplier-payments/${pays.cv}/void`, { reason: "Wrong supplier" })).status).toBe(200);
    expect((await bill(bills.C)).balance).toBe(150);
    expect((await api("acct", "GET", "/cash/day?date=2026-11-22")).body.supplierPaymentsTotal).toBe(0);
    expect((await api("admin", "POST", `/supplier-payments/${pays.p1}/void`, { reason: "Bounced" })).status).toBe(200);
    expect((await bill(bills.A)).balance).toBe(600);
    expect((await api("acct", "POST", `/supplier-payments/${pays.p1}/void`, { reason: "again" })).status).toBe(400);
    const [p] = await ctx.db.select().from(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, pays.p1));
    expect(p.status).toBe("void"); // never deleted
  });

  it("a purchase bill with payments allocated cannot be voided", async () => {
    const r = await api("acct", "POST", `/purchase-bills/${bills.B}/void`, { reason: "x" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Void those payments first/);
  });

  it("the voucher can be fetched for printing, and the bank ledger shows the PV going out", async () => {
    const v = (await api("acct", "GET", `/supplier-payments/${pays.p2}`)).body;
    expect(v).toMatchObject({ voucherNo: "PV-2083/84-00002", supplierName: "Dairy Co", supplierPan: "123456789", paidVia: "cheque", reference: "CHQ 77", paidFromAccount: "nabil" });
    expect(v.allocations.map((a: any) => a.billNumber)).toEqual(["INV-A", "INV-B", "INV-C"]);
    const bank = (await api("acct", "GET", `/ledger/mode?mode=bank&from=${TODAY}&to=${TODAY}`)).body;
    expect(bank.entries.some((e: any) => e.ref === "PV-2083/84-00002" && e.outAmt === 1000)).toBe(true);
  });
});

describe("opening balances", () => {
  it("needs the opening-balance date (admin or accountant)", async () => {
    expect((await api("acct", "POST", "/opening-bills", { supplierId: dairy, billNumber: "OLD-1", billDate: "2026-09-15", dueDate: "2026-10-15", amount: 2000 })).body.error).toMatch(/opening-balance date first/);
    expect((await api("super", "PATCH", "/payables/settings", { openingDate: "2026-11-01" })).status).toBe(403);
    expect((await api("acct", "PATCH", "/payables/settings", { openingDate: "2026-11-25" })).status).toBe(400); // future
    expect((await api("acct", "PATCH", "/payables/settings", { openingDate: "2026-11-01" })).status).toBe(200);
  });

  it("an opening bill is a payable only: no stock, no expense, no drawer; it shows in the ledger as opening", async () => {
    const stock = (await ctx.db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, rice)))[0].currentStock;
    const exps = await countExpenses();
    const r = await api("acct", "POST", "/opening-bills", { supplierId: dairy, billNumber: "OLD-1", billDate: "2026-09-15", dueDate: "2026-10-15", amount: 2000 });
    expect(r.status).toBe(201);
    bills.O = r.body.id;
    expect(r.body).toMatchObject({ kind: "opening", pjNumber: "OB-2083/84-00001", total: 2000, balance: 2000, dueDate: "2026-10-15", overdue: true, daysOverdue: 40, items: [] });
    expect((await ctx.db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, rice)))[0].currentStock).toBe(stock);
    expect(await countExpenses()).toBe(exps);
    const l = (await api("acct", "GET", `/suppliers/${dairy}/ledger`)).body;
    expect(l.entries[0]).toMatchObject({ type: "opening", ref: "OLD-1", billed: 2000 });
    expect((await api("acct", "POST", "/opening-bills", { supplierId: dairy, billNumber: "LATE-1", billDate: "2026-11-05", dueDate: "2026-11-20", amount: 10 })).status).toBe(400);
  });

  it("the duplicate rule (supplier PAN + bill number) covers opening and purchase bills both ways", async () => {
    expect((await api("acct", "POST", "/opening-bills", { supplierId: dairy, billNumber: "inv-a", billDate: "2026-10-01", dueDate: "2026-10-30", amount: 10 })).status).toBe(409);
    const r = await api("acct", "POST", "/purchase-bills", { supplierId: dairy, pan: "123456789", billNumber: " OLD-1 ", billDate: TODAY, terms: "credit", creditDays: 15, lines: [{ inventoryItemId: rice, quantity: 1, amount: 10 }] });
    expect(r.status).toBe(409);
  });

  it("opening bills are paid and voided like bills", async () => {
    const r = await pay({ amount: 500, paidVia: "online", reference: "TXN 5", paidFromAccount: "nabil", allocations: [{ billId: bills.O, amount: 500 }] });
    expect(r.status).toBe(201);
    expect((await bill(bills.O)).balance).toBe(1500);
    expect((await api("acct", "POST", `/purchase-bills/${bills.O}/void`, { reason: "x" })).status).toBe(400); // payment allocated
  });
});

describe("aging", () => {
  it("buckets each supplier's bills by days overdue on the Nepal day, with bills due this week", async () => {
    // Veg: V-1 (due 12-05, 300, from the allocation test) plus bills due today, 1 day ago, 30 days ago, and an opening bill 61 days ago
    await creditBill(veg, "222333444", "V-TODAY", "2026-11-09", 15, 100); // due 11-24: not yet due
    await creditBill(veg, "222333444", "V-1D", "2026-11-08", 15, 200);    // due 11-23: 1 day
    await creditBill(veg, "222333444", "V-30D", "2026-10-10", 15, 400);   // due 10-25: 30 days
    await api("acct", "POST", "/opening-bills", { supplierId: veg, billNumber: "V-OLD", billDate: "2026-08-01", dueDate: "2026-09-24", amount: 800 }); // 61 days
    const r = await api("acct", "GET", "/payables/aging");
    expect(r.status).toBe(200);
    expect(r.body.today).toBe(TODAY);
    const v = r.body.suppliers.find((s: any) => s.supplierId === veg);
    expect(v).toMatchObject({ notDue: 400, d1_15: 200, d16_30: 400, d31_60: 0, d60plus: 800, total: 1800, advance: 0, net: 1800 });
    const d = r.body.suppliers.find((s: any) => s.supplierId === dairy);
    expect(d).toMatchObject({ d1_15: 600, d31_60: 1500, advance: 0 }); // A due 11-16 (8 days), opening due 10-15 (40 days)
    expect(r.body.dueThisWeek.map((b: any) => b.billNumber)).toEqual(["V-TODAY"]);
    expect(r.body.overdue[0]).toMatchObject({ billNumber: "V-OLD", daysOverdue: 61 });
  });
});

describe("roles", () => {
  it("other roles see no amounts: no payments, aging, ledgers, opening bills or settings", async () => {
    for (const who of ["super", "chef", "staff"]) {
      expect((await api(who, "GET", "/supplier-payments")).status).toBe(403);
      expect((await api(who, "GET", "/payables/aging")).status).toBe(403);
      expect((await api(who, "GET", `/suppliers/${dairy}/ledger`)).status).toBe(403);
      expect((await api(who, "POST", "/opening-bills", { supplierId: dairy })).status).toBe(403);
      expect((await api(who, "POST", "/supplier-payments", { supplierId: dairy })).status).toBe(403);
      expect((await api(who, "GET", "/payables/settings")).status).toBe(403);
    }
    const list = (await api("super", "GET", "/suppliers")).body;
    expect(list[0]).not.toHaveProperty("advance");
    expect(list[0]).not.toHaveProperty("balance");
    expect((await api("staff", "GET", "/suppliers")).status).toBe(403);
  });
});
