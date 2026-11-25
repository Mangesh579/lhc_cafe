// Purchase returns with item-wise debit notes (step 2, part C): the real Express routes on an in-memory PostgreSQL (PGlite).
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

import { eq, and } from "drizzle-orm";
import { usersTable, inventoryItemsTable, inventoryLogsTable, expensesTable, ingredientPriceHistoryTable, debitNotesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

const TODAY = "2026-11-24"; // Nepal day; fiscal year 2083/84
let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let milk: number, rice: number, dairy: number;
const ids: Record<string, number> = {};

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const item = async (id: number) => (await ctx.db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id)))[0];
const bill = async (id: number) => (await api("acct", "GET", `/purchase-bills/${id}`)).body;
const lineOf = async (billId: number, itemId: number) => (await bill(billId)).items.find((i: any) => i.inventoryItemId === itemId);
const dn = (body: any) => api("acct", "POST", "/debit-notes", { noteDate: TODAY, reason: "Returned to supplier", ...body });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T06:00:00Z`));
  process.env.UPLOAD_DIR = join(tmpdir(), "cafe-nexus-test-uploads");
  ctx = await freshDb();
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["super", "supervisor"], ["barista", "head_barista"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  [{ id: milk }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "10", costPerUnit: "100" }).returning();
  [{ id: rice }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Rice", unit: "kg", department: "kitchen", currentStock: "0" }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  dairy = (await api("acct", "POST", "/suppliers", { name: "Dairy Co", pan: "123456789", creditDays: 15 })).body.id;
  // Bill X (credit, due 12-05): 3 L milk 600 + 10 kg rice 1000, VAT 208 shared -> 678 + 1130 = 1808
  ids.X = (await api("acct", "POST", "/purchase-bills", { supplierId: dairy, pan: "123456789", billNumber: "INV-X", billDate: "2026-11-20", terms: "credit", creditDays: 15, billVat: 208,
    lines: [{ inventoryItemId: milk, quantity: 3, amount: 600 }, { inventoryItemId: rice, quantity: 10, amount: 1000 }] })).body.id;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("debit notes", () => {
  it("a partial return: stock down in the right inventory, payable down, negative expense, price history adjusted, cost per unit unchanged", async () => {
    const costBefore = (await item(rice)).costPerUnit;
    const riceLine = await lineOf(ids.X, rice);
    const r = await dn({ billId: ids.X, noteDate: "2026-11-22", reason: "Damp sacks", lines: [{ billItemId: riceLine.id, quantity: 4, reason: "damp" }] });
    expect(r.status).toBe(201);
    ids.DN1 = r.body.id;
    expect(r.body).toMatchObject({ noteNo: "DN-2083/84-00001", total: 452, vatAmount: 52, allocated: 452, unallocated: 0 });
    const rc = await item(rice);
    expect([rc.department, rc.currentStock, rc.costPerUnit]).toEqual(["kitchen", "6.00", costBefore]);
    const logs = await ctx.db.select().from(inventoryLogsTable).where(eq(inventoryLogsTable.inventoryItemId, rice));
    expect(logs.at(-1)).toMatchObject({ changeAmount: "-4.00" });
    expect(logs.at(-1).reason).toMatch(/Returned to Dairy Co: DN-2083\/84-00001/);
    const [neg] = await ctx.db.select().from(expensesTable).where(eq(expensesTable.debitNoteId, ids.DN1));
    expect(neg).toMatchObject({ amount: "-452.00", type: "direct", category: "Food ingredients (meat, vegetables, fruits)", paidFromDrawer: false, purchaseBillId: ids.X, status: "active" });
    const originals = await ctx.db.select().from(expensesTable).where(and(eq(expensesTable.purchaseBillId, ids.X), eq(expensesTable.amount, "1130.00")));
    expect(originals).toHaveLength(1); // original expense untouched
    expect((await bill(ids.X)).balance).toBe(1356);
    expect((await lineOf(ids.X, rice)).returnedQty).toBe(4);
    const [ph] = await ctx.db.select().from(ingredientPriceHistoryTable).where(eq(ingredientPriceHistoryTable.billItemId, riceLine.id));
    expect([ph.returnedQuantity, ph.status]).toEqual(["4.0000", "active"]);
    const hist = (await api("acct", "GET", `/price-history?inventoryItemId=${rice}`)).body;
    expect(hist[0]).toMatchObject({ quantity: 6, boughtQuantity: 10, returnedQuantity: 4 });
  });

  it("returns are limited to what was bought minus what was already returned; the last units take the exact remainder", async () => {
    const riceLine = await lineOf(ids.X, rice);
    expect((await dn({ billId: ids.X, lines: [{ billItemId: riceLine.id, quantity: 7 }] })).body.error).toMatch(/Only 6 kg/);
    const milkLine = await lineOf(ids.X, milk);
    expect((await dn({ billId: ids.X, lines: [{ billItemId: milkLine.id, quantity: 4 }] })).status).toBe(400);
    const r = await dn({ billId: ids.X, lines: [{ billItemId: riceLine.id, quantity: 6 }] });
    expect(r.status).toBe(201);
    ids.DN2 = r.body.id;
    expect(r.body.total).toBe(678); // 1130 - 452
    expect((await bill(ids.X)).balance).toBe(678);
    const [ph] = await ctx.db.select().from(ingredientPriceHistoryTable).where(eq(ingredientPriceHistoryTable.billItemId, riceLine.id));
    expect(ph.status).toBe("void"); // whole line returned
    expect((await dn({ billId: ids.X, lines: [{ billItemId: riceLine.id, quantity: 1 }] })).body.error).toMatch(/Only 0 kg/);
  });

  it("a return against a paid bill becomes an advance, which can be allocated to another bill", async () => {
    const y = await api("acct", "POST", "/purchase-bills", { supplierId: dairy, pan: "123456789", billNumber: "INV-Y", billDate: "2026-11-21", terms: "cash", paidVia: "online", paymentReference: "TXN 9", paidFromAccount: "nabil",
      lines: [{ inventoryItemId: milk, quantity: 2, amount: 300 }] });
    ids.Y = y.body.id;
    const costBefore = (await item(milk)).costPerUnit;
    const r = await dn({ billId: ids.Y, lines: [{ billItemId: (await lineOf(ids.Y, milk)).id, quantity: 1 }] });
    expect(r.status).toBe(201);
    ids.DN3 = r.body.id;
    expect(r.body).toMatchObject({ total: 150, allocated: 0, unallocated: 150 });
    expect((await item(milk)).costPerUnit).toBe(costBefore);
    let l = (await api("acct", "GET", `/suppliers/${dairy}/ledger`)).body;
    expect(l.totals).toMatchObject({ balance: 678, advance: 150, net: 528 });
    expect((await api("acct", "POST", `/debit-notes/${ids.DN3}/allocate`, { allocations: [{ billId: ids.X, amount: 151 }] })).status).toBe(400);
    expect((await api("acct", "POST", `/debit-notes/${ids.DN3}/allocate`, { allocations: [{ billId: ids.X, amount: 150 }] })).body.unallocated).toBe(0);
    expect((await bill(ids.X)).balance).toBe(528);
    l = (await api("acct", "GET", `/suppliers/${dairy}/ledger`)).body;
    expect(l.totals).toMatchObject({ balance: 528, advance: 0, net: 528, returned: 1280 });
    expect(l.entries.filter((e: any) => e.type === "debit_note").map((e: any) => e.paid)).toEqual([452, 678, 150]);
    expect(l.entries.at(-1).balance).toBe(528);
  });

  it("aging and the P&L memo reflect the returns", async () => {
    const a = (await api("acct", "GET", "/payables/aging")).body;
    expect(a.suppliers.find((s: any) => s.supplierId === dairy)).toMatchObject({ notDue: 528, total: 528, advance: 0, net: 528 });
    const pnl = (await api("admin", "GET", "/costing/pnl?month=2026-11")).body;
    expect(pnl.directPurchases).toBe(1808 + 300 - 452 - 678 - 150);
  });

  it("refuses a debit note against an opening bill, a future date, or a date before the bill", async () => {
    await api("acct", "PATCH", "/payables/settings", { openingDate: "2026-11-01" });
    const ob = (await api("acct", "POST", "/opening-bills", { supplierId: dairy, billNumber: "OLD-1", billDate: "2026-10-01", dueDate: "2026-10-31", amount: 500 })).body;
    const r = await dn({ billId: ob.id, lines: [{ billItemId: 1, quantity: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/opening bill has no item lines/);
    const milkLine = await lineOf(ids.X, milk);
    expect((await dn({ billId: ids.X, noteDate: "2026-11-25", lines: [{ billItemId: milkLine.id, quantity: 1 }] })).status).toBe(400);
    expect((await dn({ billId: ids.X, noteDate: "2026-11-19", lines: [{ billItemId: milkLine.id, quantity: 1 }] })).body.error).toMatch(/before the bill date/);
  });

  it("a bill with an active debit note cannot be voided", async () => {
    const r = await api("acct", "POST", `/purchase-bills/${ids.X}/void`, { reason: "x" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Void the debit note first/);
  });

  it("void (admin or accountant) puts back the stock, the payable, the price history and the cost", async () => {
    expect((await api("super", "POST", `/debit-notes/${ids.DN1}/void`, { reason: "x" })).status).toBe(403);
    expect((await api("acct", "POST", `/debit-notes/${ids.DN1}/void`, { reason: "" })).status).toBe(400);
    expect((await api("acct", "POST", `/debit-notes/${ids.DN1}/void`, { reason: "Supplier refused the return" })).status).toBe(200);
    expect((await item(rice)).currentStock).toBe("4.00"); // 10 - 4 - 6 + 4
    const [neg] = await ctx.db.select().from(expensesTable).where(eq(expensesTable.debitNoteId, ids.DN1));
    expect(neg.status).toBe("void");
    const riceLine = await lineOf(ids.X, rice);
    const [ph] = await ctx.db.select().from(ingredientPriceHistoryTable).where(eq(ingredientPriceHistoryTable.billItemId, riceLine.id));
    expect([ph.returnedQuantity, ph.status]).toEqual(["6.0000", "active"]);
    expect((await bill(ids.X)).balance).toBe(980); // 528 + 452
    expect((await api("admin", "GET", "/costing/pnl?month=2026-11")).body.directPurchases).toBe(1808 + 300 - 678 - 150);
    expect((await api("acct", "POST", `/debit-notes/${ids.DN1}/void`, { reason: "again" })).status).toBe(400);
    const [row] = await ctx.db.select().from(debitNotesTable).where(eq(debitNotesTable.id, ids.DN1));
    expect(row.status).toBe("void"); // never deleted
  });

  it("the debit note can be fetched for printing, and expenses from a return are read-only", async () => {
    const n = (await api("acct", "GET", `/debit-notes/${ids.DN2}`)).body;
    expect(n).toMatchObject({ noteNo: "DN-2083/84-00002", supplierName: "Dairy Co", supplierPan: "123456789", billNumber: "INV-X" });
    expect(n.items[0]).toMatchObject({ itemName: "Rice", quantity: 6, lineTotal: 678 });
    const [neg] = await ctx.db.select().from(expensesTable).where(eq(expensesTable.debitNoteId, ids.DN2));
    expect((await api("acct", "POST", `/expenses/${neg.id}/void`, { reason: "x" })).body.error).toMatch(/purchase bill/);
    expect((await api("acct", "GET", "/debit-notes")).body.map((d: any) => d.noteNo)).toEqual(["DN-2083/84-00003", "DN-2083/84-00002", "DN-2083/84-00001"]);
  });

  it("other roles cannot see or make debit notes", async () => {
    for (const who of ["super", "barista"]) {
      expect((await api(who, "GET", "/debit-notes")).status).toBe(403);
      expect((await api(who, "GET", `/debit-notes/${ids.DN2}`)).status).toBe(403);
      expect((await api(who, "POST", "/debit-notes", { billId: ids.X })).status).toBe(403);
      expect((await api(who, "GET", `/purchase-bills/${ids.X}/returnable`)).status).toBe(403);
    }
  });
});
