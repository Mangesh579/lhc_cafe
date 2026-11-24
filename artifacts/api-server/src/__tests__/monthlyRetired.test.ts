// Monthly accounts retired (2026-11-24): the real Express routes, run against an in-memory PostgreSQL (PGlite).
// No route may create a monthly (account) bill; table visits still merge into one bill; old data stays readable.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual: any = await importOriginal();
  // Every module's `db` forwards to the PGlite database created below
  const db = new Proxy({}, { get: (_t, k) => { const v = holder.db[k]; return typeof v === "function" ? v.bind(holder.db) : v; } });
  return { ...actual, db };
});

import { eq } from "drizzle-orm";
import {
  usersTable, loyaltyCustomersTable, menuItemsTable, ordersTable, orderItemsTable, cafeTablesTable, tableSessionsTable,
  accountConversionsTable, accountConversionInvoicesTable,
} from "@workspace/db";
import { freshDb } from "./pgliteDb";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let server: any, base = "", token = "";
let monthlyCustomer: number, latte: number, tableId: number;

async function api(method: string, path: string, body?: unknown, auth = true) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

beforeAll(async () => {
  process.env.UPLOAD_DIR = join(tmpdir(), "cafe-nexus-test-uploads");
  ctx = await freshDb();
  holder.db = ctx.db;
  const db = ctx.db;
  const [admin] = await db.insert(usersTable).values({ username: "admin", passwordHash: "x", role: "admin" }).returning();
  const { signToken } = await import("../lib/auth");
  token = signToken({ id: admin.id, username: "admin", role: "admin", tokenVersion: admin.tokenVersion ?? 0 });
  // A customer still flagged pays_monthly from before the retirement
  [{ id: monthlyCustomer }] = await db.insert(loyaltyCustomersTable).values({ name: "Old Monthly", phone: "9800000009", email: "m@x.invalid", paysMonthly: true }).returning();
  [{ id: latte }] = await db.insert(menuItemsTable).values({ name: "Latte", price: "355" }).returning();
  [{ id: tableId }] = await db.insert(cafeTablesTable).values({ tableNumber: 7, name: "Table 7", token: "table-7-token", isOccupied: true } as any).returning();
  await db.insert(tableSessionsTable).values({ tableId, sessionToken: "qr-session-token-123", expiresAt: new Date(Date.now() + 3600_000) } as any);

  // Old data from before the retirement: a converted account bill and its credit invoice
  const [old] = await db.insert(ordersTable).values({ totalAmount: "355", accountBill: true, paymentStatus: "converted", orderStatus: "completed", loyaltyCustomerId: monthlyCustomer, notes: "Converted on 2026-11-24" }).returning();
  await db.insert(orderItemsTable).values({ orderId: old.id, menuItemId: latte, quantity: 1, unitPrice: "355", subtotal: "355", kotNumber: 1, kotAt: new Date("2026-11-20T05:00:00Z"), kotTable: "Table 7" });
  const [inv] = await db.insert(ordersTable).values({ totalAmount: "355", paymentStatus: "paid", orderStatus: "completed", paymentMethod: "credit", loyaltyCustomerId: monthlyCustomer, invoiceNumber: "2083/84-00301", convertedFromOrderId: old.id, paidAt: new Date("2026-11-20T05:00:00Z") }).returning();
  const [conv] = await db.insert(accountConversionsTable).values({ oldOrderId: old.id, customerId: monthlyCustomer, billTotal: "355", itemsSubtotal: "355", discount: "0", invoicesTotal: "355", invoiceCount: 1, balanceBefore: "0", balanceAfter: "355", fingerprint: "f", convertedBy: "admin" }).returning();
  await db.insert(accountConversionInvoicesTable).values({ conversionId: conv.id, newOrderId: inv.id, invoiceNumber: "2083/84-00301", visitDay: "2026-11-20", tableLabel: "Table 7", kotNumbers: "1", subtotal: "355", discountShare: "0", total: "355" });

  const { default: app } = await import("../app");
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 120000);

afterAll(async () => {
  await new Promise(r => server?.close(r));
  await ctx?.client.close();
});

describe("monthly accounts are retired", () => {
  it("making a customer a monthly account is refused with a clear message, and the monthly list is gone", async () => {
    const r = await api("PATCH", `/accounts/${monthlyCustomer}`, { paysMonthly: true });
    expect(r.status).toBe(410);
    expect(r.body.error).toMatch(/Monthly accounts have been retired/);
    expect((await api("GET", "/accounts")).status).toBe(410);
    // turning the old flag off is still allowed
    expect((await api("PATCH", `/accounts/${monthlyCustomer}`, { paysMonthly: false })).status).toBe(200);
    await ctx.db.update(loyaltyCustomersTable).set({ paysMonthly: true }).where(eq(loyaltyCustomersTable.id, monthlyCustomer));
  });

  it("an order for a customer still flagged pays_monthly is a normal bill, not a monthly bill", async () => {
    const r = await api("POST", "/orders", { items: [{ menuItemId: latte, quantity: 1 }], loyaltyCustomerId: monthlyCustomer, paymentMethod: "cash" });
    expect(r.status).toBe(201);
    expect(r.body.accountBill).toBe(false);
    expect(r.body.merged).toBe(false);
    expect(r.body.items[0].kotTable).toBeNull();
  });

  it("orders on the same table still merge into one bill as new KOTs, even for a pays_monthly customer", async () => {
    const a = await api("POST", "/orders", { tableId, items: [{ menuItemId: latte, quantity: 1 }], paymentMethod: "cash" });
    const b = await api("POST", "/orders", { tableId, items: [{ menuItemId: latte, quantity: 2 }], loyaltyCustomerId: monthlyCustomer, paymentMethod: "cash" });
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.merged).toBe(true);
    expect(b.body.kotNumber).toBe(2);
    expect(parseFloat(b.body.totalAmount)).toBe(355 * 3);
    expect(b.body.accountBill).toBe(false);
  });

  it("adding a pays_monthly customer to an order only sets the customer; it never merges into an account bill", async () => {
    const o = await api("POST", "/orders", { items: [{ menuItemId: latte, quantity: 1 }], paymentMethod: "cash" });
    const r = await api("PATCH", `/orders/${o.body.id}/customer`, { loyaltyCustomerId: monthlyCustomer });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(o.body.id);
    expect(r.body.loyaltyCustomerId).toBe(monthlyCustomer);
    expect(r.body.accountBill).toBe(false);
    expect(r.body.mergedInto).toBeNull();
  });

  it("QR 'charge to my account' is refused with a clear message, and nothing is placed", async () => {
    const before = (await ctx.db.select().from(ordersTable)).length;
    const r = await api("POST", "/public/order", { sessionToken: "qr-session-token-123", chargeToAccount: true, items: [{ menuItemId: latte, quantity: 1 }] }, false);
    expect(r.status).toBe(410);
    expect(r.body.error).toMatch(/no longer available/);
    expect((await ctx.db.select().from(ordersTable)).length).toBe(before);
  });

  it("a normal QR order still joins the table's open bill", async () => {
    const r = await api("POST", "/public/order", { sessionToken: "qr-session-token-123", items: [{ menuItemId: latte, quantity: 1 }] }, false);
    expect(r.status).toBe(200);
    expect(r.body.onAccount).toBe(false);
    const bill = (await ctx.db.select().from(ordersTable).where(eq(ordersTable.id, r.body.orderId)))[0];
    expect(bill.tableId).toBe(tableId);
    expect(bill.accountBill).toBe(false);
  });

  it("the QR page's account lookup says there is no monthly account", async () => {
    const r = await api("GET", "/public/loyalty/account?sessionToken=qr-session-token-123", undefined, false);
    expect(r.body).toEqual({ paysMonthly: false, openBill: null, retired: true });
  });

  it("no route created any monthly bill, and the dry run confirms none is open", async () => {
    const open = (await ctx.db.select().from(ordersTable).where(eq(ordersTable.accountBill, true))).filter((o: any) => o.paymentStatus === "pending");
    expect(open).toHaveLength(0);
    const dry = await api("GET", "/accounts/conversion-preview");
    expect(dry.status).toBe(200);
    expect(dry.body.summary.bills).toBe(0);
  });
});

describe("old data stays readable", () => {
  it("the conversion history lists the old conversion", async () => {
    const r = await api("GET", "/accounts/conversions");
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ customerName: "Old Monthly", invoiceCount: 1 });
    expect(r.body[0].invoices[0].invoiceNumber).toBe("2083/84-00301");
  });

  it("the converted bill and its items still appear in the order list", async () => {
    const r = await api("GET", "/orders");
    const old = r.body.find((o: any) => o.paymentStatus === "converted");
    expect(old).toBeTruthy();
    expect(old.accountBill).toBe(true);
    expect(old.items).toHaveLength(1);
    expect(old.items[0].kotTable).toBe("Table 7");
  });

  it("customer search still works for the Pay dialog and Receivables", async () => {
    const r = await api("GET", "/accounts/customers?search=Old");
    expect(r.status).toBe(200);
    expect(r.body.map((c: any) => c.name)).toEqual(["Old Monthly"]);
  });
});
