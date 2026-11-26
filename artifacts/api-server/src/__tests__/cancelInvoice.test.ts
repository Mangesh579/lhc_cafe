// Receivables: Cancel invoice and Wrong customer (full credit notes), on the real routes with an in-memory PostgreSQL (PGlite).
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

import { eq } from "drizzle-orm";
import { usersTable, ordersTable, orderItemsTable, orderPaymentsTable, menuItemsTable, recipesTable, inventoryItemsTable, loyaltyCustomersTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
const tokens: Record<string, string> = {};
let ram: number, hari: number, latte: number, milk: number;

async function api(who: string, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const stock = async () => (await ctx.db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, milk)))[0].currentStock;
const owed = async (customerId: number, orderId: number) => (await api("acct", "GET", `/receivables/customers/${customerId}`)).body.invoices.find((i: any) => i.orderId === orderId)?.outstanding;

// A credit invoice on 23 Nov (Nepal), 2 lattes at 150 with a 10 discount = 290; parts = all credit unless given
let invNo = 0;
async function creditInvoice(customerId: number, parts: [string, number][] = [["credit", 290]]) {
  const paidAt = new Date("2026-11-23T08:00:00Z");
  const [o] = await ctx.db.insert(ordersTable).values({
    totalAmount: "290", discountAmount: "10", paymentMethod: parts.length > 1 ? "split" : parts[0][0], paymentStatus: "paid", orderStatus: "completed",
    loyaltyCustomerId: customerId, invoiceNumber: `2083/84-0000${++invNo}`, paidAt, createdAt: paidAt, createdBy: "staff",
  } as any).returning();
  await ctx.db.insert(orderItemsTable).values({ orderId: o.id, menuItemId: latte, quantity: 2, unitPrice: "150", subtotal: "300", kotNumber: 1, unitCost: "40.0000", costComplete: true });
  for (const [mode, amount] of parts) await ctx.db.insert(orderPaymentsTable).values({ orderId: o.id, mode, amount: String(amount), paidAt } as any);
  return o.id as number;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T06:00:00Z"));
  ctx = await freshDb();
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  for (const [username, role] of [["admin", "admin"], ["acct", "accountant"], ["super", "supervisor"], ["barista", "head_barista"]]) {
    const [u] = await ctx.db.insert(usersTable).values({ username, passwordHash: "x", role }).returning();
    tokens[username] = signToken({ id: u.id, username, role, tokenVersion: u.tokenVersion ?? 0 });
  }
  [{ id: ram }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Ram", phone: "9800000001", email: "ram@example.com" }).returning();
  [{ id: hari }] = await ctx.db.insert(loyaltyCustomersTable).values({ name: "Hari", phone: "9800000002", email: "hari@example.com" }).returning();
  [{ id: milk }] = await ctx.db.insert(inventoryItemsTable).values({ name: "Milk", unit: "L", department: "drink", currentStock: "10" }).returning();
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "150" }).returning();
  await ctx.db.insert(recipesTable).values({ menuItemId: latte, inventoryItemId: milk, quantityRequired: "0.2", wasteQuantity: "0.05" });
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("cancel invoice", () => {
  it("is a full credit note to the paisa; served food keeps its stock", async () => {
    const id = await creditInvoice(ram);
    expect((await api("super", "POST", `/receivables/invoices/${id}/cancel`, { reason: "x" })).status).toBe(403);
    expect((await api("acct", "POST", `/receivables/invoices/${id}/cancel`, { reason: " " })).status).toBe(400);
    const r = await api("acct", "POST", `/receivables/invoices/${id}/cancel`, { reason: "Entered twice" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: "cancel", total: 290, stockRestored: false, noteDate: "2026-11-25" });
    expect(r.body.items).toEqual([expect.objectContaining({ quantity: 2, amount: 290 })]);
    expect(await owed(ram, id)).toBe(0);
    expect(await stock()).toBe("10.00");
    expect((await api("acct", "POST", `/receivables/invoices/${id}/cancel`, { reason: "again" })).body.error).toMatch(/Nothing is left|not a credit invoice/);
  });

  it("puts the stock back when the order was not served, and takes it out again if the note is voided", async () => {
    const id = await creditInvoice(ram);
    const r = await api("admin", "POST", `/receivables/invoices/${id}/cancel`, { reason: "Not served", restoreStock: true });
    expect(r.body.stockRestored).toBe(true);
    expect(await stock()).toBe("10.50"); // 2 x (0.2 + 0.05)
    expect((await api("acct", "POST", `/credit-notes/${r.body.id}/void`, { reason: "Was served after all" })).status).toBe(200);
    expect(await stock()).toBe("10.00");
    expect(await owed(ram, id)).toBe(290);
  });

  it("refuses a split bill and an invoice with receipts allocated", async () => {
    const split = await creditInvoice(ram, [["cash", 90], ["credit", 200]]);
    expect((await api("acct", "POST", `/receivables/invoices/${split}/cancel`, { reason: "x" })).body.error).toMatch(/cash, QR or card/);
    const paid = await creditInvoice(ram);
    expect((await api("acct", "POST", "/receipts", { customerId: ram, amount: 100, mode: "bank", reference: "T1", allocations: [{ orderId: paid, amount: 100 }] })).status).toBe(201);
    expect((await api("acct", "POST", `/receivables/invoices/${paid}/cancel`, { reason: "x" })).body.error).toMatch(/Void those receipts first/);
  });
});

