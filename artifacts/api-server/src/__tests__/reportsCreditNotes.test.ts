// Reports are credit-note aware (2026-11-27), and "not served" puts back what the sale took out; real routes on PGlite.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});

import { eq } from "drizzle-orm";
import { usersTable, ordersTable, orderItemsTable, orderPaymentsTable, menuItemsTable, recipesTable, inventoryItemsTable, inventoryLogsTable, loyaltyCustomersTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", token = "";
let ram = 0, hari = 0, latte = 0, milk = 0;
const ids: Record<string, number> = {};

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const stock = async () => parseFloat((await ctx.db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, milk)))[0].currentStock);
// A paid bill on 25 Nov (Nepal), qty lattes at 250 (cost 40 each), all in one mode; logs = the sale's Stock Log lines (milk taken out)
async function bill(qty: number, mode: string, customerId: number | null, milkPerLatte: number | null, logMenuItem = true) {
  const at = new Date("2026-11-25T06:00:00Z"), total = qty * 250;
  const [o] = await ctx.db.insert(ordersTable).values({ totalAmount: String(total), paymentMethod: mode, paymentStatus: "paid", orderStatus: "completed", loyaltyCustomerId: customerId, invoiceNumber: `2083/84-9${Object.keys(ids).length}`, paidAt: at, createdAt: at, createdBy: "staff" } as any).returning();
  await ctx.db.insert(orderItemsTable).values({ orderId: o.id, menuItemId: latte, quantity: qty, unitPrice: "250", subtotal: String(total), kotNumber: 1, unitCost: "40.0000", costComplete: true });
  await ctx.db.insert(orderPaymentsTable).values({ orderId: o.id, mode, amount: String(total), paidAt: at } as any);
  if (milkPerLatte != null) {
    const before = await stock(), take = milkPerLatte * qty;
    await ctx.db.update(inventoryItemsTable).set({ currentStock: String(before - take) }).where(eq(inventoryItemsTable.id, milk));
    await ctx.db.insert(inventoryLogsTable).values({ inventoryItemId: milk, changeAmount: String(-take), stockBefore: String(before), stockAfter: String(before - take), reason: `Order #${o.id}`, orderId: o.id, menuItemId: logMenuItem ? latte : null });
  }
  return o.id as number;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T06:00:00Z"));
  ctx = await freshDb();
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [u] = await ctx.db.insert(usersTable).values({ username: "admin", passwordHash: "x", role: "admin" }).returning();
  token = signToken({ id: u.id, username: "admin", role: "admin", tokenVersion: u.tokenVersion ?? 0 });
  [{ id: ram }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Ram", phone: "9800000001", email: "ram@example.com" }).returning();
  [{ id: hari }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Hari", phone: "9800000002", email: "hari@example.com" }).returning();
  [{ id: milk }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "20" }).returning();
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "250" }).returning();
  // Today's recipe is 0.25 L; the sales below took 0.3 L per latte (the recipe was changed after the sale)
  await ctx.db.insert(recipesTable).values({ menuItemId: latte, inventoryItemId: milk, quantityRequired: "0.25", wasteQuantity: "0" });
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  ids.a = await bill(4, "credit", ram, 0.3);   // Rs 1,000 on credit: cancelled "not served" on 27 Nov
  ids.b = await bill(2, "credit", ram, 0.3);   // Rs 500 on credit: moved to Hari (Wrong customer) on 27 Nov
  ids.c = await bill(1, "cash", null, 0.3);    // Rs 250 cash
  ids.d = await bill(1, "card_sulimha_hbl", null, null); // Rs 250 on Sulimha's HBL machine
  expect(await stock()).toBeCloseTo(20 - 0.3 * 7, 4);
  const cancel = await api("POST", `/receivables/invoices/${ids.a}/cancel`, { reason: "Not served", restoreStock: true });
  expect(cancel.status).toBe(201);
  ids.noteA = cancel.body.id;
  expect(cancel.body.stock).toEqual({ fromSale: [latte], fromRecipe: [] });
  const move = await api("POST", `/receivables/invoices/${ids.b}/move`, { customerId: hari, reason: "Hari's tab" });
  expect(move.status).toBe(201);
  ids.b2 = move.body.newInvoice.orderId;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("credit-note aware reports", () => {
  it("Collections: credit notes on their day in their own column, the moved sale once, Sulimha's machine apart", async () => {
    const r = (await api("GET", "/ledger/collections?from=2026-11-25&to=2026-11-27")).body;
    const day = (d: string) => r.rows.find((x: any) => x.day === d);
    expect(day("2026-11-25")).toMatchObject({ orders: 4, sales: 2000, credit: 1500, cash: 250, sulimhaPos: 250, card: 0, received: 250 });
    expect(day("2026-11-27")).toMatchObject({ creditNotes: 1000, netSales: -1000 });
    expect(r.totals).toMatchObject({ sales: 2000, creditNotes: 1000, netSales: 1000, received: 250 });
  });

  it("P&L: net sales after credit notes, the stock put back comes off the cost, the moved sale counted once", async () => {
    const p = (await api("GET", "/costing/pnl?month=2026-11")).body;
    expect(p).toMatchObject({ salesBeforeCreditNotes: 2000, creditNotes: 1000, creditNotesCount: 1, sales: 1000, creditNoteCostBack: 160 });
    expect(p.cogs).toBe(320 - 160); // 8 lattes sold (moved one once) x 40, less the 4 put back
  });

  it("profit for the days: revenue less credit notes, cost less the stock put back", async () => {
    const r = (await api("GET", `/profit/daily?from=${encodeURIComponent("2026-11-24T18:15:00Z")}&to=${encodeURIComponent("2026-11-27T18:14:59Z")}`)).body;
    expect(r).toMatchObject({ orders: 4, revenueAll: 1000, revenue: 1000, cost: 160, profit: 840 });
    expect(r.creditNotes).toMatchObject({ count: 1, subtotal: 1000, restoredCost: 160 });
  });

  it("dashboard: today's credit notes reduce today's sales; the re-issued invoice is not a sale", async () => {
    const s = (await api("GET", "/dashboard/stats")).body;
    expect(s.todayCreditNotes).toBe(1000);
    const top = (await api("GET", "/dashboard/top-items")).body;
    expect(top).toEqual([expect.objectContaining({ name: "Latte", totalSold: 4, totalRevenue: 1000 })]); // 8 sold once, 4 credited
  });

  it("Order Log: each order carries its credit notes and the move both ways", async () => {
    expect((await api("GET", `/orders/${ids.a}`)).body).toMatchObject({ salesCreditNotes: 1000, salesCreditNotesNet: 1000, movedTo: null, reissueOf: null });
    const b = (await api("GET", `/orders/${ids.b}`)).body;
    expect(b).toMatchObject({ salesCreditNotes: 0, reissueOf: null });
    expect(b.movedTo).toMatch(/^2083\/84-/);
    expect((await api("GET", `/orders/${ids.b2}`)).body).toMatchObject({ salesCreditNotes: 0, movedTo: null, reissueOf: "2083/84-91" });
  });
});

