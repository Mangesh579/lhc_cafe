// Fixing mistakes on room-charged bills (2026-11-27): cancel, receipts named when they block, move to another room.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});

import { eq } from "drizzle-orm";
import { usersTable, ordersTable, orderItemsTable, menuItemsTable, cafeTablesTable, loyaltyCustomersTable, inventoryItemsTable, recipesTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let room103 = 0, room104 = 0, eggs = 0, club = 0, sulimha = 0, bread = 0, stay103 = 0, stay104 = 0;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
async function roomBill(tableId: number, items: [number, number, number][], roomCharge: any) {
  const total = items.reduce((t, [, q, p]) => t + q * p, 0);
  const [o] = await ctx.db.insert(ordersTable).values({ tableId, totalAmount: String(total), paymentMethod: "cash", paymentStatus: "pending", orderStatus: "served", createdBy: "staff" } as any).returning();
  for (const [m, q, p] of items) await ctx.db.insert(orderItemsTable).values({ orderId: o.id, menuItemId: m, quantity: q, unitPrice: String(p), subtotal: String(q * p), kotNumber: 1 });
  const r = await api("staff", "PATCH", `/orders/${o.id}/payment`, { paymentStatus: "paid", roomCharge });
  expect(r.status).toBe(200);
  return o.id as number;
}
const stock = async () => parseFloat((await ctx.db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, bread)))[0].currentStock);
const folio = async (stayId: number) => (await api("acct", "GET", `/stays/${stayId}`)).body;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T04:00:00Z"));
  ctx = await freshDb();
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["staff", "staff"], ["rec", "reception"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  [{ id: room103 }] = await ctx.db.insert(cafeTablesTable).values({ tableNumber: 10, name: "103", token: "t10", isRoom: true }).returning();
  [{ id: room104 }] = await ctx.db.insert(cafeTablesTable).values({ tableNumber: 11, name: "104", token: "t11", isRoom: true }).returning();
  [{ id: bread }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Bread", unit: "pc", department: "kitchen", currentStock: "50" }).returning();
  [{ id: eggs }] = await ctx.db.insert(menuItemsTable).values({ name: "Eggs on toast", price: "450", isBreakfast: true }).returning();
  [{ id: club }] = await ctx.db.insert(menuItemsTable).values({ name: "Club sandwich", price: "500" }).returning();
  await ctx.db.insert(recipesTable).values({ menuItemId: club, inventoryItemId: bread, quantityRequired: "3" });
  [{ id: sulimha }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Sulimha Durbar", phone: "015500000", email: "accounts@sulimha.example" }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  await api("admin", "PATCH", "/stays-settings", { sulimhaCustomerId: sulimha });
  stay103 = (await api("rec", "POST", "/stays", { tableId: room103, guestName: "Ram Thapa", phone: "9800000009", adults: 2, breakfastIncluded: true, checkIn: "2026-11-26", checkOut: "2026-11-28" })).body.id;
  stay104 = (await api("rec", "POST", "/stays", { tableId: room104, guestName: "Sita Rai", phone: "9822222222", adults: 1, breakfastIncluded: true, checkIn: "2026-11-26", checkOut: "2026-11-28" })).body.id;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("cancel a room-charged invoice", () => {
  it("a room extra: served, the stock is kept; not served (the tick), the stock goes back; the credit note is dated today", async () => {
    const served = await roomBill(room103, [[club, 1, 500]], { stayId: stay103, kind: "extra" });
    expect((await api("staff", "POST", `/receivables/invoices/${served}/cancel`, { reason: "x" })).status).toBe(403);
    const before = await stock();
    const a = await api("acct", "POST", `/receivables/invoices/${served}/cancel`, { reason: "Charged to the wrong guest's tab by mistake" });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ kind: "cancel", total: 500, noteDate: "2026-11-27", stockRestored: false });
    expect(await stock()).toBe(before);
    const notServed = await roomBill(room103, [[club, 1, 500]], { stayId: stay103, kind: "extra" });
    const b = await api("admin", "POST", `/receivables/invoices/${notServed}/cancel`, { reason: "Kitchen never made it", restoreStock: true });
    expect(b.body).toMatchObject({ stockRestored: true, noteDate: "2026-11-27" });
    expect(await stock()).toBe(before + 3); // today's recipe: no sale Stock Log lines in this test
    expect((await folio(stay103)).extrasOwed).toBe(0);
  });

  it("an included breakfast billed to Sulimha can be cancelled the same way", async () => {
    const bf = await roomBill(room103, [[eggs, 2, 450]], { stayId: stay103, kind: "breakfast", breakfasts: 2 });
    const r = await api("acct", "POST", `/receivables/invoices/${bf}/cancel`, { reason: "Breakfast charged twice" });
    expect(r.body).toMatchObject({ kind: "cancel", total: 1600, customerId: sulimha, noteDate: "2026-11-27" });
  });

  it("refused when the guest already paid: the message names the receipt to void", async () => {
    const paid = await roomBill(room103, [[club, 1, 500]], { stayId: stay103, kind: "extra" });
    const customerId = (await folio(stay103)).customerId;
    const rv = await api("acct", "POST", "/receipts", { customerId, amount: 500, mode: "cash", allocations: [{ orderId: paid, amount: 500 }] });
    const r = await api("acct", "POST", `/receivables/invoices/${paid}/cancel`, { reason: "x" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(`The guest has already paid for this bill (Rs. 500.00). Void receipt ${rv.body.voucherNo} first.`);
  });
});

describe("move to another room", () => {
  it("re-issues the extra on the other stay's guest and folio; the old folio loses it; the credit note is dated today", async () => {
    const id = await roomBill(room103, [[club, 1, 500]], { stayId: stay103, kind: "extra" });
    expect((await api("staff", "POST", `/receivables/invoices/${id}/move`, { stayId: stay104, reason: "x" })).status).toBe(403);
    expect((await api("acct", "POST", `/receivables/invoices/${id}/move`, { stayId: stay103, reason: "x" })).body.error).toMatch(/already on that room/);
    const m = await api("acct", "POST", `/receivables/invoices/${id}/move`, { stayId: stay104, reason: "Sita ordered it, not Ram" });
    expect(m.status).toBe(201);
    expect(m.body.note).toMatchObject({ kind: "reissue", noteDate: "2026-11-27" });
    const [n] = await ctx.db.select().from(ordersTable).where(eq(ordersTable.id, m.body.newInvoice.orderId));
    expect([n.roomStayId, n.stayCharge]).toEqual([stay104, "extra"]);
    const f104 = await folio(stay104), f103 = await folio(stay103);
    expect(f104.bills.map((b: any) => b.orderId)).toContain(n.id);
    expect(f104.extrasOwed).toBe(500);
    expect(f103.bills.map((b: any) => b.orderId)).not.toContain(id);
  });

  it("an included breakfast moves to the other room and stays billed to Sulimha Durbar", async () => {
    const bf = await roomBill(room103, [[eggs, 1, 450]], { stayId: stay103, kind: "breakfast", breakfasts: 1 });
    const m = await api("admin", "POST", `/receivables/invoices/${bf}/move`, { stayId: stay104, reason: "Room 104's breakfast" });
    expect(m.status).toBe(201);
    const [n] = await ctx.db.select().from(ordersTable).where(eq(ordersTable.id, m.body.newInvoice.orderId));
    expect([n.roomStayId, n.stayCharge, n.loyaltyCustomerId, n.breakfastCount]).toEqual([stay104, "breakfast", sulimha, 1]);
  });
});