describe("wrong customer", () => {
  it("credits the old invoice and re-issues it, dated on the visit day, to the right customer", async () => {
    const id = await creditInvoice(ram);
    expect((await api("barista", "POST", `/receivables/invoices/${id}/move`, { customerId: hari, reason: "x" })).status).toBe(403);
    expect((await api("acct", "POST", `/receivables/invoices/${id}/move`, { customerId: ram, reason: "x" })).body.error).toMatch(/already on that customer/);
    const r = await api("acct", "POST", `/receivables/invoices/${id}/move`, { customerId: hari, reason: "Hari's tab, not Ram's" });
    expect(r.status).toBe(201);
    expect(r.body.note).toMatchObject({ kind: "reissue", total: 290, reissuedOrderId: r.body.newInvoice.orderId });
    expect(r.body.newInvoice.invoiceNumber).toMatch(/^2083\/84-\d{5}$/);
    expect(await owed(ram, id)).toBe(0);
    const h = (await api("acct", "GET", `/receivables/customers/${hari}`)).body;
    expect(h.invoices).toEqual([expect.objectContaining({ orderId: r.body.newInvoice.orderId, day: "2026-11-23", creditAmount: 290, outstanding: 290 })]);
    const items = await ctx.db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, r.body.newInvoice.orderId));
    expect(items).toEqual([expect.objectContaining({ menuItemId: latte, quantity: 2, subtotal: "300.00", kotNumber: 1, unitCost: "40.0000" })]);
    expect(await stock()).toBe("10.00"); // served once; stock untouched
    expect((await api("acct", "POST", `/credit-notes/${r.body.note.id}/void`, { reason: "x" })).body.error).toMatch(/cannot be voided/);
    // and back again from the new invoice
    expect((await api("acct", "POST", `/receivables/invoices/${r.body.newInvoice.orderId}/move`, { customerId: ram, reason: "Was Ram after all" })).status).toBe(201);
  });

  it("refuses an invoice that already has an item-wise credit note", async () => {
    const id = await creditInvoice(ram);
    const item = (await ctx.db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id)))[0];
    expect((await api("acct", "POST", "/credit-notes", { orderId: id, reason: "one was cold", lines: [{ orderItemId: item.id, quantity: 1 }] })).status).toBe(201);
    expect((await api("acct", "POST", `/receivables/invoices/${id}/move`, { customerId: hari, reason: "x" })).body.error).toMatch(/has credit notes/);
    // cancel credits only what is left
    const c = await api("acct", "POST", `/receivables/invoices/${id}/cancel`, { reason: "rest" });
    expect(c.body.total).toBe(145);
    expect(await owed(ram, id)).toBe(0);
  });
});

it("migration 010 is idempotent and checks the kinds", async () => {
  const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/010_credit_note_kinds.sql", import.meta.url)), "utf8");
  const { client } = await freshDb();
  await client.exec(`ALTER TABLE credit_notes DROP COLUMN kind; ALTER TABLE credit_notes DROP COLUMN stock_restored; ALTER TABLE credit_notes DROP COLUMN reissued_order_id;
    INSERT INTO orders (id, total_amount) VALUES (1, 100), (2, 100);
    INSERT INTO credit_notes (note_no, order_id, customer_id, note_date, reason, subtotal, total, created_by) VALUES ('CN-1', 1, 1, '2026-11-25', 'old', 10, 10, 'a');`);
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  expect((await client.query<any>(`SELECT kind, stock_restored FROM credit_notes`)).rows).toEqual([{ kind: "note", stock_restored: false }]);
  const note = (no: string, kind: string, restored: boolean, reissued: number | null) =>
    `INSERT INTO credit_notes (note_no, order_id, customer_id, note_date, reason, subtotal, total, created_by, kind, stock_restored, reissued_order_id) VALUES ('${no}', 1, 1, '2026-11-25', 'r', 10, 10, 'a', '${kind}', ${restored}, ${reissued ?? "NULL"})`;
  await client.exec(note("CN-2", "cancel", true, null));
  await client.exec(note("CN-3", "reissue", false, 2));
  await expect(client.exec(note("CN-4", "reissue", false, null))).rejects.toThrow(); // reissue needs the new invoice
  await expect(client.exec(note("CN-5", "note", true, null))).rejects.toThrow();     // only a cancel restores stock
  await expect(client.exec(note("CN-6", "cancel", false, 2))).rejects.toThrow();
  await expect(client.exec(note("CN-7", "other", false, null))).rejects.toThrow();
  await client.close();
}, 60000);