describe("not served: the sale's own stock movements are reversed", () => {
  it("the cancel put back 0.3 L per latte (what the sale took), not today's 0.25 L; voiding takes exactly that out again", async () => {
    const after = 20 - 0.3 * 7 + 1.2;
    expect(await stock()).toBeCloseTo(after, 4);
    expect((await api("POST", `/credit-notes/${ids.noteA}/void`, { reason: "Was served" })).status).toBe(200);
    expect(await stock()).toBeCloseTo(after - 1.2, 4);
  });

  it("a part credit puts back its share; an older order with no menu item on its Stock Log falls back to today's recipe", async () => {
    const part = await bill(2, "credit", ram, 0.3);
    const [line] = await ctx.db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, part));
    expect((await api("POST", "/credit-notes", { orderId: part, reason: "one was cold", lines: [{ orderItemId: line.id, quantity: 1 }] })).status).toBe(201);
    let before = await stock();
    const c = await api("POST", `/receivables/invoices/${part}/cancel`, { reason: "rest not served", restoreStock: true });
    expect(c.body.stock).toEqual({ fromSale: [latte], fromRecipe: [] });
    expect(await stock()).toBeCloseTo(before + 0.3, 4); // 1 of the 2 lattes

    const old = await bill(2, "credit", ram, 0.3, false);
    before = await stock();
    const o = await api("POST", `/receivables/invoices/${old}/cancel`, { reason: "not served", restoreStock: true });
    expect(o.body.stock).toEqual({ fromSale: [], fromRecipe: [latte] });
    expect(await stock()).toBeCloseTo(before + 0.5, 4); // 2 x today's 0.25
  });
});
