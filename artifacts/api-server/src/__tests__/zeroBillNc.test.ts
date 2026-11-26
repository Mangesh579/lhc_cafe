// Settling a Rs 0 bill (100% discount) and making an open bill complimentary (NC) at the payment step,
// on the real routes with an in-memory PostgreSQL (PGlite).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});

import { eq } from "drizzle-orm";
import { usersTable, ordersTable, orderItemsTable, orderPaymentsTable, menuItemsTable } from "@workspace/db";
import { freshDb } from "./pgliteDb";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "";
let token = "", latte = 0;

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
// An open bill: 2 lattes at 150 (cost 40 each)
async function openBill() {
  const [o] = await ctx.db.insert(ordersTable).values({ totalAmount: "300", paymentMethod: "cash", paymentStatus: "pending", orderStatus: "served", createdBy: "staff" } as any).returning();
  await ctx.db.insert(orderItemsTable).values({ orderId: o.id, menuItemId: latte, quantity: 2, unitPrice: "150", subtotal: "300", kotNumber: 1, unitCost: "40.0000", costComplete: true });
  return o.id as number;
}
const order = async (id: number) => (await ctx.db.select().from(ordersTable).where(eq(ordersTable.id, id)))[0];
const rows = async (id: number) => ctx.db.select().from(orderPaymentsTable).where(eq(orderPaymentsTable.orderId, id));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T06:00:00Z"));
  ctx = await freshDb();
  holder.db = ctx.db;
  const { signToken } = await import("../lib/auth");
  const [u] = await ctx.db.insert(usersTable).values({ username: "super", passwordHash: "x", role: "supervisor" }).returning();
  token = signToken({ id: u.id, username: "super", role: "supervisor", tokenVersion: u.tokenVersion ?? 0 });
  [{ id: latte }] = await ctx.db.insert(menuItemsTable).values({ name: "Latte", price: "150" }).returning();
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
  vi.useRealTimers();
});

describe("a Rs 0 bill (100% discount)", () => {
  it("settles whatever mode is picked, with an invoice number and no payment rows", async () => {
    for (const body of [
      { payments: [{ mode: "card_nabil", amount: 0 }] },  // the orders screen
      { paymentMethod: "card_hbl" },                      // an older screen: one mode, no parts
      { payments: [] },
    ]) {
      const id = await openBill();
      expect((await api("PATCH", `/orders/${id}/discount`, { discountPercent: 100, comment: "Loyalty reward level 2" })).status).toBe(200);
      const r = await api("PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", finalTotal: 0, ...body });
      expect(r.status).toBe(200);
      const o = await order(id);
      expect([o.paymentStatus, o.paymentMethod, o.totalAmount]).toEqual(["paid", "none", "0.00"]);
      expect(o.invoiceNumber).toMatch(/^2083\/84-\d{5}$/);
      expect(await rows(id)).toEqual([]);
    }
  });

  it("refuses Rs 0 on a bill that still has something to pay", async () => {
    const id = await openBill();
    expect((await api("PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", payments: [{ mode: "card_nabil", amount: 0 }] })).status).toBe(400);
    expect((await order(id)).paymentStatus).toBe("pending");
  });
});

describe("reward item (loyalty reward)", () => {
  it("takes one latte off, keeps an earlier discount, notes the reward, and refuses an item from another bill", async () => {
    const id = await openBill();
    await ctx.db.update(ordersTable).set({ totalAmount: "290", discountAmount: "10" }).where(eq(ordersTable.id, id)); // Rs 10 off at the POS
    const [item] = await ctx.db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
    const other = await openBill();
    const [otherItem] = await ctx.db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, other));
    expect((await api("PATCH", `/orders/${id}/discount`, { discountPercent: 0, rewardItemId: otherItem.id })).status).toBe(400);
    const r = await api("PATCH", `/orders/${id}/discount`, { discountPercent: 0, rewardItemId: item.id, comment: "Level 2" });
    expect(r.status).toBe(200);
    const o = await order(id);
    expect([o.totalAmount, o.discountAmount]).toEqual(["140.00", "160.00"]);
    expect(o.notes).toMatch(/Loyalty reward: 1 x Latte \(Rs\. 150\.00\) — Level 2/);
    expect((await api("PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", payments: [{ mode: "card_nabil", amount: 140 }] })).status).toBe(200);
  });

  it("a reward that covers the whole bill leaves Rs 0, settled with no payment method", async () => {
    const [o] = await ctx.db.insert(ordersTable).values({ totalAmount: "150", paymentMethod: "cash", paymentStatus: "pending", orderStatus: "served", createdBy: "staff" } as any).returning();
    const [it1] = await ctx.db.insert(orderItemsTable).values({ orderId: o.id, menuItemId: latte, quantity: 1, unitPrice: "150", subtotal: "150", kotNumber: 1 }).returning();
    await api("PATCH", `/orders/${o.id}/discount`, { discountPercent: 0, rewardItemId: it1.id });
    expect((await api("PATCH", `/orders/${o.id}/payment`, { paymentStatus: "paid", payments: [] })).status).toBe(200);
    expect((await order(o.id)).paymentMethod).toBe("none");
  });
});

describe("complimentary (NC) at the payment step", () => {
  it("needs the person's name, then books the bill at ingredient cost with no money received", async () => {
    const id = await openBill();
    expect((await api("PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", isNc: true, ncPersonName: " " })).status).toBe(400);
    const r = await api("PATCH", `/orders/${id}/payment`, { paymentStatus: "paid", isNc: true, ncPersonName: "Mr. Sharma, Room 204", ncReason: "Owner's guest", finalTotal: 300, payments: [{ mode: "cash", amount: 300 }] });
    expect(r.status).toBe(200);
    const o = await order(id);
    expect([o.paymentStatus, o.isNc, o.paymentMethod, o.totalAmount, o.discountAmount, o.ncPersonName, o.ncReason]).toEqual(["paid", true, "nc", "80.00", "0.00", "Mr. Sharma, Room 204", "Owner's guest"]);
    expect(o.invoiceNumber).toBeTruthy();
    expect(await rows(id)).toEqual([]);
  });
});
