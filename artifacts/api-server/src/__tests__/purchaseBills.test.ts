// Suppliers and purchase bills (step 2, part A): the real Express routes on an in-memory PostgreSQL (PGlite).
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
import {
  usersTable, inventoryItemsTable, inventoryLogsTable, ingredientComponentsTable, expensesTable, ingredientPriceHistoryTable,
  ingredientSuppliersTable, purchaseBillsTable, cashDaysTable,
} from "@workspace/db";
import { freshDb } from "./pgliteDb";

const TODAY = "2026-11-24"; // Nepal day; fiscal year 2083/84
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let milk: number, rice: number, sauce: number, dairy: number, service: number;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const item = async (id: number) => (await ctx.db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id)))[0];
const bill = (o: any = {}) => ({
  supplierId: dairy, pan: "123456789", billNumber: "INV-77", billDate: "2026-11-20", terms: "credit", creditDays: 15,
  lines: [{ inventoryItemId: milk, quantity: 5, amount: 600 }, { inventoryItemId: rice, quantity: 10, amount: 1000 }], billVat: 208, ...o,
});

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T06:00:00Z`));
  process.env.UPLOAD_DIR = join(tmpdir(), "cafe-nexus-test-uploads");
  ctx = await freshDb();
  holder.db = ctx.db;
  const db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["super", "supervisor"], ["chef", "head_chef"]]) {
    const [u] = await db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  [{ id: milk }] = await db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "10", costPerUnit: "100", lastPurchaseDate: "2026-11-01", lastPurchasePrice: "1000", lastPurchaseQty: "10", lastSupplier: "Old dairy" }).returning();
  [{ id: rice }] = await db.insert(inventoryItemsTable).values({ name: "Rice", unit: "kg", department: "kitchen", currentStock: "0" }).returning();
  [{ id: sauce }] = await db.insert(inventoryItemsTable).values({ name: "House sauce", unit: "L", department: "kitchen" }).returning();
  await db.insert(ingredientComponentsTable).values({ parentItemId: sauce, childItemId: rice, quantity: "1" });

  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("suppliers", () => {
  it("creates suppliers; PAN is mandatory (9 digits) and unique", async () => {
    let r = await api("acct", "POST", "/suppliers", { name: "Dairy Co", pan: "123 456 789", creditDays: 15, phone: "01-5555555", contactPerson: "Hari" });
    expect(r.status).toBe(201); dairy = r.body.id;
    expect(r.body.pan).toBe("123456789");
    expect((await api("acct", "POST", "/suppliers", { name: "Other", pan: "123456789" })).status).toBe(409);
    expect((await api("acct", "POST", "/suppliers", { name: "No PAN" })).status).toBe(400);
    r = await api("admin", "POST", "/suppliers", { name: "Cleaner Ltd", pan: "987654321", supplierType: "service" });
    service = r.body.id;
  });

  it("other roles see suppliers without any amounts, and cannot edit", async () => {
    const r = await api("super", "GET", "/suppliers");
    expect(r.status).toBe(200);
    expect(r.body[0]).not.toHaveProperty("billed");
    expect(r.body[0]).not.toHaveProperty("balance");
    expect((await api("chef", "POST", "/suppliers", { name: "X", pan: "111111111" })).status).toBe(403);
    expect((await api("super", "GET", "/purchase-bills")).status).toBe(403);
    expect((await api("chef", "GET", `/price-history?inventoryItemId=${milk}`)).status).toBe(403);
  });

  it("lists ingredients with no supplier (composite ones excluded)", async () => {
    const r = await api("chef", "GET", "/ingredient-suppliers/unmapped");
    expect(r.body.map((x: any) => x.name).sort()).toEqual(["Milk", "Rice"]);
  });
});

describe("purchase bills", () => {
  let creditBillId = 0;

  it("refuses a bill without a PAN or a bill number", async () => {
    expect((await api("acct", "POST", "/purchase-bills", bill({ pan: "" }))).body.error).toMatch(/PAN/);
    expect((await api("acct", "POST", "/purchase-bills", bill({ billNumber: "" }))).body.error).toMatch(/bill number/);
  });

  it("saves a credit bill: stock up in the right inventory, costing, expenses, price history, payable", async () => {
    const r = await api("acct", "POST", "/purchase-bills", bill());
    expect(r.status).toBe(201);
    creditBillId = r.body.id;
    expect(r.body).toMatchObject({ pjNumber: "PJ-2083/84-00001", total: 1808, vatAmount: 208, paid: 0, balance: 1808, dueDate: "2026-12-05", overdue: false });

    const m = await item(milk), rc = await item(rice);
    expect([m.department, m.currentStock, m.costPerUnit]).toEqual(["drink", "15.00", "111.8667"]); // (10 x 100 + 678) / 15
    expect([m.lastPurchasePrice, m.lastPurchaseQty, m.lastPurchaseDate, m.lastSupplier]).toEqual(["678.00", "5.0000", "2026-11-20", "Dairy Co"]);
    expect([rc.department, rc.currentStock, rc.costPerUnit]).toEqual(["kitchen", "10.00", "113.0000"]); // 1130 / 10

    const logs = await ctx.db.select().from(inventoryLogsTable);
    expect(logs.map((l: any) => [l.inventoryItemId, l.changeAmount])).toEqual(expect.arrayContaining([[milk, "5.00"], [rice, "10.00"]]));
    const exps = await ctx.db.select().from(expensesTable).where(eq(expensesTable.purchaseBillId, creditBillId));
    expect(exps.map((e: any) => [e.type, e.category, e.amount, e.paymentMethod, e.paidFromDrawer, e.billNumber]).sort()).toEqual([
      ["direct", "Beverages and drink ingredients", "678.00", "credit", false, "INV-77"],
      ["direct", "Food ingredients (meat, vegetables, fruits)", "1130.00", "credit", false, "INV-77"],
    ]);
    const hist = await api("acct", "GET", `/price-history?inventoryItemId=${milk}`);
    expect(hist.body.map((h: any) => [h.supplierName, h.rate, h.landedUnitCost])).toEqual([["Dairy Co", 120, 135.6]]);
    // the supplier is now linked to both ingredients, as preferred
    const links = await ctx.db.select().from(ingredientSuppliersTable);
    expect(links.map((l: any) => [l.inventoryItemId, l.isPreferred]).sort()).toEqual([[milk, true], [rice, true]].sort());

    const ledger = await api("acct", "GET", `/suppliers/${dairy}/ledger`);
    expect(ledger.body.totals).toMatchObject({ bills: 1, billed: 1808, paid: 0, balance: 1808, overdue: 0 });
    expect(ledger.body.unpaid[0].items.map((i: any) => i.itemName)).toEqual(["Milk", "Rice"]);
  });

  it("counts the purchase once as a direct purchase in the P&L memo", async () => {
    const r = await api("admin", "GET", "/costing/pnl?month=2026-11");
    expect(r.status).toBe(200);
    expect(r.body.directPurchases).toBe(1808);
  });

  it("refuses a duplicate: same bill number from the same PAN (any case or spacing)", async () => {
    const r = await api("acct", "POST", "/purchase-bills", bill({ billNumber: "  inv-77 ", lines: [{ inventoryItemId: milk, quantity: 1, amount: 100 }], billVat: undefined }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already entered/);
    expect((await api("acct", "GET", "/purchase-bills/check?pan=123456789&billNumber=INV-77")).body.duplicate.pjNumber).toBe("PJ-2083/84-00001");
    expect((await item(milk)).currentStock).toBe("15.00"); // nothing posted
  });

  it("refuses composite ingredients, service providers, future and earlier-fiscal-year dates", async () => {
    expect((await api("acct", "POST", "/purchase-bills", bill({ billNumber: "C1", lines: [{ inventoryItemId: sauce, quantity: 1, amount: 50 }], billVat: undefined }))).status).toBe(400);
    expect((await api("acct", "POST", "/purchase-bills", bill({ supplierId: service, pan: "987654321", billNumber: "S1" }))).status).toBe(400);
    expect((await api("acct", "POST", "/purchase-bills", bill({ billNumber: "F1", billDate: "2026-11-25" }))).status).toBe(400);
    expect((await api("acct", "POST", "/purchase-bills", bill({ billNumber: "Y1", billDate: "2026-06-01" }))).body.error).toMatch(/2082\/83/);
  });

  it("a cash bill paid from the drawer is paid at purchase and shows as a drawer payout", async () => {
    await ctx.db.insert(cashDaysTable).values({ day: "2026-11-22", openingBalance: "0", status: "open" });
    const r = await api("acct", "POST", "/purchase-bills", bill({ billNumber: "CASH-1", billDate: "2026-11-22", terms: "cash", paidVia: "drawer", billVat: undefined, lines: [{ inventoryItemId: rice, quantity: 2, amount: 200 }] }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ terms: "cash", paidVia: "drawer", paid: 200, balance: 0, dueDate: "2026-11-22" });
    const day = await api("acct", "GET", "/cash/day?date=2026-11-22");
    expect(day.body.payoutsTotal).toBe(200);
    expect(day.body.payouts[0].billNumber).toBe("CASH-1");
    expect((await api("acct", "POST", "/purchase-bills", bill({ billNumber: "CHQ-1", terms: "cash", paidVia: "cheque" }))).status).toBe(400); // cheque number needed
  });

  it("an older (backdated) bill does not overwrite the last purchase and uses the average", async () => {
    const before = await item(milk);
    await api("acct", "POST", "/purchase-bills", bill({ billNumber: "OLD-1", billDate: "2026-11-10", costMethod: "last", billVat: undefined, lines: [{ inventoryItemId: milk, quantity: 5, amount: 500 }] }));
    const m = await item(milk);
    expect([m.lastPurchaseDate, m.lastPurchasePrice]).toEqual([before.lastPurchaseDate, before.lastPurchasePrice]);
    expect(m.costPerUnit).toBe("108.9000"); // (15 x 111.8667 + 500) / 20, not 100
  });

  it("expenses booked by a bill cannot be edited or voided on the Expenses page", async () => {
    const [e] = await ctx.db.select().from(expensesTable).where(eq(expensesTable.purchaseBillId, creditBillId));
    expect((await api("acct", "PATCH", `/expenses/${e.id}`, { vendor: "x" })).body.error).toMatch(/purchase bill/);
    expect((await api("acct", "POST", `/expenses/${e.id}/void`, { reason: "x" })).body.error).toMatch(/purchase bill/);
  });

  it("the old one-ingredient Record purchase is closed", async () => {
    expect((await api("acct", "POST", `/inventory/${milk}/purchase`, { quantity: 1, totalPrice: 10 })).status).toBe(410);
  });

  it("void reverses stock, expenses, price history and the payable; cost goes back only where untouched", async () => {
    // a later bill changes rice's cost, so the first bill's rice cost cannot be restored; milk's was changed too (OLD-1)
    const r = await api("acct", "POST", `/purchase-bills/${creditBillId}/void`, { reason: "Entered against the wrong supplier" });
    expect(r.status).toBe(200);
    expect(r.body.costLeft.sort()).toEqual(["Milk", "Rice"]);
    expect((await item(milk)).currentStock).toBe("15.00");  // 20 - 5
    expect((await item(rice)).currentStock).toBe("2.00");   // 12 - 10
    const exps = await ctx.db.select().from(expensesTable).where(eq(expensesTable.purchaseBillId, creditBillId));
    expect(exps.every((e: any) => e.status === "void")).toBe(true);
    const hist = await ctx.db.select().from(ingredientPriceHistoryTable).where(eq(ingredientPriceHistoryTable.billId, creditBillId));
    expect(hist.every((h: any) => h.status === "void")).toBe(true);
    const ledger = await api("acct", "GET", `/suppliers/${dairy}/ledger`);
    expect(ledger.body.totals.balance).toBe(500); // only the OLD-1 credit bill (Rs. 500) is still owed
    expect((await api("acct", "POST", `/purchase-bills/${creditBillId}/void`, { reason: "again" })).status).toBe(400);
    // the voided bill's number can be entered again, correctly
    expect((await api("acct", "POST", "/purchase-bills", bill({ billVat: undefined, lines: [{ inventoryItemId: rice, quantity: 1, amount: 100 }] }))).status).toBe(201);
  });

  it("void restores cost per unit and the last purchase when nothing changed them since", async () => {
    const [{ id: sugar }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Sugar", unit: "kg", department: "kitchen", currentStock: "4", costPerUnit: "90", lastPurchaseDate: "2026-11-01", lastPurchasePrice: "360", lastPurchaseQty: "4", lastSupplier: "Old shop" }).returning();
    const b = await api("acct", "POST", "/purchase-bills", bill({ billNumber: "SUG-1", billVat: undefined, lines: [{ inventoryItemId: sugar, quantity: 6, amount: 660 }] }));
    expect((await item(sugar)).costPerUnit).toBe("102.0000");
    const v = await api("acct", "POST", `/purchase-bills/${b.body.id}/void`, { reason: "Wrong quantity" });
    expect(v.body.costRestored).toEqual(["Sugar"]);
    const s = await item(sugar);
    expect([s.currentStock, s.costPerUnit, s.lastPurchaseDate, s.lastPurchasePrice, s.lastSupplier]).toEqual(["4.00", "90.0000", "2026-11-01", "360.00", "Old shop"]);
  });

  it("a credit bill past its due date is overdue (Nepal day)", async () => {
    const r = await api("acct", "POST", "/purchase-bills", bill({ billNumber: "LATE-1", billDate: "2026-11-01", creditDays: 15, billVat: undefined, lines: [{ inventoryItemId: rice, quantity: 1, amount: 100 }] }));
    expect(r.body).toMatchObject({ dueDate: "2026-11-16", overdue: true, daysOverdue: 8 });
    const ledger = await api("acct", "GET", `/suppliers/${dairy}/ledger`);
    expect(ledger.body.totals.overdue).toBe(100);
  });

  it("bills are never deleted: voided bills stay listed", async () => {
    const all = await ctx.db.select().from(purchaseBillsTable);
    expect(all.filter((b: any) => b.status === "void").length).toBe(2);
    const list = await api("acct", "GET", "/purchase-bills?status=void");
    expect(list.body.bills).toHaveLength(2);
  });
});
